import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { DocumentStatus, DocumentType } from "@prisma/client";
import { requireSession } from "@/lib/auth/guard";
import { withTenantContext } from "@/lib/db/tenant";
import { recordAuditLog } from "@/lib/audit-log";

const TYPES: DocumentType[] = [
  "INVOICE", "BANK_STATEMENT", "VAT_RETURN", "GENERAL_LEDGER",
  "PURCHASE_ORDER", "RECEIPT", "OTHER",
];
const STATUSES: DocumentStatus[] = [
  "UPLOADED", "PROCESSING", "PARSED", "FAILED", "ARCHIVED",
];

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
  const auth = await requireSession("documents:upload");
  if (!auth.ok) return auth.response;

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const found = await withTenantContext(auth.session.auditFirmId, async (tx) => {
      // RLS makes a cross-tenant document invisible → not found.
      const doc = await tx.document.findUnique({
        where: { id: params.id },
        select: { id: true },
      });
      if (!doc) return false;
      await tx.document.update({
        where: { id: params.id },
        data: {
          ...(body.fileName ? { fileName: body.fileName.trim() } : {}),
          ...(body.type && TYPES.includes(body.type) ? { type: body.type } : {}),
          ...(body.status && STATUSES.includes(body.status)
            ? { status: body.status }
            : {}),
        },
      });
      return true;
    });
    if (!found) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "تعذّر تحديث المستند" }, { status: 503 });
  }
}

/**
 * DELETE /api/documents/:id — remove the document and the transactions extracted
 * from it (they are derived data), inside one tenant-scoped transaction.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const auth = await requireSession("documents:upload");
  if (!auth.ok) return auth.response;

  try {
    const outcome = await withTenantContext(auth.session.auditFirmId, async (tx) => {
      const doc = await tx.document.findUnique({
        where: { id: params.id },
        select: { id: true, engagementId: true },
      });
      if (!doc) return null;
      const del = await tx.transaction.deleteMany({ where: { documentId: params.id } });
      await tx.document.delete({ where: { id: params.id } });
      return { engagementId: doc.engagementId, deleted: del.count };
    });

    if (!outcome) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await recordAuditLog({
      auditFirmId: auth.session.auditFirmId,
      engagementId: outcome.engagementId,
      userId: auth.session.userId,
      action: "EXPORT_DATA",
      entityType: "Document",
      entityId: params.id,
      metadata: { deletedTransactions: outcome.deleted },
    });
    return NextResponse.json({ ok: true, deletedTransactions: outcome.deleted });
  } catch {
    return NextResponse.json({ error: "تعذّر حذف المستند" }, { status: 503 });
  }
}
