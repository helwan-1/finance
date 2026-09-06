import { performance } from "node:perf_hooks";
import { processPreparationWork } from "./preparation-driver";
import { processExecutionWork } from "./execution-driver";

/**
 * G6 Phase C3-3B — bounded, host-neutral, stateless dispatcher cycle.
 *
 * One invocation runs ONE bounded cycle: take runnable coordinates from an
 * injected `locate()`, route each by workType to the tenant-scoped processor
 * (`processPreparationWork` / `processExecutionWork`), under bounded concurrency
 * and a bounded coordinate count and a SOFT wall-clock start budget, isolating
 * per-coordinate failures, and return a truthful operational summary.
 *
 * It is NOT an authority boundary: coordinates are non-authoritative routing hints;
 * the processors (and the engine beneath them) re-derive and re-validate under
 * audit_app/RLS. The dispatcher never inspects/mutates tenant tables, never mints
 * an execution leaseOwner, never manages lease/heartbeat/fencing, and never
 * publishes. It holds no durable state, runs no loop/scheduler, and performs no
 * discovery itself — `locate` is injected so C3-3C can own the dispatch-pool DB
 * boundary later.
 *
 * Delivery is at-least-once: duplicate/stale coordinates are routed normally and
 * absorbed by the idempotent/fenced processors — the dispatcher performs no
 * correctness dedupe.
 */

/** Frozen locator coordinate shape (workType kept as string; validated below). */
export interface Coordinate { auditFirmId: string; runId: string; workType: string }

export type DispatchClass =
  | "DONE" | "YIELDED" | "BUSY" | "STALE"
  | "DATA_ERROR" | "CONFIG_ERROR" | "TERMINAL_FAILED" | "LEASE_LOST"
  | "RETRYABLE_INFRA" | "UNSUPPORTED_WORK_TYPE";

export interface CoordinateResult {
  index: number; // position in the selected prefix (input/start order)
  auditFirmId: string;
  runId: string;
  workType: string;
  outcome: DispatchClass;
  detail?: string; // sanitized operational token only — never a payload/message body
}

export interface CycleSummary {
  locatedCount: number;
  selectedCount: number;
  startedCount: number;
  completedCount: number;
  notStartedCount: number;
  budgetExhausted: boolean;
  durationMs: number;
  outcomeCounts: Record<DispatchClass, number>;
  results: CoordinateResult[];
}

export interface DispatcherDeps {
  /** Discovery dependency — MUST be injected in C3-3B (no locator DB wiring here). */
  locate: () => Promise<Coordinate[]>;
  /** Tenant processors; default to the real drivers, injectable for tests. */
  processPreparation?: (auditFirmId: string, runId: string) => Promise<{ kind: string }>;
  processExecution?: (auditFirmId: string, runId: string) => Promise<{ kind: string }>;
  /** Monotonic clock (ms); injectable test seam. */
  now?: () => number;
}

export interface DispatcherOptions {
  maxCoordinatesPerCycle?: number;
  maxConcurrency?: number;
  wallClockBudgetMs?: number;
}

export const DEFAULT_MAX_COORDINATES = 50;
export const DEFAULT_MAX_CONCURRENCY = 4;
export const DEFAULT_WALL_CLOCK_BUDGET_MS = 30_000;
const HARD_MAX_COORDINATES = 200; // locator's frozen global cap; never assume more

const SUPPORTED_WORK_TYPES = new Set(["PREPARATION", "EXECUTION"]);

function reqPosInt(name: string, v: number, min: number, max: number): number {
  if (typeof v !== "number" || !Number.isInteger(v) || !Number.isFinite(v) || v < min || v > max) {
    throw new Error(`dispatcher option ${name} must be an integer in [${min}, ${max}] (got ${String(v)})`);
  }
  return v;
}

const PREP_CLASS: Record<string, DispatchClass> = {
  SEALED: "DONE", YIELDED: "YIELDED", BUSY_YIELDED: "BUSY", NOOP: "STALE", DATA_ERROR: "DATA_ERROR",
  FAILED: "TERMINAL_FAILED", // PREP-F: deterministic engine failure (durable PREPARING→FAILED)
};
const EXEC_CLASS: Record<string, DispatchClass> = {
  DONE: "DONE", BUSY: "BUSY", STALE: "STALE", LEASE_LOST: "LEASE_LOST",
  CONFIG_ERROR: "CONFIG_ERROR", TERMINAL_FAILED: "TERMINAL_FAILED",
};

