import { randomUUID } from "node:crypto";
import { executeRun, type ExecuteOutcome } from "./execution/execute";

/**
 * G6 Phase C3-3A — thin tenant-scoped EXECUTION processor.
 *
 * A minimal wrapper that routes a NON-authoritative locator coordinate
 * {auditFirmId, runId} into the authoritative `executeRun` engine and maps its
 * outcome into a small dispatcher-facing union. It adds nothing to the engine's
 * responsibilities: `executeRun` alone owns tenant context (via withExecutionUnit
 * → RLS), claim/attempt allocation, AuditJob creation, lease extension, heartbeat,
 * fencing, result/evidence persistence, completion, and failRun. This wrapper only
 * (1) mints a unique invocation leaseOwner and (2) classifies the result.
 *
 * HEARTBEAT / LEASE (frozen): `executeRun` is the SOLE owner of lease extension
 * and fencing. This wrapper starts no timer, extends no lease, and mutates no
 * AuditJob. Correctness comes from DB lease expiry (LEASE_TTL_MS, 60s) + fencing:
 * a stalled worker whose lease has expired fails its next fenced DB operation and
 * loses authority — never from any assumption that extensions happen on a fixed
 * ≤15s cadence.
 */
export interface ExecWorkOptions {
  batchSize?: number;
  /** Injectable for tests. Defaults to a fresh, opaque, invocation-scoped id. */
  leaseOwner?: string;
}

/** Dispatcher-facing execution outcome. No persistent statuses/enums. */
export type ExecWorkOutcome =
  | { kind: "DONE"; runId: string; jobId: string }
  | { kind: "BUSY"; runId: string; reason: "owned" }
  | { kind: "STALE"; runId: string; reason: string }
  | { kind: "LEASE_LOST"; runId: string; jobId: string }
  | { kind: "CONFIG_ERROR"; runId: string; jobId: string | null; failureCode: string }
  | { kind: "TERMINAL_FAILED"; runId: string; jobId: string | null; failureCode: string };

/**
 * Drive one EXECUTION coordinate via `executeRun`. The coordinate is trusted only
 * for routing; `executeRun` re-derives and re-validates authoritatively under RLS
 * (a forged/foreign/absent run cannot be claimed → STALE, with no mutation and no
 * cross-tenant existence leak). Unexpected DB/infra errors PROPAGATE (never mapped
 * to DONE/STALE); no retry state is created.
 */
export async function processExecutionWork(
  auditFirmId: string, runId: string, opts: ExecWorkOptions = {},
): Promise<ExecWorkOutcome> {
  const leaseOwner = opts.leaseOwner ?? `exec-${randomUUID()}`;
  const res: ExecuteOutcome = await executeRun(
    auditFirmId, runId, leaseOwner, opts.batchSize ? { batchSize: opts.batchSize } : undefined,
  );

  switch (res.outcome) {
    case "COMPLETED":
      return { kind: "DONE", runId, jobId: res.jobId };
    case "LEASE_LOST":
      return { kind: "LEASE_LOST", runId, jobId: res.jobId };
    case "CANCELLED":
      // Run is CANCELLED (terminal, engine-owned; not a failure). The wrapper does
      // not alter run state — a cancelled coordinate is simply not our work.
      return { kind: "STALE", runId, reason: "cancelled" };
    case "FAILED": {
      // The engine already performed the run→FAILED transition (terminalFail).
      const fc = res.failureCode;
      if (fc === "CONFIG" || fc === "DETERMINISM") {
        return { kind: "CONFIG_ERROR", runId, jobId: res.jobId, failureCode: fc };
      }
      return { kind: "TERMINAL_FAILED", runId, jobId: res.jobId, failureCode: fc };
    }
    case "NOT_CLAIMED": {
      const c = res.claim;
      // owned: a live lease is held by an active peer attempt → do not take over
      // early. locked: the run row could not be acquired (foreign/RLS-hidden/absent
      // OR a momentary peer claim race) → nothing to act on. not_claimable: the run
      // is in a non-executable/terminal status. locked & not_claimable are both
      // stale-equivalent for this coordinate (rediscovered later if still runnable).
      if (c.status === "owned") return { kind: "BUSY", runId, reason: "owned" };
      if (c.status === "not_claimable") return { kind: "STALE", runId, reason: `not_claimable:${c.runStatus}` };
      // "locked" (foreign/RLS-hidden/absent or a momentary peer row-lock). The
      // other ClaimResult statuses are converted to FAILED inside executeRun and
      // never reach NOT_CLAIMED; treat any residual as stale-equivalent.
      return { kind: "STALE", runId, reason: c.status };
    }
  }
}
