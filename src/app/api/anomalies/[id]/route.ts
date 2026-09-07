import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { AnomalyStatus, AuditAction } from "@prisma/client";
import { getSession } from "@/lib/auth/session";
import { authorize } from "@/lib/auth/guard";
import { can } from "@/lib/auth/rbac";
import { demoAllowed } from "@/lib/security/env";
import { withTenantContext } from "@/lib/db/tenant";
import { recordAuditLog } from "@/lib/audit-log";
import { publishAuditEvent } from "@/lib/events";
import type { AnomalyDTO, AnomalyDetailDTO } from "@/lib/ui-types";

/**
 * GET /api/anomalies/:id — full case detail for the audit dashboard: rule
 * metadata, structured evidence, the underlying transaction and the resolution
 * history. Read-path guard (anomalies:view); RLS scopes the row to the firm.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const authz = await authorize("anomalies:view");
  if (!authz.ok) return authz.response;
  if (!authz.session) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  try {
    const row = await withTenantContext(authz.session.auditFirmId, (tx) =>
      tx.anomalyFlag.findUnique({
        where: { id: params.id },
        include: {
          transaction: {
            select: {
              reference: true,
              description: true,
              amount: true,
              vatAmount: true,
              currency: true,
              type: true,
              source: true,
              counterparty: true,
              account: true,
              postedAt: true,
              valueDate: true,
            },
          },
          resolvedBy: { select: { fullNameAr: true } },
          auditRule: { select: { nameAr: true } },
        },
      }),
    );
    if (!row) {
      return NextResponse.json({ error: "Anomaly not found" }, { status: 404 });
    }

    const evidence =
      row.evidence && typeof row.evidence === "object" && !Array.isArray(row.evidence)
        ? (row.evidence as Record<string, unknown>)
        : null;

    const anomaly: AnomalyDetailDTO = {
      id: row.id,
      ruleCode: row.ruleCode,
      severity: row.severity,
      status: row.status,
      titleAr: row.titleAr,
      descriptionAr: row.descriptionAr,
      score: row.score.toString(),
      detectedAt: row.detectedAt.toISOString(),
      evidence,
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
      resolvedByName: row.resolvedBy?.fullNameAr ?? null,
      resolutionNote: row.resolutionNote ?? null,
      auditRuleName: row.auditRule?.nameAr ?? null,
      transaction: row.transaction
        ? {
            reference: row.transaction.reference,
            description: row.transaction.description,
            amount: row.transaction.amount.toString(),
            vatAmount: row.transaction.vatAmount?.toString() ?? null,
            currency: row.transaction.currency,
            type: row.transaction.type,
            source: row.transaction.source,
            counterparty: row.transaction.counterparty,
            account: row.transaction.account,
            postedAt: row.transaction.postedAt.toISOString(),
            valueDate: row.transaction.valueDate.toISOString(),
          }
        : null,
    };
    return NextResponse.json({ anomaly });
  } catch {
    return NextResponse.json({ error: "تعذّر تحميل التفاصيل" }, { status: 503 });
  }
}

/** Resolution actions the client may request, mapped to status + audit action. */
const ACTIONS: Record<
  string,
  { status: AnomalyStatus; audit: AuditAction }
> = {
  RESOLVE: { status: "RESOLVED", audit: "RESOLVE_ANOMALY" },
  DISMISS: { status: "DISMISSED", audit: "DISMISS_ANOMALY" },
  ESCALATE: { status: "ESCALATED", audit: "ESCALATE_ANOMALY" },
};

interface PatchBody {
  action?: string;
  note?: string;
}

/**
 * PATCH /api/anomalies/:id — resolve, dismiss, or escalate an anomaly.
 *
 * Requires the anomalies:resolve permission. The target anomaly must belong to
 * the caller's audit firm (tenant isolation). Records an immutable audit-log
 * entry. In demo mode (no session) it returns a synthesized updated DTO so the
 * UI stays interactive without a database.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const action = body.action ? ACTIONS[body.action] : undefined;
  if (!action) {
    return NextResponse.json(
      { error: "action must be RESOLVE, DISMISS, or ESCALATE" },
      { status: 400 },
    );
  }

  const note = typeof body.note === "string" ? body.note.trim() : undefined;
  const session = await getSession();

  // Fail-closed: writes require a session. Only the non-production demo may
  // echo a synthesized result (no database mutation) to stay interactive.
  if (!session) {
    if (demoAllowed()) {
      return NextResponse.json({ id: params.id, status: action.status });
    }
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    );
  }

  if (!can(session.role, "anomalies:resolve")) {
    return NextResponse.json(
      { error: "Insufficient permissions" },
      { status: 403 },
    );
  }

  try {
    // Tenant scope is enforced by RLS: a cross-tenant id is simply invisible.
    const result = await withTenantContext(session.auditFirmId, async (tx) => {
      const existing = await tx.anomalyFlag.findUnique({
        where: { id: params.id },
        select: { engagementId: true },
      });
      if (!existing) return null;
      const row = await tx.anomalyFlag.update({
        where: { id: params.id },
        data: {
          status: action.status,
          resolvedAt: new Date(),
          resolvedById: session.userId,
          resolutionNote: note ?? null,
        },
        include: {
          transaction: {
            select: { reference: true, amount: true, counterparty: true },
          },
        },
      });
      return { existing, updated: row };
    });

    if (!result) {
      return NextResponse.json({ error: "Anomaly not found" }, { status: 404 });
    }
    const { existing, updated } = result;

    await recordAuditLog({
      auditFirmId: session.auditFirmId,
      engagementId: existing.engagementId,
      userId: session.userId,
      action: action.audit,
      entityType: "AnomalyFlag",
      entityId: params.id,
      metadata: note ? { note } : undefined,
    });

    // Broadcast to any live dashboards watching this engagement.
    publishAuditEvent({
      type: "anomaly.updated",
      engagementId: existing.engagementId,
      payload: { id: params.id, status: action.status },
    });

    const dto: AnomalyDTO = {
      id: updated.id,
      ruleCode: updated.ruleCode,
      severity: updated.severity,
      status: updated.status,
      title: updated.title,
      titleAr: updated.titleAr,
      description: updated.description,
      descriptionAr: updated.descriptionAr,
      score: updated.score.toString(),
      detectedAt: updated.detectedAt.toISOString(),
      reference: updated.transaction?.reference ?? null,
      amount: updated.transaction?.amount.toString() ?? null,
      counterparty: updated.transaction?.counterparty ?? null,
    };
    return NextResponse.json(dto);
  } catch {
    return NextResponse.json(
      { error: "تعذّر تحديث الحالة" },
      { status: 503 },
    );
  }
}
