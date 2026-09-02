import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { requireSession } from "@/lib/auth/guard";
import { recordAuditLog } from "@/lib/audit-log";
import { startImport } from "@/lib/import/pipeline";
import type { DatasetKind } from "@/lib/import/vocab";

const KINDS: DatasetKind[] = ["GENERAL_LEDGER", "TRIAL_BALANCE", "BANK", "OTHER"];

/**
 * POST /api/imports — start a lineage-aware import. Stores the SourceFile,
 * validates rows, and HALTS at READY (no transactions yet). Requires explicit
 * confirmation via POST /api/imports/:id/confirm. Fail-closed.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireSession("documents:upload");
  if (!auth.ok) return auth.response;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }
  const engagementId = (form.get("engagementId") as string | null)?.trim();
  if (!engagementId) {
    return NextResponse.json({ error: "engagementId is required" }, { status: 400 });
  }
  const rawKind = (form.get("datasetKind") as string | null)?.trim();
  const datasetKind: DatasetKind =
    rawKind && KINDS.includes(rawKind as DatasetKind) ? (rawKind as DatasetKind) : "GENERAL_LEDGER";
  const idempotencyKey = (form.get("idempotencyKey") as string | null)?.trim() || `req_${randomUUID()}`;
  const acknowledgeDuplicate = (form.get("acknowledgeDuplicate") as string | null) === "true";

  const bytes = Buffer.from(await file.arrayBuffer());

  try {
    const result = await startImport({
      auditFirmId: auth.session.auditFirmId,
      userId: auth.session.userId,
      engagementId,
      datasetKind,
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      bytes,
      idempotencyKey,
      acknowledgeDuplicate,
    });

    if (result.status === "DUPLICATE_BLOCKED") {
      return NextResponse.json(
        { error: "duplicate_content", duplicateOfSourceFileId: result.duplicateOfSourceFileId },
        { status: 409 },
      );
    }
    if (result.status === "STORAGE_FAILED") {
      return NextResponse.json({ error: "تعذّر حفظ الملف المصدر" }, { status: 503 });
    }
    if (result.status === "READY") {
      await recordAuditLog({
        auditFirmId: auth.session.auditFirmId, engagementId, userId: auth.session.userId,
        action: "RUN_ANALYSIS", entityType: "ImportBatch", entityId: result.batchId,
        metadata: { phase: "READY", rowsTotal: result.rowsTotal, rowsAccepted: result.rowsAccepted, rowsRejected: result.rowsRejected },
      });
    }
    return NextResponse.json(result, { status: result.status === "READY" ? 201 : 200 });
  } catch {
    return NextResponse.json({ error: "تعذّر بدء الاستيراد" }, { status: 503 });
  }
}
