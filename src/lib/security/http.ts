import type { NextRequest } from "next/server";

/**
 * HTTP security boundary helpers (G1) — used by the edge middleware.
 *   * securityHeaders(): a coherent, app-safe header set for every response.
 *   * isAllowedRequestOrigin(): the CSRF boundary for state-changing requests.
 */

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Response security headers. The CSP is deliberately app-compatible: Next.js
 * app-router injects inline bootstrap scripts and inline styles, so 'unsafe-
 * inline' is required until nonce-based hardening is introduced. 'unsafe-eval'
 * is allowed only outside production (webpack/react-refresh use it in dev).
 * frame-ancestors 'none' + X-Frame-Options DENY block clickjacking.
 */
export function securityHeaders(isProd: boolean): Record<string, string> {
  const scriptSrc = isProd
    ? "script-src 'self' 'unsafe-inline'"
    : "script-src 'self' 'unsafe-inline' 'unsafe-eval'";

  const csp = [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");

  const headers: Record<string, string> = {
    "Content-Security-Policy": csp,
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy":
      "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  };
  if (isProd) {
    // Only assert HSTS where the deployment guarantees HTTPS.
    headers["Strict-Transport-Security"] =
      "max-age=63072000; includeSubDomains; preload";
  }
  return headers;
}

/** Optional explicit allowlist (comma-separated origins) for non-browser clients. */
function allowlist(): string[] {
  return (process.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * CSRF boundary. Non-mutating methods always pass. State-changing methods must
 * carry an Origin whose host matches the request Host (same-origin) or is in the
 * ALLOWED_ORIGINS allowlist. A missing Origin on a mutation is rejected — the
 * cookie is SameSite=Lax, so a same-site browser fetch always sends Origin.
 */
export function isAllowedRequestOrigin(req: NextRequest): boolean {
  if (!MUTATING.has(req.method.toUpperCase())) return true;

  const origin = req.headers.get("origin");
  if (!origin) return false;

  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }

  const host = req.headers.get("host");
  if (host && originHost === host) return true;

  return allowlist().some((a) => {
    try {
      return new URL(a).host === originHost;
    } catch {
      return a === origin || a === originHost;
    }
  });
}
