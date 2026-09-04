import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { requireSession } from "@/lib/auth/guard";
import type { Permission } from "@/lib/auth/rbac";
import { reviseFinding, submitFinding, reviewFinding } from "@/lib/g5/finding";
import { g5ErrorResponse } from "@/lib/g5/http-errors";
import { parseFindingContent } from "@/lib/g5/parse-content";

interface Body {
  action?: unknown;
  content?: unknown;
  reviewAction?: unknown;
  findingVersionId?: unknown;
  note?: unknown;
}

/**
 * PATCH /api/findings/items/[findingId] — finding lifecycle.
 * Body:
 *   { action: "REVISE", content }                    → findings:manage
 *   { action: "SUBMIT" }                             → findings:manage
 *   { action: "REVIEW", reviewAction: "APPROVE" | "RETURN", findingVersionId, note? }
 *                                                     → findings:review
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { findingId: string } },
): Promise<NextResponse> {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const action = body.action;
  const perm: Permission = action === "REVIEW" ? "findings:review" : "findings:manage";
  const auth = await requireSession(perm);
  if (!auth.ok) return auth.response;

  const firm = auth.session.auditFirmId;
  const actorId = auth.session.userId;
  const findingId = params.findingId;

  try {
    if (action === "REVISE") {
      const content = parseFindingContent(body.content);
      if (!content) {
        return NextResponse.json({ error: "محتوى النتيجة ناقص" }, { status: 400 });
      }
      await reviseFinding(firm, {
        findingId,
        preparedById: actorId,
        content,
        idempotencyKey: randomUUID(),
      });
    } else if (action === "SUBMIT") {
      await submitFinding(firm, {
        findingId,
        actorId,
        idempotencyKey: randomUUID(),
      });
    } else if (action === "REVIEW") {
      const reviewAction = body.reviewAction;
      if (reviewAction !== "APPROVE" && reviewAction !== "RETURN") {
        return NextResponse.json(
          { error: "reviewAction يجب أن يكون APPROVE أو RETURN" },
          { status: 400 },
        );
      }
      const findingVersionId =
        typeof body.findingVersionId === "string" ? body.findingVersionId.trim() : "";
      if (!findingVersionId) {
        return NextResponse.json({ error: "findingVersionId مطلوب" }, { status: 400 });
      }
      const note = typeof body.note === "string" && body.note.trim() ? body.note.trim() : null;
      await reviewFinding(firm, {
        findingId,
        actorId,
        action: reviewAction,
        findingVersionId,
        note,
        idempotencyKey: randomUUID(),
      });
    } else {
      return NextResponse.json(
        { error: "action يجب أن يكون REVISE أو SUBMIT أو REVIEW" },
        { status: 400 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return g5ErrorResponse(e);
  }
}
