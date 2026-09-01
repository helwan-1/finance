import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { DEMO_AUDIT_LOGS } from "@/lib/demo-audit-log";
import type { AuditLogDTO, AuditLogResponse } from "@/lib/ui-types";

/**
 * GET /api/audit-log?engagementId=... — immutable audit trail (tenant-scoped),
 * newest first. Demo fallback with no DB.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const engagementId = searchParams.get("engagementId");

  try {
    if (!engagementId) {
      return NextResponse.json<AuditLogResponse>({ logs: DEMO_AUDIT_LOGS });
    }

    const engagement = await prisma.auditEngagement.findUnique({
      where: { id: engagementId },
      select: { auditFirmId: true },
    });
    if (!engagement) {
      return NextResponse.json<AuditLogResponse>({ logs: DEMO_AUDIT_LOGS });
    }

    const rows = await prisma.auditLog.findMany({
      where: { auditFirmId: engagement.auditFirmId, engagementId },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { user: { select: { fullNameAr: true } } },
    });

    const logs: AuditLogDTO[] = rows.map((r) => ({
      id: r.id,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      userNameAr: r.user.fullNameAr,
      createdAt: r.createdAt.toISOString(),
      metadata:
        r.metadata === null
          ? null
          : (r.metadata as Prisma.JsonObject as Record<string, unknown>),
    }));

    return NextResponse.json<AuditLogResponse>({ logs });
  } catch {
    return NextResponse.json<AuditLogResponse>({ logs: DEMO_AUDIT_LOGS });
  }
}
