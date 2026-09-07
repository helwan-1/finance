import { NextResponse } from "next/server";
import { authorize } from "@/lib/auth/guard";
import { deleteDataset } from "@/lib/g4/app/run-access";
import { runErrorResponse } from "@/lib/g4/app/http";

/**
 * DELETE /api/datasets/:id — remove an imported dataset that has not been used
 * in any audit run. Datasets consumed by a run are frozen evidence and are
 * refused (422). Engagement membership is enforced in the service layer.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const authz = await authorize("runs:manage");
  if (!authz.ok) return authz.response;
  if (!authz.session) return NextResponse.json({ error: "UNAUTHENTICATED", code: "UNAUTHENTICATED" }, { status: 401 });
  try {
    const out = await deleteDataset(
      { userId: authz.session.userId, auditFirmId: authz.session.auditFirmId },
      params.id,
    );
    return NextResponse.json(out);
  } catch (e) {
    return runErrorResponse(e);
  }
}
