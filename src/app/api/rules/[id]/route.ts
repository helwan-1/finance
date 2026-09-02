import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth/guard";
import { withTenantContext, type TenantTx } from "@/lib/db/tenant";

/** Verify the rule exists in the caller's tenant (RLS-scoped). */
async function ruleExists(tx: TenantTx, id: string): Promise<boolean> {
  const rule = await tx.auditRule.findUnique({
    where: { id },
    select: { id: true },
  });
  return rule !== null;
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
  const auth = await requireSession("rules:manage");
  if (!auth.ok) return auth.response;

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const found = await withTenantContext(auth.session.auditFirmId, async (tx) => {
      if (!(await ruleExists(tx, params.id))) return false;
      await tx.auditRule.update({
        where: { id: params.id },
        data: {
          ...(typeof body.enabled === "boolean" ? { enabled: body.enabled } : {}),
          ...(body.nameAr ? { nameAr: body.nameAr.trim() } : {}),
          ...(body.severity ? { severity: body.severity as never } : {}),
          ...(body.descriptionAr !== undefined
            ? { descriptionAr: body.descriptionAr }
            : {}),
        },
      });
      return true;
    });
    if (!found) return NextResponse.json({ error: "Not found" }, { status: 404 });
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
  const auth = await requireSession("rules:manage");
  if (!auth.ok) return auth.response;

  try {
    const found = await withTenantContext(auth.session.auditFirmId, async (tx) => {
      if (!(await ruleExists(tx, params.id))) return false;
      await tx.auditRule.delete({ where: { id: params.id } });
      return true;
    });
    if (!found) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "تعذّر حذف القاعدة" }, { status: 503 });
  }
}
