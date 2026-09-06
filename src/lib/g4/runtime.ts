import { PrismaClient } from "@prisma/client";
import { runDispatcherCycle, type Coordinate, type CycleSummary, type DispatcherOptions } from "./dispatcher";
import { processPreparationWork } from "./preparation-driver";
import { processExecutionWork } from "./execution-driver";

/**
 * G6 Phase C3-3C — background runtime that wires DISCOVERY to the bounded
 * dispatcher cycle and drives real tenant processors.
 *
 * TWO DB principals, two independent pools, NO role switching:
 *   - dispatch pool (role `audit_dispatch`, DISPATCH_DATABASE_URL): locator-only.
 *     It runs ONLY `app_locate_runnable_work()` (SECURITY DEFINER) and has no table
 *     grants and no BYPASSRLS. It must NOT go through withTenantContext (that would
 *     probe audit_firms, which audit_dispatch cannot read).
 *   - tenant pool (role `audit_app`, DATABASE_URL): the processors' withTenantContext
 *     work, subject to RLS. (Owned by the shared `@/lib/prisma` client.)
 *
 * The locator coordinate is non-authoritative: processors re-derive/re-validate
 * authoritative state under audit_app RLS. Execution lease/heartbeat/fencing stay
 * engine-owned. This module owns ONLY the poll cadence and graceful shutdown.
 */

/** A dispatch-pool Prisma client (role audit_dispatch). Locator-only. */
export function createDispatchClient(url = process.env.DISPATCH_DATABASE_URL): PrismaClient {
  if (!url) throw new Error("DISPATCH_DATABASE_URL is required for the dispatch (audit_dispatch) pool");
  return new PrismaClient({ datasources: { db: { url } }, log: ["error"] });
}

/** Build the injected discovery function from a dispatch-pool client. */
export function makeDispatchLocate(client: PrismaClient): () => Promise<Coordinate[]> {
  return () => client.$queryRawUnsafe<Coordinate[]>("SELECT * FROM app_locate_runnable_work()");
}

export interface TickOptions extends DispatcherOptions {
  /** Injected discovery (tests) OR a dispatch client for the default locator. */
  locate?: () => Promise<Coordinate[]>;
  dispatchClient?: PrismaClient;
  now?: () => number;
}

/**
 * Run ONE bounded dispatcher cycle end-to-end (discovery → route → tenant
 * processors). Discovery source precedence: explicit `locate` → `dispatchClient`
 * → a client built from DISPATCH_DATABASE_URL (which the caller must dispose).
 */
export async function runDispatcherTick(opts: TickOptions = {}): Promise<CycleSummary> {
  const { locate, dispatchClient, now, ...dispatcherOptions } = opts;
  const discover = locate ?? makeDispatchLocate(dispatchClient ?? createDispatchClient());
  return runDispatcherCycle(
    { locate: discover, processPreparation: processPreparationWork, processExecution: processExecutionWork, now },
    dispatcherOptions,
  );
}

export interface LoopOptions extends TickOptions {
  /** Delay between the END of one tick and the START of the next (ms). */
  intervalMs?: number;
  /** Abort signal for graceful shutdown; stops after the current tick. */
  signal?: AbortSignal;
  /** Optional per-tick observer (sanitized summary only — never row payloads). */
  onTick?: (summary: CycleSummary) => void;
  /** Optional cap on ticks (tests); default unbounded. */
  maxTicks?: number;
}

export const DEFAULT_POLL_INTERVAL_MS = 5_000;

/**
 * Long-lived bounded poll loop (the runtime entrypoint's engine). Each iteration
 * runs one bounded tick, then waits `intervalMs`. It never overlaps ticks, never
 * cancels an in-flight tick, and stops cleanly when `signal` aborts or `maxTicks`
 * is reached. Discovery is pull-based over durable state, so a missed cycle is
 * simply picked up by the next one (no lost-wakeup risk).
 */
export async function runDispatcherLoop(opts: LoopOptions = {}): Promise<{ ticks: number }> {
  const { intervalMs = DEFAULT_POLL_INTERVAL_MS, signal, onTick, maxTicks, ...tick } = opts;
  let ticks = 0;
  while (!signal?.aborted && (maxTicks === undefined || ticks < maxTicks)) {
    const summary = await runDispatcherTick(tick);
    ticks += 1;
    onTick?.(summary);
    if (signal?.aborted || (maxTicks !== undefined && ticks >= maxTicks)) break;
    await sleep(intervalMs, signal);
  }
  return { ticks };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(t); resolve(); };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
