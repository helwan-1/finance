import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/auth/password";
import { createSessionToken, setSessionCookie } from "@/lib/auth/session";
import { recordAuditLog } from "@/lib/audit-log";
import { rateLimit } from "@/lib/security/rate-limit";
import { securityLog, requestMeta } from "@/lib/security/log";

interface LoginBody {
  email?: string;
  password?: string;
}

// Login abuse thresholds (per rolling 15 minutes).
const WINDOW_MS = 15 * 60 * 1000;
const MAX_PER_IP_EMAIL = 10; // credential-stuffing a single account
const MAX_PER_IP = 30; // spraying many accounts from one source

/** POST /api/auth/login — verify credentials and issue a session cookie. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const { ip, userAgent } = requestMeta(request);

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

  // Rate limit before touching the database (brute-force / credential stuffing).
  const ipKey = `login:ip:${ip ?? "unknown"}`;
  const idKey = `login:id:${ip ?? "unknown"}:${email}`;
  const rlIp = rateLimit(ipKey, { windowMs: WINDOW_MS, max: MAX_PER_IP });
  const rlId = rateLimit(idKey, { windowMs: WINDOW_MS, max: MAX_PER_IP_EMAIL });
  if (!rlIp.allowed || !rlId.allowed) {
    const retryAfter = Math.max(rlIp.retryAfterSec, rlId.retryAfterSec);
    securityLog("login_rate_limited", { ip, userAgent, email, route: "/api/auth/login" });
    return NextResponse.json(
      { error: "محاولات كثيرة. حاول لاحقاً." },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  try {
    // Pre-auth lookup via a SECURITY DEFINER function: login runs before any
    // tenant context exists, so a normal RLS-scoped read of "users" is empty.
    const rows = await prisma.$queryRaw<
      {
        id: string;
        auditFirmId: string;
        role: UserRole;
        fullNameAr: string;
        passwordHash: string;
      }[]
    >`SELECT * FROM app_authenticate(${email})`;
    const user = rows[0] ?? null;

    // Uniform failure to avoid leaking which emails exist.
    const ok = user ? await verifyPassword(password, user.passwordHash) : false;
    if (!user || !ok) {
      securityLog("login_failed", { ip, userAgent, email, route: "/api/auth/login" });
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
      ipAddress: ip,
      userAgent,
    });
    securityLog("login_success", { ip, userAgent, email, route: "/api/auth/login" });

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
