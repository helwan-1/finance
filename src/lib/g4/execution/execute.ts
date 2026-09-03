import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { TenantTx } from "@/lib/db/tenant";
import { withExecutionUnit } from "./unit-tx";
import { loadExecutionContext, type ExecutionContext, type TestPin } from "./context";
import { fetchMemberPage, assertMember, type FrozenMember, type Keyset } from "./population";
import { resultOccurrenceFingerprint, resultSemanticFingerprint } from "./result-fingerprint";
import { toJson } from "./canonical";
import { claimInTx, completeInTx, failRunInTx, fenceOrThrow, extendLease, type ClaimResult } from "./job";
import { ExecutionError, LeaseLostError, RunCancelledError, ConfigError } from "./errors";
import {
  DQ_POPULATION_MEMBER_KIND, evaluatePopulationMember, type ResultDescriptor,
} from "./tests/dq-population-member";

export const EXEC_DEFAULT_BATCH = 500;

export type ExecuteOutcome =
  | { outcome: "COMPLETED"; jobId: string }
  | { outcome: "NOT_CLAIMED"; claim: ClaimResult }
  | { outcome: "LEASE_LOST"; jobId: string }
  | { outcome: "CANCELLED"; jobId: string }
  | { outcome: "FAILED"; jobId: string | null; failureCode: string };

/**
 * C1 orchestrator (design §2..§23). Claims a fenced attempt on a frozen QUEUED
 * run, executes each pinned test to keyset exhaustion in bounded fenced units
 * writing immutable idempotent results+evidence, then finalizes. Reads only
 * frozen authoritative rows. Never a cross-tenant scan — the caller supplies the
 * tenant + run explicitly.
 */
export async function executeRun(
  auditFirmId: string, runId: string, leaseOwner: string, opts?: { batchSize?: number },
): Promise<ExecuteOutcome> {
  const batchSize = opts?.batchSize ?? EXEC_DEFAULT_BATCH;

  const claim = await withExecutionUnit(auditFirmId, (tx) => claimInTx(tx, auditFirmId, runId, leaseOwner));
  if (claim.status !== "claimed") {
    if (claim.status === "build_mismatch") return { outcome: "FAILED", jobId: null, failureCode: "DETERMINISM" };
    if (claim.status === "config_error") return { outcome: "FAILED", jobId: null, failureCode: "CONFIG" };
    if (claim.status === "exhausted") return { outcome: "FAILED", jobId: null, failureCode: "TRANSIENT" };
    return { outcome: "NOT_CLAIMED", claim };
  }
  const jobId = claim.jobId;

  let ctx: ExecutionContext;
  try {
    ctx = await withExecutionUnit(auditFirmId, (tx) => loadExecutionContext(tx, auditFirmId, runId));
  } catch (e) {
    return terminalFail(auditFirmId, runId, jobId, e);
  }

  try {
    for (const pin of ctx.testPins) {
      await runTestToExhaustion(auditFirmId, ctx, pin, jobId, leaseOwner, batchSize);
    }
    await withExecutionUnit(auditFirmId, (tx) => completeInTx(tx, runId, jobId, leaseOwner));
    return { outcome: "COMPLETED", jobId };
  } catch (e) {
    if (e instanceof LeaseLostError) return { outcome: "LEASE_LOST", jobId };
    if (e instanceof RunCancelledError) return { outcome: "CANCELLED", jobId };
    return terminalFail(auditFirmId, runId, jobId, e);
  }
}

async function terminalFail(auditFirmId: string, runId: string, jobId: string | null, e: unknown): Promise<ExecuteOutcome> {
  const code = e instanceof ExecutionError ? e.failureCode : "INFRA";
  const detail = e instanceof Error ? e.message : String(e);
  await withExecutionUnit(auditFirmId, (tx) => failRunInTx(tx, runId, jobId, code, detail));
  return { outcome: "FAILED", jobId, failureCode: code };
}

/**
 * Drive ONE pinned test's frozen population to keyset exhaustion during THIS
 * attempt (design §23). Exhaustion (a page < batchSize) is observed by this
 * attempt's own walk; occurrence conflicts during a re-scan never advance or
 * terminate the keyset.
 */
async function runTestToExhaustion(
  auditFirmId: string, ctx: ExecutionContext, pin: TestPin, jobId: string, leaseOwner: string, batchSize: number,
): Promise<void> {
  assertSupported(pin);
  let after: Keyset | null = null;
  // Bound the loop defensively; a page shorter than batchSize is the only exit.
  for (let guard = 0; guard < 1_000_000; guard++) {
    const step = await runResultUnit(auditFirmId, ctx, pin, jobId, leaseOwner, after, batchSize);
    if (step.reachedEnd) return;
    after = step.lastKey;
  }
  throw new ConfigError("keyset scan did not terminate");
}

