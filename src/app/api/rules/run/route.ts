import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
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

  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  if (!can(session.role, "rules:run")) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }
  if (!engagementId) {
    return NextResponse.json({ error: "engagementId is required" }, { status: 400 });
  }

  try {
    const engagement = await prisma.auditEngagement.findUnique({
      where: { id: engagementId },
      select: { auditFirmId: true },
    });
    if (!engagement) {
      return NextResponse.json({ error: "Engagement not found" }, { status: 404 });
    }
    if (engagement.auditFirmId !== session.auditFirmId) {
      return NextResponse.json({ error: "Cross-tenant access denied" }, { status: 403 });
    }

    const [ruleRows, txns] = await Promise.all([
      prisma.auditRule.findMany({
        where: {
          auditFirmId: engagement.auditFirmId,
          enabled: true,
          OR: [{ engagementId: null }, { engagementId }],
        },
      }),
      prisma.transaction.findMany({
        where: { auditFirmId: engagement.auditFirmId, engagementId },
      }),
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
    await prisma.anomalyFlag.deleteMany({
      where: { engagementId, ruleCode: "CUSTOM_RULE", status: "OPEN" },
    });

    for (const f of findings) {
      await prisma.anomalyFlag.create({
        data: {
          auditFirmId: engagement.auditFirmId,
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

    await recordAuditLog({
      auditFirmId: engagement.auditFirmId,
      engagementId,
      userId: session.userId,
      action: "RUN_ANALYSIS",
      entityType: "AuditRule",
      metadata: { rules: rules.length, findings: findings.length },
    });

    publishAuditEvent({
      type: "anomaly.created",
      engagementId,
      payload: { source: "rules", findings: findings.length },
    });

    return NextResponse.json<RunRulesResponse>({
      evaluated: rules.length,
      findings: findings.length,
    });
  } catch {
    return NextResponse.json({ error: "تعذّر تشغيل التدقيق" }, { status: 503 });
  }
}
