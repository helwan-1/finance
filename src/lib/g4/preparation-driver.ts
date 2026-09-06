import { performance } from "node:perf_hooks";
import { withTenantContext } from "@/lib/db/tenant";
import { claimAndMaterializeBatch, sealPreparation, PreparationIncompleteError } from "./preparation";

/**
 * G6 Phase C3-2 — tenant-scoped background PREPARATION driver.
 *
 * Turns a run in (run PREPARING + preparation PREPARING) into a sealed
 * (preparation COMPLETE) state using ONLY the authoritative engine primitives
 * `claimAndMaterializeBatch` and `sealPreparation`. It NEVER publishes: after a
 * successful seal the preparation is COMPLETE while the run remains PREPARING,
 * so the authenticated human Publish is still required.
 *
 * It is a pure function of durable DB state — no queue, no lease, no in-memory
 * "already processed" set, no persisted retry/timing state — and is therefore
 * safe under at-least-once discovery: duplicate/reordered coordinates and crashes
 * are absorbed by the DB (SKIP-LOCKED claiming, monotonic chunk `done`, unique
 * scope members, status-guarded seal). It is bounded per invocation and safe to
 * invoke again immediately.
 *
 * The locator coordinate {auditFirmId, runId} is NON-authoritative: it is used
 * only to route into `auditFirmId`'s tenant context; the run/preparation are then
 * re-derived and re-validated under RLS. There is NO BYPASSRLS anywhere here.
 */

/** Outer orchestration bounds. The DB unit-tx bound (MAX_UNIT_TX_TIME_MS, 8s)
 *  remains authoritative for each batch; these bound the OUTER loop between
 *  transactions so one invocation never monopolizes a process or connection. */
export const DEFAULT_MAX_CLAIMS = 100;
export const DEFAULT_WALL_CLOCK_BUDGET_MS = 25_000; // a few 8s units; vendor-neutral

export interface DriveOptions {
  batchSize?: number;
  maxClaims?: number;
  wallClockBudgetMs?: number;
  /** Injectable monotonic clock (ms) — a narrow test seam. Defaults to a real
   *  process-monotonic clock; never a DB timestamp, never persisted. */
  now?: () => number;
}

export interface DriveProgress {
  chunksTotal: number;
  chunksDone: number;
  chunksRemaining: number;
}

/** Deterministic, testable driver outcome. No persistent states. */
export type PrepDriveOutcome =
  | { kind: "SEALED"; prepId: string; claims: number; idempotent: boolean }
  | { kind: "YIELDED"; prepId: string; claims: number; reason: "maxClaims" | "wallClock"; progress: DriveProgress }
  | { kind: "BUSY_YIELDED"; prepId: string; claims: number; unfinished: number; progress: DriveProgress }
  | { kind: "NOOP"; reason: "run_not_preparing" | "no_active_preparation" | "not_preparing" }
  | { kind: "DATA_ERROR"; detail: string; preparing: number };

async function readProgress(auditFirmId: string, prepId: string): Promise<DriveProgress> {
  return withTenantContext(auditFirmId, async (tx) => {
    const [chunksTotal, chunksDone] = await Promise.all([
      tx.auditRunPrepChunk.count({ where: { preparationId: prepId } }),
      tx.auditRunPrepChunk.count({ where: { preparationId: prepId, done: true } }),
    ]);
    return { chunksTotal, chunksDone, chunksRemaining: chunksTotal - chunksDone };
  });
}

/**
 * Drive the active preparation of `runId` within `auditFirmId` toward COMPLETE,
 * bounded by maxClaims AND wallClockBudgetMs (checked BETWEEN batch transactions,
 * never interrupting an in-flight one). Returns a discriminated outcome; throws
 * only genuinely unexpected errors (DB/infra), never converting them to success.
 */
