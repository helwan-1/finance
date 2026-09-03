import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { TenantTx } from "@/lib/db/tenant";
import { withExecutionUnit } from "./unit-tx";
import { loadExecutionContext, type ExecutionContext, type TestPin } from "./context";
import { assertMember, assertJEFullyInPopulation } from "./population";
import { resultOccurrenceFingerprint, resultSemanticFingerprint } from "./result-fingerprint";
import { toJson } from "./canonical";
import { claimInTx, completeInTx, failRunInTx, fenceOrThrow, extendLease, type ClaimResult } from "./job";
import { ExecutionError, LeaseLostError, RunCancelledError, ConfigError } from "./errors";
import { resolveExecutor } from "./registry";
import { preflight } from "./preflight";
import type { ResultDescriptor, EvidenceRef, TestExecutor } from "./contracts";

export const EXEC_DEFAULT_BATCH = 500;

export type ExecuteOutcome =
  | { outcome: "COMPLETED"; jobId: string }
  | { outcome: "NOT_CLAIMED"; claim: ClaimResult }
  | { outcome: "LEASE_LOST"; jobId: string }
  | { outcome: "CANCELLED"; jobId: string }
  | { outcome: "FAILED"; jobId: string | null; failureCode: string };

/**
 * C1+C2 orchestrator. Claims a fenced attempt on a frozen QUEUED run, runs an
 * all-or-nothing PREFLIGHT over every pinned test (fail CONFIG before any result),
 * then executes each supported test to keyset exhaustion in bounded fenced units
 * — dispatching through the registry (no giant switch) — writing immutable
 * idempotent results+evidence, then finalizes. Reads only frozen authoritative
 * rows; never a cross-tenant scan.
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
    // PREFLIGHT — validate EVERY pinned test before the first authoritative result.
    preflight(ctx);
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
 * attempt. Each executor owns its opaque cursor; exhaustion (a short page) is
 * observed by this attempt's own walk. Occurrence conflicts during a re-scan
 * never advance or terminate the keyset.
 */
async function runTestToExhaustion(
  auditFirmId: string, ctx: ExecutionContext, pin: TestPin, jobId: string, leaseOwner: string, batchSize: number,
): Promise<void> {
  let cursor: unknown = null;
  for (let guard = 0; guard < 5_000_000; guard++) {
    const step = await runResultUnit(auditFirmId, ctx, pin, jobId, leaseOwner, cursor, batchSize);
    if (step.reachedEnd) return;
    cursor = step.cursor;
  }
  throw new ConfigError("keyset scan did not terminate");
}

/**
 * One bounded, fenced result unit. Locks run+job, asserts ownership by DB clock,
 * resolves the pin's executor, runs one bounded page, persists its descriptors
 * atomically, extends the lease, commits. (Signature kept stable for C1 fencing
 * probes; the executor is resolved internally after the fence so lease/cancel
 * errors dominate.)
 */
export async function runResultUnit(
  auditFirmId: string, ctx: ExecutionContext, pin: TestPin, jobId: string, leaseOwner: string,
  cursor: unknown, batchSize: number,
): Promise<{ reachedEnd: boolean; cursor: unknown }> {
  return withExecutionUnit(auditFirmId, async (tx) => {
    await fenceOrThrow(tx, ctx.runId, jobId, leaseOwner);
    const exec: TestExecutor | null = resolveExecutor(pin);
    if (!exec) throw new ConfigError(`unsupported test at execution (type=${pin.testType})`);
    const page = await exec.executePage(tx, ctx, pin, cursor, batchSize);
    for (const d of page.descriptors) await persistResult(tx, ctx, pin, d);
    await extendLease(tx, jobId);
    return { reachedEnd: page.reachedEnd, cursor: page.cursor };
  });
}

/**
 * Atomic result + evidence persistence. The immutable result is the idempotency
 * gate: INSERT … ON CONFLICT DO NOTHING RETURNING id. Evidence is inserted ONLY
 * for a freshly-returned result — on conflict the winning unit already co-
 * committed the evidence. Every evidence insert is membership-guarded.
 */