/**
 * One bounded, fenced result unit (design §8/§10/§11). Locks run+job, asserts
 * ownership by DB clock, processes a keyset page into immutable idempotent
 * results+evidence, extends the lease, commits — atomically.
 */
export async function runResultUnit(
  auditFirmId: string, ctx: ExecutionContext, pin: TestPin, jobId: string, leaseOwner: string,
  after: Keyset | null, batchSize: number,
): Promise<{ processed: number; reachedEnd: boolean; lastKey: Keyset | null }> {
  return withExecutionUnit(auditFirmId, async (tx) => {
    await fenceOrThrow(tx, ctx.runId, jobId, leaseOwner);
    const page = await fetchMemberPage(tx, ctx.preparationId, pin.auditTestVersionId, after, batchSize);
    let lastKey = after;
    for (const member of page) {
      const descriptor = evaluate(pin, member);
      await persistResult(tx, ctx, pin, descriptor);
      lastKey = { datasetId: member.datasetId, sourceRowNo: member.sourceRowNo };
    }
    await extendLease(tx, jobId);
    return { processed: page.length, reachedEnd: page.length < batchSize, lastKey };
  });
}

function assertSupported(pin: TestPin): void {
  const kind = (pin.definitionJson as { dqKind?: string } | null)?.dqKind;
  if (!(pin.testType === "DATA_QUALITY" && kind === DQ_POPULATION_MEMBER_KIND)) {
    throw new ConfigError(`unsupported C1 test (type=${pin.testType}, dqKind=${kind ?? "none"})`);
  }
}

function evaluate(pin: TestPin, member: FrozenMember): ResultDescriptor {
  assertSupported(pin);
  return evaluatePopulationMember(member);
}

/**
 * Atomic result + evidence persistence (design §10/§11). The immutable result is
 * the idempotency gate: INSERT … ON CONFLICT DO NOTHING RETURNING id. Evidence is
 * inserted ONLY when a fresh result row is returned — on conflict the winning
 * unit already co-committed the evidence, so we skip. Every evidence insert is
 * guarded by assertMember (evidence-in-population, design §17).
 */
async function persistResult(tx: TenantTx, ctx: ExecutionContext, pin: TestPin, d: ResultDescriptor): Promise<void> {
  const evidenceEOIsOrdered = d.evidence.map((e) => e.eoiFrameHash);
  const occ = resultOccurrenceFingerprint({
    runId: ctx.runId, auditRunTestVersionId: pin.auditRunTestVersionId, resultCode: d.resultCode, evidenceEOIsOrdered,
  });
  const sem = resultSemanticFingerprint({
    semanticScopeAnchor: ctx.semanticScopeAnchor,
    testKey: pin.testKey, testVersion: pin.testVersion, testVersionHash: pin.testVersionHash,
    ruleVersionHash: pin.ruleVersionHash,
    effectiveParametersHash: pin.effectiveParametersHash,
    consumedMappingSemanticHashes: d.consumedMappingSemanticHashes,
    resultCode: d.resultCode, evidenceEOIsOrdered, payload: d.payload,
  });
  const payloadText = JSON.stringify(toJson(d.payload));
  const resultId = randomUUID();

  const inserted = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    INSERT INTO "audit_results"
      ("id","auditFirmId","runId","auditRunTestVersionId","resultKind","resultCode","severity","score","payloadJson","resultOccurrenceFingerprint","resultSemanticFingerprint","lineageClass","createdAt")
    VALUES
      (${resultId}, ${ctx.auditFirmId}, ${ctx.runId}, ${pin.auditRunTestVersionId}, 'DATA_QUALITY', ${d.resultCode}, 'LOW'::"AnomalySeverity", 0.00, ${payloadText}::jsonb, ${occ}, ${sem}, 'VERIFIED'::"LineageClass", clock_timestamp())
    ON CONFLICT ("auditFirmId","runId","resultOccurrenceFingerprint") DO NOTHING
    RETURNING "id"
  `);
  if (inserted.length === 0) return; // already fully persisted (result + evidence) by the winning unit

  const auditResultId = inserted[0]!.id;
  for (const e of d.evidence) {
    await assertMember(tx, ctx.preparationId, pin.auditTestVersionId, e.datasetId, e.sourceRowNo);
    const evId = randomUUID();
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "audit_result_evidence"
        ("id","auditFirmId","auditResultId","evidenceType","role","importedRecordId","sourceRowNo","eoiFrameHash")
      VALUES
        (${evId}, ${ctx.auditFirmId}, ${auditResultId}, 'IMPORTED_RECORD'::"AuditEvidenceType", 'subject', ${e.importedRecordId}, ${e.sourceRowNo}, ${e.eoiFrameHash})
    `);
  }
}