export async function processPreparationWork(
  auditFirmId: string, runId: string, opts: DriveOptions = {},
): Promise<PrepDriveOutcome> {
  const maxClaims = opts.maxClaims ?? DEFAULT_MAX_CLAIMS;
  const wallClockBudgetMs = opts.wallClockBudgetMs ?? DEFAULT_WALL_CLOCK_BUDGET_MS;
  const now = opts.now ?? (() => performance.now());
  const start = now();

  // 1) Re-derive under RLS. The coordinate is trusted only for routing; a
  //    foreign/RLS-hidden run reads as absent → NOOP (no cross-tenant leak).
  const derived = await withTenantContext(auditFirmId, async (tx): Promise<
    { kind: "ok"; prepId: string } | { kind: "noop"; reason: "run_not_preparing" | "no_active_preparation" } | { kind: "multi"; preparing: number }
  > => {
    const run = await tx.auditRun.findUnique({ where: { id: runId }, select: { status: true } });
    if (!run || run.status !== "PREPARING") return { kind: "noop", reason: "run_not_preparing" };
    const preps = await tx.auditRunPreparation.findMany({ where: { runId, status: "PREPARING" }, select: { id: true }, orderBy: { generationNo: "asc" } });
    if (preps.length === 0) return { kind: "noop", reason: "no_active_preparation" };
    // Defensive: the C3-2R invariant (partial unique index) makes >1 impossible
    // through normal paths; if dirty/legacy state ever presents it, fail closed —
    // never pick, drain, seal, or abandon.
    if (preps.length > 1) return { kind: "multi", preparing: preps.length };
    return { kind: "ok", prepId: preps[0]!.id };
  });

  if (derived.kind === "noop") return { kind: "NOOP", reason: derived.reason };
  if (derived.kind === "multi") return { kind: "DATA_ERROR", detail: "more than one PREPARING preparation for run", preparing: derived.preparing };
  const prepId = derived.prepId;

  // 2) Bounded claim loop. Budget is checked at the top of each iteration — i.e.
  //    strictly between committed batch transactions.
  let claims = 0;
  for (;;) {
    if (claims >= maxClaims) return { kind: "YIELDED", prepId, claims, reason: "maxClaims", progress: await readProgress(auditFirmId, prepId) };
    if (now() - start >= wallClockBudgetMs) return { kind: "YIELDED", prepId, claims, reason: "wallClock", progress: await readProgress(auditFirmId, prepId) };

    const outcome = await claimAndMaterializeBatch(auditFirmId, prepId, opts.batchSize ? { batchSize: opts.batchSize } : undefined);
    switch (outcome.kind) {
      case "PROGRESSED":
      case "CHUNK_COMPLETED":
        claims += 1;
        continue; // loop re-checks budgets before the next claim
      case "BUSY":
        // Unfinished chunk(s) exist but are peer-locked. Yield immediately — no
        // spin, no sleep, no seal. A later invocation (or a peer) drains them.
        return { kind: "BUSY_YIELDED", prepId, claims, unfinished: outcome.unfinished, progress: await readProgress(auditFirmId, prepId) };
      case "COMPLETE":
        return await sealIdempotent(auditFirmId, prepId, claims);
      case "NOT_PREPARING":
        // Prep/run left PREPARING between derivation and claim (sealed/cancelled/
        // published/foreign) → stale coordinate.
        return { kind: "NOOP", reason: "not_preparing" };
    }
  }
}

/**
 * Seal, treating a peer's concurrent seal as idempotent success. The prep row is
 * re-read authoritatively on error: if it is COMPLETE the work is done (a peer
 * sealed); any other error (including an unexpected PreparationIncompleteError,
 * which `done` monotonicity makes impossible after a COMPLETE claim) propagates —
 * never swallowed, never converted to success.
 */
async function sealIdempotent(auditFirmId: string, prepId: string, claims: number): Promise<PrepDriveOutcome> {
  try {
    await sealPreparation(auditFirmId, prepId);
    return { kind: "SEALED", prepId, claims, idempotent: false };
  } catch (e) {
    const status = await withTenantContext(auditFirmId, (tx) =>
      tx.auditRunPreparation.findUnique({ where: { id: prepId }, select: { status: true } }),
    );
    if (status?.status === "COMPLETE") return { kind: "SEALED", prepId, claims, idempotent: true };
    // Not a benign "already sealed" race — surface the real failure.
    if (e instanceof PreparationIncompleteError) throw e;
    throw e;
  }
}