/** Sanitized operational token from an outcome object (never a payload/message). */
function detailOf(o: { kind: string; reason?: string; failureCode?: string; preparing?: number }): string | undefined {
  if (o.failureCode) return o.failureCode;
  if (o.reason) return o.reason;
  if (typeof o.preparing === "number") return `preparing:${o.preparing}`;
  return undefined;
}

/**
 * Run exactly one bounded dispatcher cycle. Rejects (fails the cycle) on invalid
 * options or if `locate()` itself throws — never converting a discovery failure
 * into a successful empty cycle. Individual coordinate failures are isolated and
 * classified RETRYABLE_INFRA without aborting the cycle.
 */
export async function runDispatcherCycle(
  deps: DispatcherDeps, options: DispatcherOptions = {},
): Promise<CycleSummary> {
  const maxCoordinates = reqPosInt("maxCoordinatesPerCycle", options.maxCoordinatesPerCycle ?? DEFAULT_MAX_COORDINATES, 1, HARD_MAX_COORDINATES);
  const maxConcurrency = reqPosInt("maxConcurrency", options.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY, 1, maxCoordinates);
  const wallClockBudgetMs = reqPosInt("wallClockBudgetMs", options.wallClockBudgetMs ?? DEFAULT_WALL_CLOCK_BUDGET_MS, 1, Number.MAX_SAFE_INTEGER);
  const now = deps.now ?? (() => performance.now());
  const processPreparation = deps.processPreparation ?? processPreparationWork;
  const processExecution = deps.processExecution ?? processExecutionWork;

  const start = now();
  // Discovery failure must surface — not a successful empty cycle.
  const located = await deps.locate();
  const selected = located.slice(0, maxCoordinates);

  const results: Array<CoordinateResult | undefined> = new Array(selected.length);
  let budgetExhausted = false;
  let cursor = 0;

  async function runOne(i: number): Promise<void> {
    const c = selected[i]!;
    // Structural validation — fail closed WITHOUT calling a processor on bad input.
    if (typeof c.auditFirmId !== "string" || c.auditFirmId.length === 0 || typeof c.runId !== "string" || c.runId.length === 0) {
      results[i] = { index: i, auditFirmId: String(c.auditFirmId ?? ""), runId: String(c.runId ?? ""), workType: String(c.workType ?? ""), outcome: "DATA_ERROR", detail: "invalid_coordinate" };
      return;
    }
    if (!SUPPORTED_WORK_TYPES.has(c.workType)) {
      results[i] = { index: i, auditFirmId: c.auditFirmId, runId: c.runId, workType: c.workType, outcome: "UNSUPPORTED_WORK_TYPE" };
      return;
    }
    try {
      const o = c.workType === "PREPARATION"
        ? await processPreparation(c.auditFirmId, c.runId)
        : await processExecution(c.auditFirmId, c.runId);
      const table = c.workType === "PREPARATION" ? PREP_CLASS : EXEC_CLASS;
      const outcome = table[o.kind] ?? "RETRYABLE_INFRA";
      results[i] = { index: i, auditFirmId: c.auditFirmId, runId: c.runId, workType: c.workType, outcome, detail: detailOf(o as { kind: string }) };
    } catch (e) {
      // Thrown DB/infra error → RETRYABLE_INFRA; sanitized token only (class/code,
      // never a message body that could carry data). Never mapped to DONE/STALE.
      const code = (e as { code?: string })?.code ?? (e as Error)?.name ?? "error";
      results[i] = { index: i, auditFirmId: c.auditFirmId, runId: c.runId, workType: c.workType, outcome: "RETRYABLE_INFRA", detail: String(code) };
    }
  }

  // Bounded worker pool. The soft budget is a START gate checked between
  // coordinates; an already-started processor is never interrupted/cancelled.
  async function worker(): Promise<void> {
    for (;;) {
      if (now() - start >= wallClockBudgetMs) { budgetExhausted = true; return; }
      const i = cursor;
      if (i >= selected.length) return;
      cursor += 1;
      await runOne(i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(maxConcurrency, selected.length) }, () => worker()));

  const done = results.filter((r): r is CoordinateResult => r !== undefined);
  const outcomeCounts = done.reduce((acc, r) => { acc[r.outcome] = (acc[r.outcome] ?? 0) + 1; return acc; }, {} as Record<DispatchClass, number>);
  return {
    locatedCount: located.length,
    selectedCount: selected.length,
    startedCount: done.length,
    completedCount: done.length, // the cycle awaits every started processor
    notStartedCount: selected.length - done.length,
    budgetExhausted,
    durationMs: now() - start,
    outcomeCounts,
    results: done.sort((a, b) => a.index - b.index),
  };
}