async function persistResult(tx: TenantTx, ctx: ExecutionContext, pin: TestPin, d: ResultDescriptor): Promise<void> {
  const occ = resultOccurrenceFingerprint({
    runId: ctx.runId, auditRunTestVersionId: pin.auditRunTestVersionId, resultCode: d.resultCode, evidenceEOIsOrdered: d.identityEOIs,
  });
  const sem = resultSemanticFingerprint({
    semanticScopeAnchor: ctx.semanticScopeAnchor,
    testKey: pin.testKey, testVersion: pin.testVersion, testVersionHash: pin.testVersionHash,
    ruleVersionHash: pin.ruleVersionHash, effectiveParametersHash: pin.effectiveParametersHash,
    consumedMappingSemanticHashes: d.consumedMappingSemanticHashes,
    resultCode: d.resultCode, evidenceEOIsOrdered: d.identityEOIs, payload: d.payload,
  });
  const payloadText = JSON.stringify(toJson(d.payload));
  const resultId = randomUUID();

  const inserted = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    INSERT INTO "audit_results"
      ("id","auditFirmId","runId","auditRunTestVersionId","resultKind","resultCode","severity","score","payloadJson","resultOccurrenceFingerprint","resultSemanticFingerprint","lineageClass","createdAt")
    VALUES
      (${resultId}, ${ctx.auditFirmId}, ${ctx.runId}, ${pin.auditRunTestVersionId}, ${d.resultKind}, ${d.resultCode}, ${d.severity}::"AnomalySeverity", 0.00, ${payloadText}::jsonb, ${occ}, ${sem}, 'VERIFIED'::"LineageClass", clock_timestamp())
    ON CONFLICT ("auditFirmId","runId","resultOccurrenceFingerprint") DO NOTHING
    RETURNING "id"
  `);
  if (inserted.length === 0) return; // already fully persisted (result + evidence) by the winning unit

  const auditResultId = inserted[0]!.id;
  for (const e of d.evidence) await insertEvidence(tx, ctx, pin, auditResultId, e);
}

/** Insert one typed evidence row after proving it belongs to the frozen population. */
async function insertEvidence(tx: TenantTx, ctx: ExecutionContext, pin: TestPin, auditResultId: string, e: EvidenceRef): Promise<void> {
  const id = randomUUID();
  const firm = ctx.auditFirmId;
  const role = e.role ?? null;
  if (e.evidenceType === "IMPORTED_RECORD") {
    await assertMember(tx, ctx.preparationId, pin.auditTestVersionId, e.datasetId, e.sourceRowNo);
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "audit_result_evidence" ("id","auditFirmId","auditResultId","evidenceType","role","importedRecordId","sourceRowNo","eoiFrameHash")
      VALUES (${id}, ${firm}, ${auditResultId}, 'IMPORTED_RECORD'::"AuditEvidenceType", ${role}, ${e.importedRecordId}, ${e.sourceRowNo}, ${e.eoiFrameHash})`);
  } else if (e.evidenceType === "JOURNAL_LINE") {
    await assertMember(tx, ctx.preparationId, pin.auditTestVersionId, e.datasetId, e.sourceRowNo);
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "audit_result_evidence" ("id","auditFirmId","auditResultId","evidenceType","role","journalLineId","lineNo","sourceRowNo","eoiFrameHash")
      VALUES (${id}, ${firm}, ${auditResultId}, 'JOURNAL_LINE'::"AuditEvidenceType", ${role}, ${e.journalLineId}, ${e.lineNo}, ${e.sourceRowNo}, ${e.eoiFrameHash})`);
  } else if (e.evidenceType === "JOURNAL_ENTRY") {
    await assertJEFullyInPopulation(tx, ctx.preparationId, pin.auditTestVersionId, e.journalEntryId, e.datasetId);
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "audit_result_evidence" ("id","auditFirmId","auditResultId","evidenceType","role","journalEntryId","sourceEntryId","eoiFrameHash")
      VALUES (${id}, ${firm}, ${auditResultId}, 'JOURNAL_ENTRY'::"AuditEvidenceType", ${role}, ${e.journalEntryId}, ${e.sourceEntryId}, ${e.eoiFrameHash})`);
  } else {
    await assertMember(tx, ctx.preparationId, pin.auditTestVersionId, e.datasetId, e.sourceRowNo);
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "audit_result_evidence" ("id","auditFirmId","auditResultId","evidenceType","role","trialBalanceRowId","sourceRowNo","eoiFrameHash")
      VALUES (${id}, ${firm}, ${auditResultId}, 'TRIAL_BALANCE_ROW'::"AuditEvidenceType", ${role}, ${e.trialBalanceRowId}, ${e.sourceRowNo}, ${e.eoiFrameHash})`);
  }
}
