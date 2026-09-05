import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth/guard";
import { sealRunPreparation } from "@/lib/g4/app/run-access";
import { runErrorResponse } from "@/lib/g4/app/http";

interface Body {
  prepId?: unknown;
}

/**
 * POST /api/runs/:id/preparation/seal — seal a COMPLETE preparation generation.
 * The prepId must belong to the run (verified under RLS in the boundary).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const auth = await requireSession("runs:manage");
  if (!auth.ok) return auth.response;

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body", code: "VALIDATION" }, { status: 422 });
  }
  const prepId = typeof body.prepId === "string" ? body.prepId.trim() : "";
  if (!prepId) return NextResponse.json({ error: "prepId is required", code: "VALIDATION" }, { status: 422 });

  try {
    const out = await sealRunPreparation(
      { userId: auth.session.userId, auditFirmId: auth.session.auditFirmId },
      params.id,
      prepId,
    );
    return NextResponse.json(out, { status: 200 });
  } catch (e) {
    return runErrorResponse(e);
  }
}
