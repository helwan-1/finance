import type { TenantTx } from "@/lib/db/tenant";
import { withTenantContext } from "@/lib/db/tenant";
import { createDraftRun } from "@/lib/g4/run";
import { beginPreparation, sealPreparation, type TestSelection } from "@/lib/g4/preparation";
import { publishRun } from "@/lib/g4/publish";

/**
 * G6 Phase B — authenticated AuditRun application boundary.
 *
 * Everything that a human auditor is allowed to do to an AuditRun over HTTP is
 * funneled through this module. It adds the engagement-level authorization that
 * the G4 headless engine never enforced (G4 tables carry firm-scoped RLS but NO
 * DB-level engagement-membership guard, unlike G5). Two authorization layers
 * apply on every call:
 *
 *   1. Tenant isolation — the firm ALWAYS comes from the verified session
 *      (`actor.auditFirmId`), never from the client, and every DB access runs
 *      inside `withTenantContext`, so PostgreSQL RLS restricts visibility to the
 *      caller's firm. A resource in another firm is invisible → surfaced as 404,
 *      never 403 (no cross-firm existence oracle).
 *   2. Engagement membership — the actor must be an `EngagementMember` of the
 *      engagement the resource belongs to. The engagement is ALWAYS resolved
 *      from the resource itself (runId → AuditRun.engagementId), never taken
 *      from the client, so a caller cannot present a foreign runId with an
 *      engagement they happen to belong to (no confused-deputy).
 *
 * TOCTOU / transaction composition
 * --------------------------------
 * Reads resolve the resource, assert membership, and read WITHIN A SINGLE
 * `withTenantContext` transaction — fully atomic, no gap.
 *
 * Commands cannot share one interactive transaction with the existing G4
 * command functions (each opens its own `withTenantContext`; none accept an
 * injected tx). The two-transaction composition here is nonetheless free of an
 * authorization-bypass gap because the authorization facts are invariant across
 * the two transactions:
 *   - the firm is a fixed session value and is RLS-enforced identically in both
 *     transactions (a run's `auditFirmId` is itself immutable under RLS);
 *   - a run's `engagementId` is immutable — no code path anywhere UPDATEs
 *     `audit_runs.engagementId`; it is set once at `createDraftRun` and only
 *     ever read thereafter (there is no "move run to another engagement"
 *     command). See the `engagementId immutability` boundary test.
 * Therefore the engagement resolved (and membership-checked) in the
 * authorization transaction is exactly the engagement the command operates on.
 * A membership *revocation* interleaved between the two transactions is an
 * ordinary permission race (the actor was authorized at check time), not a
 * TOCTOU authorization-bypass, and never lets a non-member act.
 *
 * If a future gate introduces a command that mutates `audit_runs.engagementId`,
 * this invariant breaks and command authorization MUST move into the same
 * transaction as the mutation (or the field must be made set-once at the DB
 * layer). This module intentionally exposes NO such command, NO synchronous
 * `executeRun`, and NO `materializePopulation` — those remain out of the HTTP
 * boundary.
 */

export type RunAccessErrorCode = "NOT_FOUND" | "FORBIDDEN";

/** Authorization/resolution failure carrying the HTTP status the route returns. */
export class RunAccessError extends Error {
  constructor(public readonly code: RunAccessErrorCode, message: string) {
    super(message);
    this.name = "RunAccessError";
  }
  get status(): number {
    return this.code === "NOT_FOUND" ? 404 : 403;
  }
}

/** The actor is derived exclusively from the verified session. */
export interface RunActor {
  userId: string;
  auditFirmId: string;
}

export interface RunSummary {
  id: string;
  engagementId: string;
  clientCompanyId: string | null;
  status: string;
  freezeGeneration: string | null;
  configFingerprint: string | null;
  engineBuildVersion: string | null;
  frozenAt: string | null;
  label: string | null;
  maxAttempts: number;
  createdAt: string;
  updatedAt: string;
}

