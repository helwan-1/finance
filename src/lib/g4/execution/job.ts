import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { TenantTx } from "@/lib/db/tenant";
import { getAttestableEngineBuildVersion } from "@/lib/g4/engine-build";
import { withExecutionUnit, MAX_UNIT_TX_TIME_MS } from "./unit-tx";
import { LeaseLostError, RunCancelledError } from "./errors";

/** Lease must safely exceed the max time any single unit can hold a lock (design §4). */
export const LEASE_TTL_MS = 60_000;
export const HEARTBEAT_INTERVAL_MS = 15_000;

// Config invariant (ADR-G4-C1-11): MAX_UNIT_TX_TIME < HEARTBEAT_INTERVAL < LEASE_TTL.
if (!(MAX_UNIT_TX_TIME_MS < HEARTBEAT_INTERVAL_MS && HEARTBEAT_INTERVAL_MS < LEASE_TTL_MS)) {
  throw new Error("C1 lease invariant violated: require MAX_UNIT_TX_TIME < HEARTBEAT_INTERVAL < LEASE_TTL");
}

const leaseExpr = Prisma.sql`clock_timestamp() + (interval '1 millisecond' * ${LEASE_TTL_MS})`;

export type ClaimResult =
  | { status: "claimed"; jobId: string; attemptNo: number }
  | { status: "locked" }
  | { status: "owned" }
  | { status: "not_claimable"; runStatus: string }
  | { status: "exhausted" }
  | { status: "build_mismatch" }
  | { status: "config_error"; message: string };

/**
 * Claim algorithm (design §6). One short transaction, lock order run→job:
 * serialize on the AuditRun row (FOR UPDATE SKIP LOCKED), verify the frozen
 * build, atomically allocate attemptNo (backstopped by unique(runId, attemptNo)),
 * kill an expired predecessor, insert the RUNNING lease with DB-clock timestamps,
 * and flip the run to RUNNING. Two workers can never both own an attempt.
 */
export async function claimInTx(tx: TenantTx, auditFirmId: string, runId: string, leaseOwner: string): Promise<ClaimResult> {
  const runRows = await tx.$queryRaw<Array<{ status: string; engineBuildVersion: string | null; freezeGeneration: string | null; maxAttempts: number }>>(Prisma.sql`
    SELECT "status", "engineBuildVersion", "freezeGeneration", "maxAttempts"
    FROM "audit_runs" WHERE "id" = ${runId}
    FOR UPDATE SKIP LOCKED
  `);
  if (runRows.length === 0) return { status: "locked" };
  const run = runRows[0]!;
  if (run.status !== "QUEUED" && run.status !== "RUNNING") return { status: "not_claimable", runStatus: run.status };
  if (!run.freezeGeneration) {
    await failRunInTx(tx, runId, null, "CONFIG", "run has no freezeGeneration");
    return { status: "config_error", message: "no freezeGeneration" };
  }

  // Frozen-build enforcement (design §15): fail closed on mismatch.
  const build = getAttestableEngineBuildVersion();
  const latest = await tx.$queryRaw<Array<{ id: string; attemptNo: number; status: string; live: boolean }>>(Prisma.sql`
    SELECT "id", "attemptNo", "status", ("leaseExpiresAt" > clock_timestamp()) AS live
    FROM "audit_jobs" WHERE "runId" = ${runId} ORDER BY "attemptNo" DESC LIMIT 1
  `);
  const cur = latest[0];
  const nextAttempt = (cur?.attemptNo ?? 0) + 1;

  if (run.engineBuildVersion !== build) {
    const jobId = randomUUID();
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "audit_jobs" ("id","auditFirmId","runId","attemptNo","status","leaseOwner","startedAt","completedAt","failureCode","failureDetail")
      VALUES (${jobId}, ${auditFirmId}, ${runId}, ${nextAttempt}, 'FAILED', ${leaseOwner}, clock_timestamp(), clock_timestamp(), 'DETERMINISM', 'engine build mismatch')
    `);
    await failRunInTx(tx, runId, null, "DETERMINISM", `frozen build ${run.engineBuildVersion} != server build ${build}`);
    return { status: "build_mismatch" };
  }

  if (cur && cur.status === "RUNNING") {
    if (cur.live) return { status: "owned" };
    await tx.$executeRaw(Prisma.sql`
      UPDATE "audit_jobs" SET "status"='FAILED', "failureCode"='LEASE_LOST', "failureDetail"='lease expired; superseded', "completedAt"=clock_timestamp()
      WHERE "id"=${cur.id}
    `);
  }

  if (nextAttempt > run.maxAttempts) {
    await failRunInTx(tx, runId, null, "TRANSIENT", "max attempts exhausted");
    return { status: "exhausted" };
  }

  const jobId = randomUUID();
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO "audit_jobs" ("id","auditFirmId","runId","attemptNo","status","leaseOwner","startedAt","heartbeatAt","leaseExpiresAt")
    VALUES (${jobId}, ${auditFirmId}, ${runId}, ${nextAttempt}, 'RUNNING', ${leaseOwner}, clock_timestamp(), clock_timestamp(), ${leaseExpr})
  `);
  await tx.$executeRaw(Prisma.sql`
    UPDATE "audit_runs" SET "status"='RUNNING', "updatedAt"=now() WHERE "id"=${runId} AND "status" IN ('QUEUED','RUNNING')
  `);
  return { status: "claimed", jobId, attemptNo: nextAttempt };
}

