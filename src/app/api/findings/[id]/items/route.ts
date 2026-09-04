import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { requireSession } from "@/lib/auth/guard";
import { createFinding } from "@/lib/g5/finding";
import type { FindingContentInput } from "@/lib/g5/finding";
import { g5ErrorResponse } from "@/lib/g5/http-errors";
import { parseFindingContent } from "@/lib/g5/parse-content";

interface Body {
  engagementId?: unknown;
  content?: unknown;
}

/**
 * POST /api/findings/[id]/items — create a finding (its first version) under the
 * exception [id]. Body: { engagementId, content: FindingContentInput }.
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

  const engagementId = typeof body.engagementId === "string" ? body.engagementId.trim() : "";
  if (!engagementId) {
    return NextResponse.json({ error: "engagementId مطلوب" }, { status: 400 });
  }
  const content: FindingContentInput | null = parseFindingContent(body.content);
  if (!content) {
    return NextResponse.json(
      { error: "محتوى النتيجة ناقص (الفئة والحالة والمعيار والسبب والأثر والاستنتاج مطلوبة)" },
      { status: 400 },
    );
  }

  try {
    const out = await createFinding(auth.session.auditFirmId, {
      exceptionId: params.id,
      engagementId,
      createdById: auth.session.userId,
      content,
      idempotencyKey: randomUUID(),
    });
    return NextResponse.json(out, { status: 201 });
  } catch (e) {
    return g5ErrorResponse(e);
  }
}