const RUN_SELECT = {
  id: true, engagementId: true, clientCompanyId: true, status: true,
  freezeGeneration: true, configFingerprint: true, engineBuildVersion: true,
  frozenAt: true, label: true, maxAttempts: true, createdAt: true, updatedAt: true,
} as const;

function toRunSummary(r: {
  id: string; engagementId: string; clientCompanyId: string | null; status: string;
  freezeGeneration: string | null; configFingerprint: string | null; engineBuildVersion: string | null;
  frozenAt: Date | null; label: string | null; maxAttempts: number; createdAt: Date; updatedAt: Date;
}): RunSummary {
  return {
    id: r.id, engagementId: r.engagementId, clientCompanyId: r.clientCompanyId, status: r.status,
    freezeGeneration: r.freezeGeneration, configFingerprint: r.configFingerprint,
    engineBuildVersion: r.engineBuildVersion, frozenAt: r.frozenAt ? r.frozenAt.toISOString() : null,
    label: r.label, maxAttempts: r.maxAttempts,
    createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
  };
}

/**
 * Assert the actor is a member of `engagementId`. MUST be called inside a
 * `withTenantContext(actor.auditFirmId, …)` transaction so RLS firm-scopes both
 * the engagement and the membership row (engagement_members RLS joins to
 * audit_engagements on the current firm GUC). A foreign-firm engagement is
 * invisible → NOT_FOUND; an in-firm engagement without a membership row →
 * FORBIDDEN.
 */
async function assertEngagementMembership(tx: TenantTx, actor: RunActor, engagementId: string): Promise<void> {
  const eng = await tx.auditEngagement.findUnique({ where: { id: engagementId }, select: { id: true } });
  if (!eng) throw new RunAccessError("NOT_FOUND", "engagement not found");
  const member = await tx.engagementMember.findUnique({
    where: { engagementId_userId: { engagementId, userId: actor.userId } },
    select: { id: true },
  });
  if (!member) throw new RunAccessError("FORBIDDEN", "actor is not a member of the engagement");
}

/** Resolve a run under the caller's firm (RLS). NOT_FOUND when absent/foreign. */
async function resolveRun(tx: TenantTx, runId: string) {
  const run = await tx.auditRun.findUnique({ where: { id: runId }, select: RUN_SELECT });
  if (!run) throw new RunAccessError("NOT_FOUND", "run not found");
  return run;
}

/**
 * Resolve a run AND assert the actor's membership of its engagement, in one tx.
 * Returns the run row so read callers can use it without re-querying.
 */
async function authorizeRun(tx: TenantTx, actor: RunActor, runId: string) {
  const run = await resolveRun(tx, runId);
  await assertEngagementMembership(tx, actor, run.engagementId);
  return run;
}

// ── Reads (single-transaction: resolve + membership + read, fully atomic) ──

export async function getRun(actor: RunActor, runId: string): Promise<RunSummary> {
  return withTenantContext(actor.auditFirmId, async (tx) => toRunSummary(await authorizeRun(tx, actor, runId)));
}

export async function listRunsForEngagement(actor: RunActor, engagementId: string): Promise<RunSummary[]> {
  return withTenantContext(actor.auditFirmId, async (tx) => {
    await assertEngagementMembership(tx, actor, engagementId);
    const rows = await tx.auditRun.findMany({
      where: { engagementId }, orderBy: { createdAt: "desc" }, take: 200, select: RUN_SELECT,
    });
    return rows.map(toRunSummary);
  });
}

export interface JobSummary {
  id: string; attemptNo: number; status: string; leaseOwner: string | null;
  failureCode: string | null; startedAt: string | null; completedAt: string | null;
}

export async function getRunJobs(actor: RunActor, runId: string): Promise<JobSummary[]> {
  return withTenantContext(actor.auditFirmId, async (tx) => {
    await authorizeRun(tx, actor, runId);
    const jobs = await tx.auditJob.findMany({
      where: { runId }, orderBy: { attemptNo: "asc" },
      select: { id: true, attemptNo: true, status: true, leaseOwner: true, failureCode: true, startedAt: true, completedAt: true },
    });
    return jobs.map((j) => ({
      id: j.id, attemptNo: j.attemptNo, status: j.status, leaseOwner: j.leaseOwner, failureCode: j.failureCode,
      startedAt: j.startedAt ? j.startedAt.toISOString() : null,
      completedAt: j.completedAt ? j.completedAt.toISOString() : null,
    }));
  });
}