/**
 * Fence (design §8). Lock order run→job. Acquires the run row FOR SHARE (the
 * cancellation rendezvous) and the job row FOR UPDATE (the ownership mutex), then
 * asserts ownership + validity by DB clock. Held across the caller's writes so no
 * takeover can preempt an in-flight unit. Throws on cancellation or lost lease.
 */
export async function fenceOrThrow(tx: TenantTx, runId: string, jobId: string, leaseOwner: string): Promise<void> {
  const runRows = await tx.$queryRaw<Array<{ status: string }>>(Prisma.sql`
    SELECT "status" FROM "audit_runs" WHERE "id"=${runId} FOR SHARE
  `);
  if (runRows.length === 0) throw new LeaseLostError("run vanished");
  if (runRows[0]!.status === "CANCELLED") throw new RunCancelledError();
  if (runRows[0]!.status !== "RUNNING") throw new RunCancelledError(`run not RUNNING (status=${runRows[0]!.status})`);

  const jobRows = await tx.$queryRaw<Array<{ leaseOwner: string | null; status: string; live: boolean }>>(Prisma.sql`
    SELECT "leaseOwner", "status", ("leaseExpiresAt" > clock_timestamp()) AS live
    FROM "audit_jobs" WHERE "id"=${jobId} FOR UPDATE
  `);
  if (jobRows.length === 0) throw new LeaseLostError("job vanished");
  const j = jobRows[0]!;
  if (j.status !== "RUNNING" || j.leaseOwner !== leaseOwner || !j.live) {
    throw new LeaseLostError(`fence failed (status=${j.status}, owner=${j.leaseOwner}, live=${j.live})`);
  }
}

/** Extend the lease under the held job lock (design §7). */
export async function extendLease(tx: TenantTx, jobId: string): Promise<void> {
  await tx.$executeRaw(Prisma.sql`
    UPDATE "audit_jobs" SET "heartbeatAt"=clock_timestamp(), "leaseExpiresAt"=${leaseExpr} WHERE "id"=${jobId}
  `);
}

/** Public heartbeat: fenced lease extension. Throws if the lease was lost. */
export async function heartbeat(auditFirmId: string, runId: string, jobId: string, leaseOwner: string): Promise<void> {
  await withExecutionUnit(auditFirmId, async (tx) => {
    await fenceOrThrow(tx, runId, jobId, leaseOwner);
    await extendLease(tx, jobId);
  });
}

/**
 * Finalize (design §23). Fenced, run+job locked: mark the job SUCCEEDED and the
 * run COMPLETED. The caller must already have proved keyset exhaustion for this
 * attempt. The run's set-once/terminal trigger backstops immutability afterwards.
 */
export async function completeInTx(tx: TenantTx, runId: string, jobId: string, leaseOwner: string): Promise<void> {
  await fenceOrThrow(tx, runId, jobId, leaseOwner);
  await tx.$executeRaw(Prisma.sql`
    UPDATE "audit_jobs" SET "status"='SUCCEEDED', "completedAt"=clock_timestamp() WHERE "id"=${jobId}
  `);
  await tx.$executeRaw(Prisma.sql`
    UPDATE "audit_runs" SET "status"='COMPLETED', "updatedAt"=now() WHERE "id"=${runId} AND "status"='RUNNING'
  `);
}

/** Mark a job FAILED and, when terminal, the run FAILED (design §24). */
export async function failRunInTx(
  tx: TenantTx, runId: string, jobId: string | null, code: string, detail: string,
): Promise<void> {
  if (jobId) {
    await tx.$executeRaw(Prisma.sql`
      UPDATE "audit_jobs" SET "status"='FAILED', "failureCode"=${code}::"AuditFailureCode", "failureDetail"=${detail}, "completedAt"=clock_timestamp() WHERE "id"=${jobId}
    `);
  }
  await tx.$executeRaw(Prisma.sql`
    UPDATE "audit_runs" SET "status"='FAILED', "failureCode"=${code}::"AuditFailureCode", "failureDetail"=${detail}, "updatedAt"=now()
    WHERE "id"=${runId} AND "status" NOT IN ('COMPLETED','FAILED','CANCELLED')
  `);
}
