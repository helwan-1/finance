import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { ROLE_LABELS_AR } from "@/lib/labels";
import { DEFAULT_FIRM_SETTINGS, normalizeSettings } from "@/lib/settings";
import type { SettingsResponse } from "@/lib/ui-types";

/** GET /api/settings — firm profile + audit configuration for the current user. */
export async function GET(): Promise<NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json<SettingsResponse>({
      firmNameAr: "نسخة تجريبية",
      licenseNo: "—",
      userNameAr: null,
      role: null,
      canEdit: false,
      settings: DEFAULT_FIRM_SETTINGS,
    });
  }
  try {
    const firm = await prisma.auditFirm.findUnique({
      where: { id: session.auditFirmId },
      select: { nameAr: true, licenseNo: true, settings: true },
    });
    return NextResponse.json<SettingsResponse>({
      firmNameAr: firm?.nameAr ?? "—",
      licenseNo: firm?.licenseNo ?? "—",
      userNameAr: session.fullNameAr,
      role: ROLE_LABELS_AR[session.role] ?? session.role,
      canEdit: can(session.role, "engagement:manage"),
      settings: normalizeSettings(firm?.settings),
    });
  } catch {
    return NextResponse.json<SettingsResponse>({
      firmNameAr: "—",
      licenseNo: "—",
      userNameAr: session.fullNameAr,
      role: session.role,
      canEdit: false,
      settings: DEFAULT_FIRM_SETTINGS,
    });
  }
}

/** PUT /api/settings — update firm audit configuration (requires engagement:manage). */
export async function PUT(request: NextRequest): Promise<NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  if (!can(session.role, "engagement:manage")) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const settings = normalizeSettings(body);
  try {
    await prisma.auditFirm.update({
      where: { id: session.auditFirmId },
      data: { settings: settings as unknown as Prisma.InputJsonValue },
    });
    return NextResponse.json({ ok: true, settings });
  } catch {
    return NextResponse.json({ error: "تعذّر حفظ الإعدادات" }, { status: 503 });
  }
}
