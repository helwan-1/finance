import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth/guard";
import { withTenantContext } from "@/lib/db/tenant";
import { demoAllowed } from "@/lib/security/env";

/**
 * GET /api/engagements/:id/members — the engagement's members (with the user's
 * name/role for display). Gated on engagement:manage; RLS scopes every row to
 * the caller's firm.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const auth = await requireSession("engagement:manage");
  if (!auth.ok) return auth.response;
  try {
    const rows = await withTenantContext(auth.session.auditFirmId, async (tx) => {
      const engagement = await tx.auditEngagement.findUnique({
        where: { id: params.id },
        select: { id: true },
      });
      if (!engagement) throw new Error("ENGAGEMENT_NOT_FOUND");
      return tx.engagementMember.findMany({
        where: { engagementId: params.id },
        orderBy: { assignedAt: "asc" },
        select: {
          userId: true,
          assignedAt: true,
          user: { select: { fullNameAr: true, email: true, role: true } },
        },
      });
    });
    const members = rows.map((m) => ({
      userId: m.userId,
      assignedAt: m.assignedAt.toISOString(),
      fullNameAr: m.user.fullNameAr,
      email: m.user.email,
      role: m.user.role,
    }));
    return NextResponse.json({ members });
  } catch (e) {
    if (e instanceof Error && e.message === "ENGAGEMENT_NOT_FOUND") {
      return NextResponse.json({ error: "المهمة غير موجودة" }, { status: 404 });
    }
    return NextResponse.json({ error: "تعذّر تحميل أعضاء المهمة" }, { status: 503 });
  }
}

interface AddBody {
  userId?: string;
}

/**
 * POST /api/engagements/:id/members — add a firm user to the engagement.
 * Idempotent: adding an existing member succeeds without error. The target user
 * must belong to the caller's firm (RLS-scoped lookup).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const auth = await requireSession("engagement:manage");
  if (!auth.ok) return auth.response;

  let body: AddBody;
  try {
    body = (await request.json()) as AddBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const userId = body.userId?.trim();
  if (!userId) {
    return NextResponse.json({ error: "اختر مستخدمًا لإضافته" }, { status: 400 });
  }

  try {
    await withTenantContext(auth.session.auditFirmId, async (tx) => {
      const engagement = await tx.auditEngagement.findUnique({
        where: { id: params.id },
        select: { id: true },
      });
      if (!engagement) throw new Error("ENGAGEMENT_NOT_FOUND");
      const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true } });
      if (!user) throw new Error("USER_NOT_FOUND");
      const existing = await tx.engagementMember.findUnique({
        where: { engagementId_userId: { engagementId: params.id, userId } },
        select: { userId: true },
      });
      if (existing) return; // idempotent — already a member
      await tx.engagementMember.create({ data: { engagementId: params.id, userId } });
    });
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (e) {
    if (e instanceof Error && e.message === "ENGAGEMENT_NOT_FOUND") {
      return NextResponse.json({ error: "المهمة غير موجودة" }, { status: 404 });
    }
    if (e instanceof Error && e.message === "USER_NOT_FOUND") {
      return NextResponse.json({ error: "المستخدم غير موجود في هذا المكتب" }, { status: 400 });
    }
    console.error("[members:add] failed", e);
    const detail = demoAllowed() && e instanceof Error ? e.message : undefined;
    return NextResponse.json(
      { error: "تعذّر إضافة العضو", ...(detail ? { detail } : {}) },
      { status: 503 },
    );
  }
}
