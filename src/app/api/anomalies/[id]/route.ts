import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { AnomalyStatus, AuditAction } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { recordAuditLog } from "@/lib/audit-log";
import { publishAuditEvent } from "@/lib/events";
import type { AnomalyDTO } from "@/lib/ui-types";

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

  // Demo mode: no session. When auth is required, reject; else acknowledge.
  if (!session) {
    if (process.env.AUTH_REQUIRED === "true") {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 },
      );
    }
    return NextResponse.json({ id: params.id, status: action.status });
  }

  if (!can(session.role, "anomalies:resolve")) {
    return NextResponse.json(
      { error: "Insufficient permissions" },
      { status: 403 },
    );
  }

  try {
    const existing = await prisma.anomalyFlag.findUnique({
      where: { id: params.id },
      select: { auditFirmId: true, engagementId: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Anomaly not found" }, { status: 404 });
    }
    // Tenant isolation.
    if (existing.auditFirmId !== session.auditFirmId) {
      return NextResponse.json(
        { error: "Cross-tenant access denied" },
        { status: 403 },
      );
    }

    const updated = await prisma.anomalyFlag.update({
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
