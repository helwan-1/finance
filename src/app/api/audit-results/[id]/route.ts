import { NextResponse } from "next/server";
import { authorize } from "@/lib/auth/guard";
import { getAuditResultDetail } from "@/lib/g4/app/run-access";
import { runErrorResponse } from "@/lib/g4/app/http";

/**
 * GET /api/audit-results/:id — full detail for one audit result (مؤشّر): the
 * result core, its disposition state, and every evidence row traced to the
 * imported source record. Engagement-membership enforced in the service layer.
 */
export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const authz = await authorize("runs:view");
  if (!authz.ok) return authz.response;
  if (!authz.session) return NextResponse.json({ error: "UNAUTHENTICATED", code: "UNAUTHENTICATED" }, { status: 401 });
  try {
    const detail = await getAuditResultDetail(
      { userId: authz.session.userId, auditFirmId: authz.session.auditFirmId },
      params.id,
    );
    return NextResponse.json({ result: detail });
  } catch (e) {
    return runErrorResponse(e);
  }
}
