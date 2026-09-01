import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";

async function requireManage() {
  const session = await getSession();
  if (!session) {
    return { ok: false as const, res: NextResponse.json({ error: "Authentication required" }, { status: 401 }) };
  }
  if (!can(session.role, "rules:manage")) {
    return { ok: false as const, res: NextResponse.json({ error: "Insufficient permissions" }, { status: 403 }) };
  }
  return { ok: true as const, session };
}

/** Verify the rule exists and belongs to the caller's firm. */
async function ownedRule(id: string, auditFirmId: string) {
  const rule = await prisma.auditRule.findUnique({
    where: { id },
    select: { auditFirmId: true },
  });
  if (!rule) return "not_found" as const;
  if (rule.auditFirmId !== auditFirmId) return "forbidden" as const;
  return "ok" as const;
}

interface PatchBody {
  enabled?: boolean;
  nameAr?: string;
  severity?: string;
  descriptionAr?: string;
}

/** PATCH /api/rules/:id — toggle enabled or edit fields (requires rules:manage). */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const auth = await requireManage();
  if (!auth.ok) return auth.res;

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const status = await ownedRule(params.id, auth.session.auditFirmId);
    if (status === "not_found") return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (status === "forbidden") return NextResponse.json({ error: "Cross-tenant access denied" }, { status: 403 });

    await prisma.auditRule.update({
      where: { id: params.id },
      data: {
        ...(typeof body.enabled === "boolean" ? { enabled: body.enabled } : {}),
        ...(body.nameAr ? { nameAr: body.nameAr.trim() } : {}),
        ...(body.severity ? { severity: body.severity as never } : {}),
        ...(body.descriptionAr !== undefined ? { descriptionAr: body.descriptionAr } : {}),
      },
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "تعذّر تحديث القاعدة" }, { status: 503 });
  }
}

/** DELETE /api/rules/:id — remove a rule (requires rules:manage). */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const auth = await requireManage();
  if (!auth.ok) return auth.res;

  try {
    const status = await ownedRule(params.id, auth.session.auditFirmId);
    if (status === "not_found") return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (status === "forbidden") return NextResponse.json({ error: "Cross-tenant access denied" }, { status: 403 });

    await prisma.auditRule.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "تعذّر حذف القاعدة" }, { status: 503 });
  }
}
