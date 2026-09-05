import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authorize } from "@/lib/auth/guard";
import { getRunJobs } from "@/lib/g4/app/run-access";
import { runErrorResponse } from "@/lib/g4/app/http";

/** GET /api/runs/:id/jobs — attempt history for the run, gated on membership. */
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const authz = await authorize("runs:view");
  if (!authz.ok) return authz.response;
  if (!authz.session) return NextResponse.json({ jobs: [] });

  try {
    const jobs = await getRunJobs({ userId: authz.session.userId, auditFirmId: authz.session.auditFirmId }, params.id);
    return NextResponse.json({ jobs });
  } catch (e) {
    return runErrorResponse(e);
  }
}
