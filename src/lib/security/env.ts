/**
 * Production security policy (G1 — fail-closed).
 *
 * The single source of truth for "is authentication enforced?" and "is the
 * public demo path allowed?". The overriding rule:
 *
 *   * In production (NODE_ENV=production) authentication is ALWAYS enforced.
 *     There is no demo/no-auth path. AUTH_REQUIRED can only tighten, never
 *     loosen — it cannot re-open the demo path in production.
 *   * Outside production the in-memory demo path is allowed unless
 *     AUTH_REQUIRED=true forces authentication.
 *
 * Secrets are validated here too, so a weak/placeholder AUTH_SECRET can never
 * be used to sign real sessions in production. No secret value is ever included
 * in an error message or log.
 */

/** Known placeholder/example secrets that must never be used in production. */
const WEAK_SECRETS = new Set<string>([
  "change-me-to-a-long-random-string",
  "changeme",
  "secret",
  "password",
  "development",
  "test-secret",
  "unit-test-secret-please-change-0123456789",
]);

const MIN_SECRET_LEN_DEV = 16;
const MIN_SECRET_LEN_PROD = 32;

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * Whether every API route must have an authenticated session.
 * Production: always true. Non-production: true only if AUTH_REQUIRED=true.
 */
export function authEnforced(): boolean {
  return isProduction() || process.env.AUTH_REQUIRED === "true";
}

/** Whether the public in-memory demo path may be served (never in production). */
export function demoAllowed(): boolean {
  return !authEnforced();
}

/**
 * Validate and return the session-signing secret. Throws a message that never
 * contains the secret. In production the bar is higher (length + not a known
 * placeholder) so a misconfigured deploy fails closed instead of signing
 * sessions with a guessable key.
 */
export function getSessionSecret(): string {
  const secret = process.env.AUTH_SECRET;
  const prod = isProduction();
  const min = prod ? MIN_SECRET_LEN_PROD : MIN_SECRET_LEN_DEV;

  if (!secret || secret.length < min) {
    throw new Error(
      `AUTH_SECRET must be set and at least ${min} characters ` +
        `(${prod ? "production" : "development"} minimum).`,
    );
  }
  if (prod && WEAK_SECRETS.has(secret)) {
    throw new Error(
      "AUTH_SECRET is a known placeholder value and must not be used in production.",
    );
  }
  return secret;
}

/**
 * Assert the process is safely configured to serve authenticated traffic.
 * Intended to be called from a startup path; in production a failure should
 * prevent the app from serving requests (fail-closed). Returns the list of
 * problems (empty when healthy) rather than throwing, so callers can decide.
 */
export function checkSecurityConfig(): string[] {
  const problems: string[] = [];
  try {
    getSessionSecret();
  } catch (e) {
    problems.push(e instanceof Error ? e.message : "Invalid AUTH_SECRET");
  }
  if (isProduction() && process.env.AUTH_REQUIRED === "false") {
    // Not fatal (production ignores it), but flag the misleading config.
    problems.push(
      "AUTH_REQUIRED=false is ignored in production; authentication is always enforced.",
    );
  }
  return problems;
}
