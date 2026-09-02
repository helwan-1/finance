import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { getSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { requireSession } from "@/lib/auth/guard";
import { demoAllowed } from "@/lib/security/env";
import { withTenantContext } from "@/lib/db/tenant";
import { ROLE_LABELS_AR } from "@/lib/labels";
import { DEFAULT_FIRM_SETTINGS, normalizeSettings } from "@/lib/settings";
import type { SettingsResponse } from "@/lib/ui-types";

const DEMO_SETTINGS: SettingsResponse = {
  firmNameAr: "نسخة تجريبية",
  licenseNo: "—",
  userNameAr: null,
  role: null,
  canEdit: false,
  settings: DEFAULT_FIRM_SETTINGS,
};

/** GET /api/settings — firm profile + audit configuration for the current user. */
export async function GET(): Promise<NextResponse> {
  const session = await getSession();
  if (!session) {
    // Non-production demo only; production fails closed.
    if (demoAllowed()) return NextResponse.json<SettingsResponse>(DEMO_SETTINGS);
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  try {
    const firm = await withTenantContext(session.auditFirmId, (tx) =>
      tx.auditFirm.findUnique({
        where: { id: session.auditFirmId },
        select: { nameAr: true, licenseNo: true, settings: true },
      }),
    );
    return NextResponse.json<SettingsResponse>({
      firmNameAr: firm?.nameAr ?? "—",
      licenseNo: firm?.licenseNo ?? "—",
      userNameAr: session.fullNameAr,
      role: ROLE_LABELS_AR[session.role] ?? session.role,
      canEdit: can(session.role, "engagement:manage"),
      settings: normalizeSettings(firm?.settings),
    });
  } catch {
    return NextResponse.json({ error: "تعذّر تحميل الإعدادات" }, { status: 503 });
  }
}

/** PUT /api/settings — update firm audit configuration (requires engagement:manage). */
export async function PUT(request: NextRequest): Promise<NextResponse> {
  const auth = await requireSession("engagement:manage");
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const settings = normalizeSettings(body);
  try {
    await withTenantContext(auth.session.auditFirmId, (tx) =>
      tx.auditFirm.update({
        where: { id: auth.session.auditFirmId },
        data: { settings: settings as unknown as Prisma.InputJsonValue },
      }),
    );
    return NextResponse.json({ ok: true, settings });
  } catch {
    return NextResponse.json({ error: "تعذّر حفظ الإعدادات" }, { status: 503 });
  }
}
