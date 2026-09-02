import { isProduction } from "@/lib/security/env";

/**
 * G4 engine build identity (ADR-G4-06 / D9 · B1). Server-controlled: injected at
 * build/deploy time via AUDIT_ENGINE_BUILD (ideally the immutable commit/build
 * SHA). NEVER from a request body, client input, or a runtime `git` call.
 *
 * Two accessors, one env source:
 *
 *   getEngineBuildVersion()            — LOOSE. For DRAFT/PREPARING ergonomics.
 *                                        Non-production may fall back to an
 *                                        explicitly-marked dev id. Production
 *                                        still fails closed.
 *
 *   getAttestableEngineBuildVersion()  — STRICT. Required to seal/freeze a
 *                                        reproducible QUEUED AuditRun in EVERY
 *                                        environment (tests included). Never
 *                                        returns a placeholder or dev fallback,
 *                                        because a frozen run that claims
 *                                        reproducibility must carry a
 *                                        build-specific identity that uniquely
 *                                        identifies its execution semantics.
 *                                        `dev:non-production` cannot — two
 *                                        different source builds would collide.
 */
const PLACEHOLDERS = new Set<string>(["", "0.1.0", "unknown", "changeme", "dev", "local"]);
const DEV_FALLBACK = "dev:non-production";

function rawBuild(): string {
  return (process.env.AUDIT_ENGINE_BUILD ?? "").trim();
}

/** A value that cannot attest a specific build (empty, known placeholder, or dev:*). */
function isNonAttestable(v: string): boolean {
  return !v || PLACEHOLDERS.has(v) || v.startsWith("dev:");
}

/**
 * Loose build identity for pre-freeze phases. Production fails closed; non-
 * production returns an explicit value if configured, else a marked dev id.
 */
export function getEngineBuildVersion(): string {
  const raw = rawBuild();
  if (isProduction()) {
    if (isNonAttestable(raw)) {
      throw new Error(
        "AUDIT_ENGINE_BUILD must be a trustworthy build/deploy-injected identifier in production; refusing to create/freeze an audit run without it.",
      );
    }
    return raw;
  }
  return raw && !PLACEHOLDERS.has(raw) ? raw : DEV_FALLBACK;
}

/**
 * Strict, build-specific identity REQUIRED to seal and freeze a reproducible
 * QUEUED AuditRun — in every environment, including non-production integration
 * tests. Read only from the server environment; there is no parameter through
 * which a caller could supply or spoof it. A run may not become an attestable
 * G4 AuditRun without it.
 */
export function getAttestableEngineBuildVersion(): string {
  const raw = rawBuild();
  if (isNonAttestable(raw)) {
    throw new Error(
      "AUDIT_ENGINE_BUILD must be a non-placeholder, build-specific identity to seal/freeze a reproducible audit run (QUEUED); refusing to proceed. " +
        "Set AUDIT_ENGINE_BUILD to an immutable build/deploy SHA server-side (tests may use test-build-<stable-id>).",
    );
  }
  return raw;
}
