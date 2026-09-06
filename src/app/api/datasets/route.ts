import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authorize } from "@/lib/auth/guard";
import { listDatasetsForEngagement } from "@/lib/g4/app/run-access";
import { runErrorResponse } from "@/lib/g4/app/http";

/** GET /api/datasets?engagementId=... — consumable datasets for run configuration. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const authz = await authorize("runs:view");
  if (!authz.ok) return authz.response;
  const engagementId = new URL(request.url).searchParams.get("engagementId");
  if (!authz.session || !engagementId) return NextResponse.json({ datasets: [] });
  try {
    const datasets = await listDatasetsForEngagement({ userId: authz.session.userId, auditFirmId: authz.session.auditFirmId }, engagementId);
    return NextResponse.json({ datasets });
  } catch (e) {
    return runErrorResponse(e);
  }
}
