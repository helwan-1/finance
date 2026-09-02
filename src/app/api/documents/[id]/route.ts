import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { DocumentStatus, DocumentType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { recordAuditLog } from "@/lib/audit-log";

const TYPES: DocumentType[] = [
  "INVOICE", "BANK_STATEMENT", "VAT_RETURN", "GENERAL_LEDGER",
  "PURCHASE_ORDER", "RECEIPT", "OTHER",
];
const STATUSES: DocumentStatus[] = [
  "UPLOADED", "PROCESSING", "PARSED", "FAILED", "ARCHIVED",
];

async function guard(id: string) {
  const session = await getSession();
  if (!session) {
    return { ok: false as const, res: NextResponse.json({ error: "Authentication required" }, { status: 401 }) };
  }
  if (!can(session.role, "documents:upload")) {
    return { ok: false as const, res: NextResponse.json({ error: "Insufficient permissions" }, { status: 403 }) };
  }
  const doc = await prisma.document.findUnique({
    where: { id },
    select: { auditFirmId: true, engagementId: true },
  });
  if (!doc) return { ok: false as const, res: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  if (doc.auditFirmId !== session.auditFirmId) {
    return { ok: false as const, res: NextResponse.json({ error: "Cross-tenant access denied" }, { status: 403 }) };
  }
  return { ok: true as const, session, doc };
}

interface PatchBody {
  fileName?: string;
  type?: DocumentType;
  status?: DocumentStatus;
}

/** PATCH /api/documents/:id — rename, retype, or change status (e.g. archive). */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const g = await guard(params.id);
  if (!g.ok) return g.res;

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    await prisma.document.update({
      where: { id: params.id },
      data: {
        ...(body.fileName ? { fileName: body.fileName.trim() } : {}),
        ...(body.type && TYPES.includes(body.type) ? { type: body.type } : {}),
        ...(body.status && STATUSES.includes(body.status) ? { status: body.status } : {}),
      },
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "تعذّر تحديث المستند" }, { status: 503 });
  }
}

/**
 * DELETE /api/documents/:id — remove the document and the transactions extracted
 * from it (they are derived data), inside one DB transaction.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const g = await guard(params.id);
  if (!g.ok) return g.res;

  try {
    const removed = await prisma.$transaction(async (tx) => {
      const del = await tx.transaction.deleteMany({ where: { documentId: params.id } });
      await tx.document.delete({ where: { id: params.id } });
      return del.count;
    });
    await recordAuditLog({
      auditFirmId: g.doc.auditFirmId,
      engagementId: g.doc.engagementId,
      userId: g.session.userId,
      action: "EXPORT_DATA",
      entityType: "Document",
      entityId: params.id,
      metadata: { deletedTransactions: removed },
    });
    return NextResponse.json({ ok: true, deletedTransactions: removed });
  } catch {
    return NextResponse.json({ error: "تعذّر حذف المستند" }, { status: 503 });
  }
}
