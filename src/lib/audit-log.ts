import type { AuditAction, Prisma } from "@prisma/client";
import { prisma } from "./prisma";

/**
 * Append an immutable audit-trail entry. Every user-visible action (viewing
 * files, resolving anomalies, exporting data) must be recorded through here.
 *
 * The AuditLog table is append-only by convention: there are no update/delete
 * code paths in the application layer.
 */
export interface AuditLogInput {
  auditFirmId: string;
  engagementId?: string | null;
  userId: string;
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  metadata?: Prisma.InputJsonValue;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export async function recordAuditLog(input: AuditLogInput): Promise<void> {
  await prisma.auditLog.create({
    data: {
      auditFirmId: input.auditFirmId,
      engagementId: input.engagementId ?? null,
      userId: input.userId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      metadata: input.metadata,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    },
  });
}
