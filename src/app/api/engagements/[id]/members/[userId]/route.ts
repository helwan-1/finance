import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth/guard";
import { withTenantContext } from "@/lib/db/tenant";
import { demoAllowed } from "@/lib/security/env";

/**
 * DELETE /api/engagements/:id/members/:userId — remove a member from the
 * engagement. Refuses to remove the last remaining member (an engagement with no
 * members can never be acted on again). Gated on engagement:manage.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string; userId: string } },
): Promise<NextResponse> {
  const auth = await requireSession("engagement:manage");
  if (!auth.ok) return auth.response;

  try {
    await withTenantContext(auth.session.auditFirmId, async (tx) => {
      const engagement = await tx.auditEngagement.findUnique({
        where: { id: params.id },
        select: { id: true },
      });
      if (!engagement) throw new Error("ENGAGEMENT_NOT_FOUND");
      const count = await tx.engagementMember.count({ where: { engagementId: params.id } });
      if (count <= 1) throw new Error("LAST_MEMBER");
      const deleted = await tx.engagementMember.deleteMany({
        where: { engagementId: params.id, userId: params.userId },
      });
      if (deleted.count === 0) throw new Error("MEMBER_NOT_FOUND");
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof Error && e.message === "ENGAGEMENT_NOT_FOUND") {
      return NextResponse.json({ error: "المهمة غير موجودة" }, { status: 404 });
    }
    if (e instanceof Error && e.message === "MEMBER_NOT_FOUND") {
      return NextResponse.json({ error: "العضو غير موجود في هذه المهمة" }, { status: 404 });
    }
    if (e instanceof Error && e.message === "LAST_MEMBER") {
      return NextResponse.json(
        { error: "لا يمكن إزالة آخر عضو في المهمة" },
        { status: 400 },
      );
    }
    console.error("[members:remove] failed", e);
    const detail = demoAllowed() && e instanceof Error ? e.message : undefined;
    return NextResponse.json(
      { error: "تعذّر إزالة العضو", ...(detail ? { detail } : {}) },
      { status: 503 },
    );
  }
}
