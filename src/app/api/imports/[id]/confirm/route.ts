import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth/guard";
import { recordAuditLog } from "@/lib/audit-log";
import { confirmImport } from "@/lib/import/pipeline";

/**
 * POST /api/imports/:id/confirm — explicit auditor confirmation (Closure C8).
 * Transitions READY → IMPORTING → creates transactions for ACCEPTED records
 * only → finalizes the Dataset. No automatic READY→IMPORTING. Fail-closed.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const auth = await requireSession("documents:upload");
  if (!auth.ok) return auth.response;

  try {
    const result = await confirmImport(auth.session.auditFirmId, auth.session.userId, params.id);
    if (result.status === "NOT_READY") {
      return NextResponse.json({ error: "Batch is not awaiting confirmation" }, { status: 409 });
    }
    if (result.status === "ALREADY_COMPLETED") {
      return NextResponse.json(result, { status: 200 });
    }
    await recordAuditLog({
      auditFirmId: auth.session.auditFirmId, userId: auth.session.userId,
      action: "RUN_ANALYSIS", entityType: "ImportBatch", entityId: params.id,
      metadata: { phase: "CONFIRMED", datasetId: result.datasetId, transactionsCreated: result.transactionsCreated },
    });
    return NextResponse.json(result, { status: 200 });
  } catch {
    return NextResponse.json({ error: "تعذّر تأكيد الاستيراد" }, { status: 503 });
  }
}
