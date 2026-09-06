/**
 * G6 Phase C3-3C — background dispatcher runtime entrypoint.
 *
 * Run with:  DISPATCH_DATABASE_URL=... DATABASE_URL=... npm run dispatch
 *
 * DISPATCH_DATABASE_URL must connect as the `audit_dispatch` role (locator-only:
 * EXECUTE on app_locate_runnable_work() + schema USAGE; no table grants, no
 * BYPASSRLS). DATABASE_URL must connect as the RLS-subject `audit_app` role
 * (tenant processing). The two pools never switch roles.
 *
 * This is the ONLY place that owns a poll loop + OS signal handling; the dispatcher
 * and processors remain host-neutral and loop-free.
 */
import { createDispatchClient, runDispatcherLoop, DEFAULT_POLL_INTERVAL_MS } from "@/lib/g4/runtime";

async function main(): Promise<void> {
  const intervalMs = Number(process.env.DISPATCH_POLL_INTERVAL_MS ?? DEFAULT_POLL_INTERVAL_MS);
  const controller = new AbortController();
  const stop = (sig: string) => {
    // Graceful: stop fetching new work; the in-flight tick finishes on its own.
    console.log(JSON.stringify({ event: "dispatch.shutdown", signal: sig }));
    controller.abort();
  };
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));

  const dispatchClient = createDispatchClient();
  console.log(JSON.stringify({ event: "dispatch.start", intervalMs }));
  try {
    await runDispatcherLoop({
      dispatchClient,
      intervalMs,
      signal: controller.signal,
      onTick: (s) =>
        // Sanitized operational telemetry only — never row/evidence/financial data.
        console.log(JSON.stringify({
          event: "dispatch.tick", located: s.locatedCount, selected: s.selectedCount,
          started: s.startedCount, budgetExhausted: s.budgetExhausted,
          durationMs: Math.round(s.durationMs), outcomes: s.outcomeCounts,
        })),
    });
  } finally {
    await dispatchClient.$disconnect();
    console.log(JSON.stringify({ event: "dispatch.stopped" }));
  }
}

main().catch((e) => { console.error(JSON.stringify({ event: "dispatch.fatal", error: (e as Error).name })); process.exitCode = 1; });
