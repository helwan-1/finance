import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authorize } from "@/lib/auth/guard";
import { getRun } from "@/lib/g4/app/run-access";
import { runErrorResponse } from "@/lib/g4/app/http";

/** GET /api/runs/:id — run detail, gated on engagement membership. */
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const authz = await authorize("runs:view");
  if (!authz.ok) return authz.response;
  if (!authz.session) return NextResponse.json({ error: "run not found" }, { status: 404 });

  try {
    const run = await getRun({ userId: authz.session.userId, auditFirmId: authz.session.auditFirmId }, params.id);
    return NextResponse.json({ run });
  } catch (e) {
    return runErrorResponse(e);
  }
}
