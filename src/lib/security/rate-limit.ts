/**
 * In-memory sliding-window rate limiter (G1 — login abuse protection).
 *
 * Deliberately dependency-free and process-local: it protects a single app
 * instance without introducing external infrastructure. State is kept on
 * globalThis so dev HMR does not reset it.
 *
 * SECURITY BOUNDARY (SEC-DEBT-009) — the guarantee this control provides:
 *   * Single process / single limiter-state domain: ENFORCED.
 *   * Horizontally scaled / multi-instance: NOT SUFFICIENT — each instance
 *     keeps its own counters, so the effective limit multiplies by the
 *     instance count.
 *
 * DEPLOYMENT INVARIANT: this limiter is an accepted control ONLY while
 * authentication traffic is handled within a single limiter-state domain.
 * Before any multi-instance production deployment, login-abuse state MUST be
 * shared across instances (a distributed/shared rate-limit store) or enforced
 * by an equivalent upstream layer (e.g. gateway/WAF). This Map is the seam for
 * that shared store; call sites do not change. See docs/SECURITY-DEBT.md.
 */
export interface RateLimitOptions {
  /** Window length in milliseconds. */
  windowMs: number;
  /** Maximum allowed hits within the window. */
  max: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Seconds until the caller may retry (0 when allowed). */
  retryAfterSec: number;
}

const globalForRate = globalThis as unknown as {
  __rateBuckets?: Map<string, number[]>;
};
const buckets: Map<string, number[]> =
  globalForRate.__rateBuckets ?? (globalForRate.__rateBuckets = new Map());

let lastPrune = 0;

/** Record a hit for `key` and report whether it is within the limit. */
export function rateLimit(key: string, opts: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  const windowStart = now - opts.windowMs;

  // Occasional prune so idle keys don't accumulate unbounded.
  if (now - lastPrune > opts.windowMs) {
    for (const [k, ts] of buckets) {
      const kept = ts.filter((t) => t > windowStart);
      if (kept.length === 0) buckets.delete(k);
      else buckets.set(k, kept);
    }
    lastPrune = now;
  }

  const hits = (buckets.get(key) ?? []).filter((t) => t > windowStart);
  if (hits.length >= opts.max) {
    const retryAfterSec = Math.max(
      1,
      Math.ceil((hits[0]! + opts.windowMs - now) / 1000),
    );
    buckets.set(key, hits);
    return { allowed: false, remaining: 0, retryAfterSec };
  }

  hits.push(now);
  buckets.set(key, hits);
  return { allowed: true, remaining: opts.max - hits.length, retryAfterSec: 0 };
}

/** Test helper: clear all rate-limit state. */
export function __resetRateLimit(): void {
  buckets.clear();
  lastPrune = 0;
}
