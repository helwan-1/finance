import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/auth/password";
import { createSessionToken, setSessionCookie } from "@/lib/auth/session";
import { recordAuditLog } from "@/lib/audit-log";

interface LoginBody {
  email?: string;
  password?: string;
}

/** POST /api/auth/login — verify credentials and issue a session cookie. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: LoginBody;
  try {
    body = (await request.json()) as LoginBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase();
  const password = body.password ?? "";
  if (!email || !password) {
    return NextResponse.json(
      { error: "البريد الإلكتروني وكلمة المرور مطلوبان" },
      { status: 400 },
    );
  }

  try {
    const user = await prisma.user.findFirst({
      where: { email, isActive: true },
    });

    // Uniform failure to avoid leaking which emails exist.
    const ok = user ? await verifyPassword(password, user.passwordHash) : false;
    if (!user || !ok) {
      return NextResponse.json(
        { error: "بيانات الدخول غير صحيحة" },
        { status: 401 },
      );
    }

    const token = await createSessionToken({
      userId: user.id,
      auditFirmId: user.auditFirmId,
      role: user.role,
      fullNameAr: user.fullNameAr,
    });
    await setSessionCookie(token);

    await recordAuditLog({
      auditFirmId: user.auditFirmId,
      userId: user.id,
      action: "LOGIN",
      entityType: "User",
      entityId: user.id,
    });

    return NextResponse.json({
      user: {
        id: user.id,
        fullNameAr: user.fullNameAr,
        role: user.role,
      },
    });
  } catch {
    return NextResponse.json(
      { error: "تعذّر الاتصال بالخدمة" },
      { status: 503 },
    );
  }
}
