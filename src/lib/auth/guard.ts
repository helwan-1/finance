import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, type SessionUser } from "./session";
import { can, type Permission } from "./rbac";

/**
 * Authorize a data request.
 *
 * Layers, in order:
 *   1. Authentication — a valid session. When AUTH_REQUIRED=true, a missing
 *      session is rejected (401). Otherwise the public demo is allowed through
 *      with a null session so the dashboard renders without login.
 *   2. RBAC — the session's role must hold `permission` (403 otherwise).
 *   3. Tenant isolation — an authenticated user may only touch an engagement
 *      that belongs to their own audit firm (403 otherwise).
 *
 * Returns either a short-circuit `response` to return immediately, or `ok` with
 * the resolved session (null in demo mode).
 */
export type AuthzResult =
  | { ok: true; session: SessionUser | null }
  | { ok: false; response: NextResponse };

function deny(status: number, message: string): AuthzResult {
  return { ok: false, response: NextResponse.json({ error: message }, { status }) };
}

export async function authorize(
  permission: Permission,
  engagementId?: string | null,
): Promise<AuthzResult> {
  const session = await getSession();

  if (!session) {
    if (process.env.AUTH_REQUIRED === "true") {
      return deny(401, "Authentication required");
    }
    // Demo mode: proceed without a session.
    return { ok: true, session: null };
  }

  if (!can(session.role, permission)) {
    return deny(403, "Insufficient permissions");
  }

  // Tenant isolation: the engagement must belong to the caller's firm.
  if (engagementId) {
    const engagement = await prisma.auditEngagement.findUnique({
      where: { id: engagementId },
      select: { auditFirmId: true },
    });
    if (engagement && engagement.auditFirmId !== session.auditFirmId) {
      return deny(403, "Cross-tenant access denied");
    }
  }

  return { ok: true, session };
}
