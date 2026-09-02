import type { NextRequest } from "next/server";

/**
 * Structured security event logging (G1.13).
 *
 * Pre-authentication and boundary events (failed login, rate-limit trips,
 * authorization/CSRF denials) have no firm/user, so they cannot live in the
 * tenant-scoped AuditLog (which requires both). They are emitted here as a
 * structured server log line. Authenticated business actions continue to use
 * recordAuditLog(). A durable, tenant-aware security-event store is deferred to
 * the later Reporting / Audit File gate.
 *
 * NEVER pass secrets here: no passwords, tokens, cookies, connection strings,
 * AUTH_SECRET, or client financial payloads. Only coarse metadata.
 */
export type SecurityEvent =
  | "login_success"
  | "login_failed"
  | "login_rate_limited"
  | "auth_denied"
  | "permission_denied"
  | "csrf_blocked"
  | "config_invalid";

export interface SecurityLogDetails {
  ip?: string | null;
  userAgent?: string | null;
  email?: string | null; // identifier only; never the password
  route?: string;
  reason?: string;
}

export function securityLog(
  event: SecurityEvent,
  details: SecurityLogDetails = {},
): void {
  const line = {
    tag: "security",
    event,
    at: new Date().toISOString(),
    ...details,
  };
  // Single structured line to stderr; safe to ship to a log aggregator.
  console.warn(JSON.stringify(line));
}

/** Extract non-sensitive request metadata for audit/security logging. */
export function requestMeta(req: NextRequest): {
  ip: string | null;
  userAgent: string | null;
} {
  const fwd = req.headers.get("x-forwarded-for");
  const ip = fwd ? (fwd.split(",")[0] ?? "").trim() || null : null;
  return { ip, userAgent: req.headers.get("user-agent") };
}
