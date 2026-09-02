import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth/guard";
import { withTenantContext } from "@/lib/db/tenant";
import { recordAuditLog } from "@/lib/audit-log";
import { publishAuditEvent } from "@/lib/events";
import { evaluateRules } from "@/lib/rules/engine";
import type { AuditRuleSpec, RuleDefinition, RuleRecord } from "@/lib/rules/types";
import type { AnomalySeverity, RunRulesResponse } from "@/lib/ui-types";

const SEVERITY_SCORE: Record<AnomalySeverity, number> = {
  CRITICAL: 95,
  HIGH: 80,
  MEDIUM: 60,
  LOW: 40,
  INFO: 20,
};

/**
 * POST /api/rules/run?engagementId=... — evaluate all enabled applicable rules
 * over the engagement's transactions and persist the findings as anomaly flags
 * (ruleCode CUSTOM_RULE, linked to the rule). Deterministic; no AI. Requires
 * the rules:run permission and a real, connected engagement.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const engagementId = searchParams.get("engagementId");

  const auth = await requireSession("rules:run");
  if (!auth.ok) return auth.response;
  const session = auth.session;
  if (!engagementId) {
    return NextResponse.json({ error: "engagementId is required" }, { status: 400 });
  }

  try {
    const outcome = await withTenantContext(session.auditFirmId, async (tx) => {
      // RLS makes a cross-tenant / unknown engagement invisible → not found.
      const engagement = await tx.auditEngagement.findUnique({
        where: { id: engagementId },
        select: { id: true },
      });
      if (!engagement) return null;

      const [ruleRows, txns] = await Promise.all([
        tx.auditRule.findMany({
          where: { enabled: true, OR: [{ engagementId: null }, { engagementId }] },
        }),
        tx.transaction.findMany({ where: { engagementId } }),
      ]);

      const rules: AuditRuleSpec[] = ruleRows.map((r) => ({
        id: r.id,
        code: r.code,
        nameAr: r.nameAr,
        category: r.category,
        severity: r.severity,
        definition: r.definition as unknown as RuleDefinition,
      }));

      const records: RuleRecord[] = txns.map((t) => ({
        id: t.id,
        reference: t.reference,
        description: t.description,
        amount: t.amount.toString(),
        vatAmount: t.vatAmount ? t.vatAmount.toString() : null,
        counterparty: t.counterparty,
        account: t.account,
        postedAt: t.postedAt.toISOString(),
        valueDate: t.valueDate.toISOString(),
        hasDocument: t.documentId !== null,
      }));

      const findings = evaluateRules(records, rules);

      // Replace previous auto-generated, still-open rule findings so re-runs are
      // idempotent (never touch resolved/dismissed ones).
      await tx.anomalyFlag.deleteMany({
        where: { engagementId, ruleCode: "CUSTOM_RULE", status: "OPEN" },
      });

      for (const f of findings) {
        await tx.anomalyFlag.create({
          data: {
            auditFirmId: session.auditFirmId,
            engagementId,
            transactionId: f.transactionIds[0] ?? null,
            auditRuleId: f.ruleId,
            ruleCode: "CUSTOM_RULE",
            severity: f.severity,
            status: "OPEN",
            title: f.code,
            titleAr: f.titleAr,
            description: f.descriptionAr,
            descriptionAr: f.descriptionAr,
            score: SEVERITY_SCORE[f.severity].toFixed(2),
            evidence: { code: f.code, category: f.category, ...f.evidence } as object,
          },
        });
      }
      return { evaluated: rules.length, findings: findings.length };
    });

    if (!outcome) {
      return NextResponse.json({ error: "Engagement not found" }, { status: 404 });
    }

    await recordAuditLog({
      auditFirmId: session.auditFirmId,
      engagementId,
      userId: session.userId,
      action: "RUN_ANALYSIS",
      entityType: "AuditRule",
      metadata: { rules: outcome.evaluated, findings: outcome.findings },
    });

    publishAuditEvent({
      type: "anomaly.created",
      engagementId,
      payload: { source: "rules", findings: outcome.findings },
    });

    return NextResponse.json<RunRulesResponse>({
      evaluated: outcome.evaluated,
      findings: outcome.findings,
    });
  } catch {
    return NextResponse.json({ error: "تعذّر تشغيل التدقيق" }, { status: 503 });
  }
}
