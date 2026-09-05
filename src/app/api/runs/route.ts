import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authorize, requireSession } from "@/lib/auth/guard";
import { createRun, listRunsForEngagement } from "@/lib/g4/app/run-access";
import { runErrorResponse } from "@/lib/g4/app/http";

/**
 * GET /api/runs?engagementId=... — list AuditRuns for an engagement the caller
 * is a member of. POST /api/runs — create a DRAFT run in such an engagement.
 * Firm is taken from the session; membership is enforced in the boundary.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const authz = await authorize("runs:view");
  if (!authz.ok) return authz.response;

  const engagementId = new URL(request.url).searchParams.get("engagementId");
  // Demo fallthrough (no session, non-production): never expose tenant data.
  if (!authz.session || !engagementId) return NextResponse.json({ runs: [] });

  try {
    const runs = await listRunsForEngagement(
      { userId: authz.session.userId, auditFirmId: authz.session.auditFirmId },
      engagementId,
    );
    return NextResponse.json({ runs });
  } catch (e) {
    return runErrorResponse(e);
  }
}

interface CreateBody {
  engagementId?: unknown;
  maxAttempts?: unknown;
  label?: unknown;
  supersedesRunId?: unknown;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireSession("runs:manage");
  if (!auth.ok) return auth.response;

  let body: CreateBody;
  try {
    body = (await request.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const engagementId = typeof body.engagementId === "string" ? body.engagementId.trim() : "";
  if (!engagementId) return NextResponse.json({ error: "engagementId is required" }, { status: 400 });
  const maxAttempts = typeof body.maxAttempts === "number" ? body.maxAttempts : undefined;
  const label = typeof body.label === "string" && body.label.trim() ? body.label.trim() : null;
  const supersedesRunId = typeof body.supersedesRunId === "string" && body.supersedesRunId.trim() ? body.supersedesRunId.trim() : null;

  try {
    const { runId } = await createRun(
      { userId: auth.session.userId, auditFirmId: auth.session.auditFirmId },
      { engagementId, maxAttempts, label, supersedesRunId },
    );
    return NextResponse.json({ runId }, { status: 201 });
  } catch (e) {
    return runErrorResponse(e);
  }
}
