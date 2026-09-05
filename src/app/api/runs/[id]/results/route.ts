import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authorize } from "@/lib/auth/guard";
import { getRunResults } from "@/lib/g4/app/run-access";
import { runErrorResponse } from "@/lib/g4/app/http";

/** GET /api/runs/:id/results — immutable audit results, gated on membership. */
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const authz = await authorize("runs:view");
  if (!authz.ok) return authz.response;
  if (!authz.session) return NextResponse.json({ results: [] });

  try {
    const results = await getRunResults({ userId: authz.session.userId, auditFirmId: authz.session.auditFirmId }, params.id);
    return NextResponse.json({ results });
  } catch (e) {
    return runErrorResponse(e);
  }
}