export interface ResultSummary {
  id: string; auditRunTestVersionId: string; resultKind: string; resultCode: string;
  severity: string; score: string; resultSemanticFingerprint: string;
}

export async function getRunResults(actor: RunActor, runId: string, take = 500): Promise<ResultSummary[]> {
  return withTenantContext(actor.auditFirmId, async (tx) => {
    await authorizeRun(tx, actor, runId);
    const rows = await tx.auditResult.findMany({
      where: { runId }, orderBy: { resultSemanticFingerprint: "asc" }, take: Math.min(Math.max(take, 1), 1000),
      select: { id: true, auditRunTestVersionId: true, resultKind: true, resultCode: true, severity: true, score: true, resultSemanticFingerprint: true },
    });
    return rows.map((r) => ({
      id: r.id, auditRunTestVersionId: r.auditRunTestVersionId, resultKind: r.resultKind, resultCode: r.resultCode,
      severity: String(r.severity), score: r.score.toString(), resultSemanticFingerprint: r.resultSemanticFingerprint,
    }));
  });
}

// ── Commands (authorize tx, then the existing G4 command; see TOCTOU note) ──

export interface CreateRunInput {
  engagementId: string;
  maxAttempts?: number;
  label?: string | null;
  supersedesRunId?: string | null;
}

export async function createRun(actor: RunActor, input: CreateRunInput): Promise<{ runId: string }> {
  // Membership is checked on the client-supplied engagementId; createDraftRun
  // then creates the run under that SAME engagementId (consistent by
  // construction) and binds createdById to the session actor (provenance).
  await withTenantContext(actor.auditFirmId, (tx) => assertEngagementMembership(tx, actor, input.engagementId));
  const { runId } = await createDraftRun(actor.auditFirmId, {
    engagementId: input.engagementId,
    createdById: actor.userId,
    maxAttempts: input.maxAttempts,
    label: input.label ?? null,
    supersedesRunId: input.supersedesRunId ?? null,
  });
  return { runId };
}

export interface BeginPreparationInput {
  tests: TestSelection[];
  datasetIds: string[];
  batchSize?: number;
}

export async function beginRunPreparation(
  actor: RunActor, runId: string, input: BeginPreparationInput,
): Promise<{ prepId: string; generationNo: number }> {
  await withTenantContext(actor.auditFirmId, (tx) => authorizeRun(tx, actor, runId));
  return beginPreparation(actor.auditFirmId, { runId, tests: input.tests, datasetIds: input.datasetIds, batchSize: input.batchSize });
}

/** Assert a preparation belongs to `runId` within the caller's firm (RLS). */
async function assertPrepBelongsToRun(tx: TenantTx, prepId: string, runId: string): Promise<void> {
  const prep = await tx.auditRunPreparation.findUnique({ where: { id: prepId }, select: { runId: true } });
  if (!prep) throw new RunAccessError("NOT_FOUND", "preparation not found");
  if (prep.runId !== runId) throw new RunAccessError("NOT_FOUND", "preparation does not belong to run");
}

export async function sealRunPreparation(actor: RunActor, runId: string, prepId: string): Promise<{ manifestHash: string }> {
  await withTenantContext(actor.auditFirmId, async (tx) => {
    await authorizeRun(tx, actor, runId);
    await assertPrepBelongsToRun(tx, prepId, runId);
  });
  return sealPreparation(actor.auditFirmId, prepId);
}

export async function publishRunForActor(
  actor: RunActor, runId: string, prepId: string,
): Promise<{ configFingerprint: string; engineBuildVersion: string }> {
  await withTenantContext(actor.auditFirmId, async (tx) => {
    await authorizeRun(tx, actor, runId);
    await assertPrepBelongsToRun(tx, prepId, runId);
  });
  return publishRun(actor.auditFirmId, runId, prepId);
}
