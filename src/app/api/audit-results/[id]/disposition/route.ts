import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { requireSession } from "@/lib/auth/guard";
import { recordResultDisposition } from "@/lib/g5/disposition";
import type { DispositionAction } from "@/lib/g5/disposition";
import { g5ErrorResponse } from "@/lib/g5/http-errors";
import type { DispositionActionKind } from "@/lib/ui-types";

const ACTIONS: DispositionActionKind[] = [
  "MARK_UNDER_REVIEW",
  "MARK_NOT_RELEVANT",
  "MARK_FALSE_POSITIVE",
  "MARK_EXPLAINED",
  "REQUIRE_INVESTIGATION",
];

interface Body {
  action?: unknown;
  note?: unknown;
}

/**
 * POST /api/audit-results/[id]/disposition — record a professional disposition
 * against a G4 audit result. Body: { action, note? }. The actor must be an
 * engagement member (DB-enforced). Returns the new derived state.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const auth = await requireSession("findings:manage");
  if (!auth.ok) return auth.response;

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body.action !== "string" || !ACTIONS.includes(body.action as DispositionActionKind)) {
    return NextResponse.json({ error: "إجراء غير صالح" }, { status: 400 });
  }
  const note = typeof body.note === "string" && body.note.trim() ? body.note.trim() : null;

  try {
    const result = await recordResultDisposition(auth.session.auditFirmId, {
      auditResultId: params.id,
      actorId: auth.session.userId,
      action: body.action as DispositionAction,
      note,
      idempotencyKey: randomUUID(),
    });
    return NextResponse.json({ currentState: result.currentState });
  } catch (e) {
    return g5ErrorResponse(e);
  }
}
