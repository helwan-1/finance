import { NextResponse } from "next/server";
import { getSession, type SessionUser } from "./session";
import { can, type Permission } from "./rbac";
import { authEnforced } from "@/lib/security/env";

/**
 * Authorization guards (G1 — fail-closed).
 *
 * Two entry points:
 *   * authorize()      — read paths. In production (or when AUTH_REQUIRED=true)
 *                        a missing session is rejected (401). Only outside
 *                        production may it fall through with a null session so
 *                        the public in-memory demo renders.
 *   * requireSession() — write / sensitive paths. A missing session is ALWAYS
 *                        rejected (401) in every environment.
 *
 * Tenant isolation is NOT performed here by querying the database. It is
 * enforced at the data layer by PostgreSQL Row-Level Security combined with the
 * per-transaction tenant context set in withTenantContext() (src/lib/db/tenant).
 * A caller's audit firm always comes from the verified session, never from a
 * client-supplied id.
 */
export type AuthzResult =
  | { ok: true; session: SessionUser | null }
  | { ok: false; response: NextResponse };

export type SessionResult =
  | { ok: true; session: SessionUser }
  | { ok: false; response: NextResponse };

function deny(status: number, message: string): { ok: false; response: NextResponse } {
  return { ok: false, response: NextResponse.json({ error: message }, { status }) };
}

/** Read-path guard: enforced auth in production, demo fallthrough otherwise. */
export async function authorize(permission: Permission): Promise<AuthzResult> {
  const session = await getSession();

  if (!session) {
    if (authEnforced()) {
      return deny(401, "Authentication required");
    }
    // Non-production demo mode only: proceed without a session.
    return { ok: true, session: null };
  }

  if (!can(session.role, permission)) {
    return deny(403, "Insufficient permissions");
  }
  return { ok: true, session };
}

/** Write-path guard: a valid session is mandatory in every environment. */
export async function requireSession(
  permission: Permission,
): Promise<SessionResult> {
  const session = await getSession();
  if (!session) {
    return deny(401, "Authentication required");
  }
  if (!can(session.role, permission)) {
    return deny(403, "Insufficient permissions");
  }
  return { ok: true, session };
}
