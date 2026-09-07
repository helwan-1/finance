import { createHash } from "node:crypto";
import type { TenantTx } from "@/lib/db/tenant";
import { withTenantContext } from "@/lib/db/tenant";
import { demoAllowed } from "@/lib/security/env";
import { createDraftRun } from "@/lib/g4/run";
import { beginPreparation, sealPreparation, type TestSelection } from "@/lib/g4/preparation";
import { publishRun } from "@/lib/g4/publish";
import { parseRoundConfig, parseDuplicateConfig, gcd } from "@/lib/g4/execution/statistical/config";

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

/**
 * Deterministic run/preparation lifecycle-state failure → HTTP 409. The boundary
 * pre-checks the run/preparation state (which it already reads while authorizing)
 * and raises a stable code, so a state failure never reaches the client as a raw
 * G4 message. The underlying G4 command remains the authority and re-validates.
 */
export type RunStateErrorCode = "INVALID_RUN_STATE" | "PREPARATION_NOT_COMPLETE" | "PREPARATION_ALREADY_ACTIVE";
export class RunStateError extends Error {
  readonly status = 409;
  constructor(public readonly code: RunStateErrorCode, message: string) {
    super(message);
    this.name = "RunStateError";
  }
}

/** Malformed/invalid request input → HTTP 422 VALIDATION. */
export class RunValidationError extends Error {
  readonly status = 422;
  readonly code = "VALIDATION" as const;
  constructor(message: string) {
    super(message);
    this.name = "RunValidationError";
  }
}

/**
 * Deterministically-identifiable G4 configuration failure (e.g. a selected test
 * that does not exist or has no ACTIVE current version, or a missing dataset) →
 * HTTP 422 CONFIGURATION. Pre-checked at the boundary so a stable code is
 * returned rather than a raw G4 message; G4 remains the authority.
 */
export class RunConfigError extends Error {
  readonly status = 422;
  readonly code = "CONFIGURATION" as const;
  constructor(message: string) {
    super(message);
    this.name = "RunConfigError";
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
  // Frozen semantic-scope snapshot (ADR). Read ONLY from the AuditRun frozen
  // columns — never substituted from current AuditFirm.licenseNo /
  // AuditEngagement.fiscalYear / a recomputed client key. NULL for DRAFT/unfrozen
  // runs and for legacy runs frozen before the snapshot existed.
  frozenFirmLicenseNo: string | null;
  frozenFiscalYear: number | null;
  frozenClientSemanticKey: string | null;
  label: string | null;
  maxAttempts: number;
  createdAt: string;
  updatedAt: string;
}

const RUN_SELECT = {
  id: true, engagementId: true, clientCompanyId: true, status: true,
  freezeGeneration: true, configFingerprint: true, engineBuildVersion: true,
  frozenAt: true, frozenFirmLicenseNo: true, frozenFiscalYear: true, frozenClientSemanticKey: true,
  label: true, maxAttempts: true, createdAt: true, updatedAt: true,
} as const;

function toRunSummary(r: {
  id: string; engagementId: string; clientCompanyId: string | null; status: string;
  freezeGeneration: string | null; configFingerprint: string | null; engineBuildVersion: string | null;
  frozenAt: Date | null; frozenFirmLicenseNo: string | null; frozenFiscalYear: number | null;
  frozenClientSemanticKey: string | null; label: string | null; maxAttempts: number; createdAt: Date; updatedAt: Date;
}): RunSummary {
  return {
    id: r.id, engagementId: r.engagementId, clientCompanyId: r.clientCompanyId, status: r.status,
    freezeGeneration: r.freezeGeneration, configFingerprint: r.configFingerprint,
    engineBuildVersion: r.engineBuildVersion, frozenAt: r.frozenAt ? r.frozenAt.toISOString() : null,
    // Verbatim from AuditRun frozen columns — no live-master substitution.
    frozenFirmLicenseNo: r.frozenFirmLicenseNo, frozenFiscalYear: r.frozenFiscalYear,
    frozenClientSemanticKey: r.frozenClientSemanticKey,
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

// ── #6 Audit-result (مؤشّر) detail: result + evidence traced to source rows ──

export interface ResultEvidenceRecord {
  evidenceType: string;
  datasetId: string | null;
  sourceRowNo: number | null;
  role: string | null;
  importedRecordId: string | null;
  /** Source row as imported (header/value pairs, in column order); null if not an imported record. */
  cells: { h: string; v: string | null }[] | null;
}
export interface ResultDetail {
  id: string;
  runId: string;
  resultKind: string;
  resultCode: string;
  severity: string;
  score: string;
  resultSemanticFingerprint: string;
  dispositionState: string;
  evidence: ResultEvidenceRecord[];
}

/** Positional raw cells [{i,h,v}] → header/value pairs in column order. */
function normalizeCells(raw: unknown): { h: string; v: string | null }[] | null {
  if (!Array.isArray(raw)) return null;
  return (raw as { i?: number; h?: string; v?: string | null }[])
    .slice()
    .sort((a, b) => (a.i ?? 0) - (b.i ?? 0))
    .map((c) => ({ h: String(c.h ?? ""), v: c.v == null ? null : String(c.v) }));
}

/**
 * Full detail for one audit result (مؤشّر) the actor may see: the result core,
 * its current disposition state, and every evidence row traced back to the
 * imported source record (so the auditor sees WHAT the indicator refers to).
 * Single transaction: resolve result → its run → engagement membership → read.
 */
export async function getAuditResultDetail(actor: RunActor, resultId: string): Promise<ResultDetail> {
  return withTenantContext(actor.auditFirmId, async (tx) => {
    const r = await tx.auditResult.findUnique({
      where: { id: resultId },
      select: { id: true, runId: true, resultKind: true, resultCode: true, severity: true, score: true, resultSemanticFingerprint: true },
    });
    if (!r) throw new RunAccessError("NOT_FOUND", "result not found");
    await authorizeRun(tx, actor, r.runId); // engagement membership via the result's run
    const disp = await tx.auditResultDispositionState.findFirst({ where: { auditResultId: r.id }, select: { currentState: true } });
    const ev = await tx.auditResultEvidence.findMany({
      where: { auditResultId: r.id },
      orderBy: [{ datasetId: "asc" }, { sourceRowNo: "asc" }], take: 200,
      select: { evidenceType: true, datasetId: true, sourceRowNo: true, role: true, importedRecordId: true },
    });
    const recIds = ev.map((e) => e.importedRecordId).filter((x): x is string => !!x);
    const recs = recIds.length
      ? await tx.importedRecord.findMany({ where: { id: { in: recIds } }, select: { id: true, rawCells: true } })
      : [];
    const recMap = new Map(recs.map((x) => [x.id, x.rawCells]));
    return {
      id: r.id, runId: r.runId, resultKind: r.resultKind, resultCode: r.resultCode,
      severity: String(r.severity), score: r.score.toString(), resultSemanticFingerprint: r.resultSemanticFingerprint,
      dispositionState: disp?.currentState ? String(disp.currentState) : "UNREVIEWED",
      evidence: ev.map((e) => ({
        evidenceType: String(e.evidenceType), datasetId: e.datasetId, sourceRowNo: e.sourceRowNo,
        role: e.role ?? null, importedRecordId: e.importedRecordId,
        cells: e.importedRecordId ? normalizeCells(recMap.get(e.importedRecordId)) : null,
      })),
    };
  });
}

export interface DatasetOption { id: string; kind: string; status: string; datasetHash: string | null; createdAt: string }
export interface TestOption { key: string; name: string; nameAr: string; testType: string }
export interface PreparationSummary { id: string; generationNo: number; status: string; failureCode: string | null; sealedAt: string | null }

/** Consumable datasets in an engagement the actor belongs to (for run config). */
export async function listDatasetsForEngagement(actor: RunActor, engagementId: string): Promise<DatasetOption[]> {
  return withTenantContext(actor.auditFirmId, async (tx) => {
    await assertEngagementMembership(tx, actor, engagementId);
    const rows = await tx.dataset.findMany({
      where: { engagementId, status: { in: ["COMPLETED", "COMPLETED_WITH_ISSUES"] } },
      orderBy: { createdAt: "desc" }, take: 200,
      select: { id: true, kind: true, status: true, datasetHash: true, createdAt: true },
    });
    return rows.map((d) => ({ id: d.id, kind: d.kind, status: String(d.status), datasetHash: d.datasetHash, createdAt: d.createdAt.toISOString() }));
  });
}

/**
 * Delete an imported dataset that has NOT been consumed by any audit run. A
 * dataset used in a run is permanent audit evidence — protected by RESTRICT
 * foreign keys and refused here with a clear message. On delete, all source
 * custody and canonical rows (imported records, journal entries/lines, dataset
 * accounts, contexts, trial balances/rows, import issues) cascade automatically.
 * There is no "edit": datasets are immutable, content-addressed evidence — to
 * correct data, re-import a new file (which creates a new dataset).
 */
export async function deleteDataset(actor: RunActor, datasetId: string): Promise<{ deleted: true }> {
  return withTenantContext(actor.auditFirmId, async (tx) => {
    const ds = await tx.dataset.findUnique({ where: { id: datasetId }, select: { id: true, engagementId: true } });
    if (!ds) throw new RunAccessError("NOT_FOUND", "dataset not found");
    await assertEngagementMembership(tx, actor, ds.engagementId);

    // A dataset consumed by any run is frozen audit evidence — never deletable.
    const usedInRun = await tx.auditRunDataset.count({ where: { datasetId } });
    if (usedInRun > 0) {
      throw new RunValidationError(
        "لا يمكن حذف مجموعة بيانات مستخدمة في عملية تدقيق (دليل ثابت). أنشئ استيرادًا جديدًا بدلًا من ذلك.",
      );
    }

    try {
      // Clear the one self-referential RESTRICT FK (import_batches.resultDatasetId)
      // so the cascade delete can proceed; every other child row cascades on delete.
      await tx.importBatch.updateMany({ where: { resultDatasetId: datasetId }, data: { resultDatasetId: null } });
      await tx.dataset.delete({ where: { id: datasetId } });
    } catch (e) {
      // A RESTRICT FK (a run/evidence table) means it is still referenced.
      if ((e as { code?: string })?.code === "P2003") {
        throw new RunValidationError("لا يمكن حذف هذه المجموعة لأنها مرتبطة بسجلات تدقيق.");
      }
      // Surface the real cause: log it, and outside production return the detail
      // so it is visible during setup/testing rather than a generic 503.
      console.error("[datasets:delete] failed", e);
      if (demoAllowed()) {
        const code = (e as { code?: string })?.code;
        throw new RunValidationError(`تعذّر الحذف — ${code ? code + ": " : ""}${e instanceof Error ? e.message : String(e)}`);
      }
      throw e;
    }
    return { deleted: true } as const;
  });
}

/** Firm audit tests that have an ACTIVE current version (selectable for a run). */
export async function listAuditTests(actor: RunActor): Promise<TestOption[]> {
  return withTenantContext(actor.auditFirmId, async (tx) => {
    const tests = await tx.auditTest.findMany({
      where: { currentVersionId: { not: null } },
      orderBy: { key: "asc" }, take: 500,
      select: { key: true, name: true, nameAr: true, testType: true, currentVersionId: true },
    });
    const activeIds = new Set(
      (await tx.auditTestVersion.findMany({
        where: { id: { in: tests.map((t) => t.currentVersionId!).filter(Boolean) }, status: "ACTIVE" },
        select: { id: true },
      })).map((v) => v.id),
    );
    return tests
      .filter((t) => t.currentVersionId && activeIds.has(t.currentVersionId))
      .map((t) => ({ key: t.key, name: t.name, nameAr: t.nameAr, testType: String(t.testType) }));
  });
}

// ── #7 Audit-test authoring (config-free executors only) ──
//
// The curated set of test executors that need NO run-time parameters, so a test
// created from the UI is always executable (statistical executors require frozen
// thresholds and are intentionally excluded from self-service authoring for now).
// Value = dataset kinds the executor supports (and the choices offered for
// requiredDatasetKinds). Keys are "<testType>:<kind>" (the registry key).
export const CREATABLE_TEST_KINDS: Record<string, { testType: string; kind: string; datasetKinds: string[]; params?: "round" | "dupamt" }> = {
  "DATA_QUALITY:POPULATION_MEMBER": { testType: "DATA_QUALITY", kind: "POPULATION_MEMBER", datasetKinds: ["GENERAL_LEDGER", "TRIAL_BALANCE", "BANK", "OTHER"] },
  "DATA_QUALITY:SOURCE_TO_CANONICAL_MISMATCH": { testType: "DATA_QUALITY", kind: "SOURCE_TO_CANONICAL_MISMATCH", datasetKinds: ["GENERAL_LEDGER", "TRIAL_BALANCE", "BANK", "OTHER"] },
  "ACCOUNTING_INTEGRITY:UNBALANCED_JE": { testType: "ACCOUNTING_INTEGRITY", kind: "UNBALANCED_JE", datasetKinds: ["GENERAL_LEDGER"] },
  "ACCOUNTING_INTEGRITY:INVALID_DEBIT_CREDIT": { testType: "ACCOUNTING_INTEGRITY", kind: "INVALID_DEBIT_CREDIT", datasetKinds: ["GENERAL_LEDGER"] },
  "ACCOUNTING_INTEGRITY:TB_ACCOUNT_DUPLICATION": { testType: "ACCOUNTING_INTEGRITY", kind: "TB_ACCOUNT_DUPLICATION", datasetKinds: ["TRIAL_BALANCE"] },
  // Statistical executors carry FROZEN parameters stored on the version and
  // injected into the run at preparation (see enrichSelections). Params are
  // validated with the engine's own parsers at authoring time.
  "STATISTICAL:ROUND_NUMBER_FREQUENCY": { testType: "STATISTICAL", kind: "ROUND_NUMBER_FREQUENCY", datasetKinds: ["GENERAL_LEDGER"], params: "round" },
  "STATISTICAL:DUPLICATE_AMOUNT_FREQUENCY": { testType: "STATISTICAL", kind: "DUPLICATE_AMOUNT_FREQUENCY", datasetKinds: ["GENERAL_LEDGER"], params: "dupamt" },
};

const KEY_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$/;

/** Assemble + validate the frozen statistical parameters from user-entered fields. */
function buildStatParams(kind: "round" | "dupamt", raw: Record<string, unknown>): Record<string, unknown> {
  const int = (v: unknown) => (typeof v === "number" ? v : Number.parseInt(String(v ?? ""), 10));
  try {
    if (kind === "round") {
      let num = int(raw.rateThresholdNum);
      let denom = int(raw.rateThresholdDenom);
      if (Number.isInteger(num) && Number.isInteger(denom) && denom > 0) {
        const g = gcd(num, denom) || 1; // reduce to lowest terms (parser requires gcd===1)
        num = num / g; denom = denom / g;
      }
      const params = {
        amountBasis: "TRANSACTION", methodVersion: "st.round.1",
        roundingQuantum: String(raw.roundingQuantum ?? ""),
        minimumPopulation: int(raw.minimumPopulation),
        minimumRoundCount: int(raw.minimumRoundCount),
        rateThresholdNum: num, rateThresholdDenom: denom,
      };
      parseRoundConfig(params); // throws ConfigError on invalid
      return params;
    }
    const params = { amountBasis: "TRANSACTION", methodVersion: "st.dupamt.1", minimumOccurrenceCount: int(raw.minimumOccurrenceCount) };
    parseDuplicateConfig(params);
    return params;
  } catch (e) {
    throw new RunValidationError(`إعدادات الاختبار الإحصائي غير صالحة: ${e instanceof Error ? e.message : "قيم غير صحيحة"}`);
  }
}

export interface CreateAuditTestInput {
  key: string;
  name: string;
  nameAr: string;
  testType: string;
  kind: string;
  requiredDatasetKinds: string[];
  requiresAccountMapping?: boolean;
  /** Statistical executors only: user-entered parameter fields. */
  params?: Record<string, unknown>;
}

/**
 * Create a firm audit test with an ACTIVE version 1 (self-service authoring).
 * Firm-scoped (RLS); no engagement membership (tests are firm-level library
 * items). Config-free executors need no parameters; statistical executors carry
 * validated frozen parameters on the version. Input errors → RunValidationError.
 */
export async function createAuditTest(actor: RunActor, input: CreateAuditTestInput): Promise<{ testKey: string }> {
  const key = (input.key ?? "").trim();
  if (!KEY_RE.test(key)) throw new RunValidationError("مفتاح الاختبار غير صالح (أحرف/أرقام/‏- ‏_ فقط، 2–64 خانة)");
  const spec = CREATABLE_TEST_KINDS[`${input.testType}:${input.kind}`];
  if (!spec) throw new RunValidationError("نوع اختبار غير مدعوم للإنشاء الذاتي");
  const requiredDatasetKinds = [...new Set((input.requiredDatasetKinds ?? []).filter((k) => spec.datasetKinds.includes(k)))];
  if (requiredDatasetKinds.length === 0) throw new RunValidationError("اختر نوع بيانات واحدًا على الأقل يناسب الاختبار");
  const nameAr = (input.nameAr ?? "").trim();
  const name = (input.name ?? "").trim() || nameAr || key;
  if (!nameAr && !(input.name ?? "").trim()) throw new RunValidationError("اسم الاختبار مطلوب");
  const statParams = spec.params ? buildStatParams(spec.params, input.params ?? {}) : null;
  const definition = statParams ? { kind: spec.kind, params: statParams } : { kind: spec.kind };
  const requirements = { requiredDatasetKinds, ...(input.requiresAccountMapping ? { requiresAccountMapping: true } : {}) };
  const versionHash = createHash("sha256")
    .update(JSON.stringify({ f: actor.auditFirmId, key, v: 1, tt: spec.testType, def: definition, req: requirements }))
    .digest("hex");

  return withTenantContext(actor.auditFirmId, async (tx) => {
    const existing = await tx.auditTest.findUnique({
      where: { auditFirmId_key: { auditFirmId: actor.auditFirmId, key } }, select: { id: true },
    });
    if (existing) throw new RunValidationError("يوجد اختبار بنفس المفتاح");
    const test = await tx.auditTest.create({
      data: { auditFirmId: actor.auditFirmId, key, name, nameAr: nameAr || name, testType: spec.testType as never },
      select: { id: true },
    });
    const tv = await tx.auditTestVersion.create({
      data: {
        auditFirmId: actor.auditFirmId, auditTestId: test.id, version: 1, testType: spec.testType as never,
        definitionJson: definition as object, requirementsJson: requirements as object, versionHash, status: "ACTIVE",
      },
      select: { id: true },
    });
    await tx.auditTest.update({ where: { id: test.id }, data: { currentVersionId: tv.id } });
    return { testKey: key };
  });
}

/** Latest preparation generation for a run the actor belongs to (status polling). */
export async function getLatestPreparation(actor: RunActor, runId: string): Promise<PreparationSummary | null> {
  return withTenantContext(actor.auditFirmId, async (tx) => {
    await authorizeRun(tx, actor, runId);
    const prep = await tx.auditRunPreparation.findFirst({
      where: { runId }, orderBy: { generationNo: "desc" },
      select: { id: true, generationNo: true, status: true, failureCode: true, sealedAt: true },
    });
    if (!prep) return null;
    return { id: prep.id, generationNo: prep.generationNo, status: String(prep.status), failureCode: prep.failureCode, sealedAt: prep.sealedAt ? prep.sealedAt.toISOString() : null };
  });
}

// ── Commands (authorize tx, then the existing G4 command; see TOCTOU note) ──

export interface CreateRunInput {
  engagementId: string;
  maxAttempts?: number;
  label?: string | null;
  supersedesRunId?: string | null;
}

/**
 * Create a DRAFT AuditRun.
 *
 * G6-DEBT-001 (create-request idempotency remains OPEN): this endpoint is
 * INTENTIONALLY NON-IDEMPOTENT. It takes no idempotency key and performs no
 * dedup — a repeated successful request may create ANOTHER DRAFT AuditRun. The
 * server MUST NOT auto-retry createRun. No idempotency table/key is introduced
 * (a DRAFT run carries no authoritative generation and is discardable), so this
 * is a documented, accepted limitation rather than fake idempotency. Closing it
 * (a client-supplied creation idempotency key) is deferred future work.
 */
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

const PREPARABLE_RUN_STATES = ["DRAFT", "PREPARING"];

/** Deterministic config pre-check: every selected test resolves to an ACTIVE
 * current version, and every dataset exists — under the caller's firm (RLS).
 * Raises a stable CONFIGURATION (422) code instead of a raw G4 message. */
async function assertPreparableConfig(tx: TenantTx, engagementId: string, tests: TestSelection[], datasetIds: string[]): Promise<void> {
  if (tests.length === 0 || datasetIds.length === 0) {
    throw new RunValidationError("at least one test and one dataset are required");
  }
  for (const sel of tests) {
    // Firm is already bound by RLS, so a key lookup resolves within the tenant.
    const t = await tx.auditTest.findFirst({ where: { key: sel.testKey }, select: { currentVersionId: true } });
    if (!t) throw new RunConfigError(`selected test does not exist: ${sel.testKey}`);
    if (!t.currentVersionId) throw new RunConfigError(`selected test has no current version: ${sel.testKey}`);
    const v = await tx.auditTestVersion.findUnique({ where: { id: t.currentVersionId }, select: { status: true } });
    if (!v || v.status !== "ACTIVE") throw new RunConfigError(`selected test has no ACTIVE current version: ${sel.testKey}`);
  }
  for (const dsId of datasetIds) {
    const ds = await tx.dataset.findUnique({ where: { id: dsId }, select: { engagementId: true } });
    if (!ds) throw new RunConfigError(`selected dataset does not exist: ${dsId}`);
    if (ds.engagementId !== engagementId) throw new RunConfigError(`selected dataset is not in the run engagement: ${dsId}`);
  }
}

/**
 * Enrich each test selection with the FROZEN parameters stored on its active
 * version's definitionJson (`params`). This is how statistical tests carry their
 * reproducible config into a run even though the UI selects tests by key only.
 * A caller-supplied `parameters` (if any) wins; config-free tests are unchanged.
 */
async function enrichSelections(tx: TenantTx, tests: TestSelection[]): Promise<TestSelection[]> {
  const out: TestSelection[] = [];
  for (const sel of tests) {
    if (sel.parameters && Object.keys(sel.parameters).length > 0) { out.push(sel); continue; }
    const t = await tx.auditTest.findFirst({ where: { key: sel.testKey }, select: { currentVersionId: true } });
    const v = t?.currentVersionId
      ? await tx.auditTestVersion.findUnique({ where: { id: t.currentVersionId }, select: { definitionJson: true } })
      : null;
    const def = (v?.definitionJson ?? {}) as { params?: Record<string, unknown> };
    out.push(def.params && typeof def.params === "object" && Object.keys(def.params).length > 0
      ? { testKey: sel.testKey, parameters: def.params }
      : sel);
  }
  return out;
}

export async function beginRunPreparation(
  actor: RunActor, runId: string, input: BeginPreparationInput,
): Promise<{ prepId: string; generationNo: number }> {
  const enrichedTests = await withTenantContext(actor.auditFirmId, async (tx) => {
    const run = await authorizeRun(tx, actor, runId);
    if (!PREPARABLE_RUN_STATES.includes(run.status)) {
      throw new RunStateError("INVALID_RUN_STATE", `run is not preparable in status ${run.status}`);
    }
    // At-most-one-active-generation invariant (PREP-GEN-MULTIPLICITY): a run may
    // carry many historical generations, but only ONE unsealed/PREPARING one at a
    // time. Fast deterministic pre-check; the partial unique index
    // ux_prep_active_generation_per_run is the race-safe authority (see the
    // concurrent-race translation below).
    const active = await tx.auditRunPreparation.findFirst({ where: { runId, status: "PREPARING" }, select: { id: true } });
    if (active) {
      throw new RunStateError("PREPARATION_ALREADY_ACTIVE", "an active preparation generation already exists for this run");
    }
    await assertPreparableConfig(tx, run.engagementId, input.tests, input.datasetIds);
    // Inject each test version's frozen parameters (statistical tests) so the run
    // freezes a complete, reproducible config even though the UI selects tests by
    // key only. Config-free tests pass through unchanged.
    return enrichSelections(tx, input.tests);
  });
  try {
    return await beginPreparation(actor.auditFirmId, { runId, tests: enrichedTests, datasetIds: input.datasetIds, batchSize: input.batchSize });
  } catch (e) {
    // Concurrent-race authority: two callers can both pass the pre-check; the DB
    // then rejects the losing INSERT on a per-run preparation uniqueness (the new
    // active-generation index, or the pre-existing (runId,generationNo) unique when
    // both raced to the same next number). Both mean "a competing begin on the same
    // run" → the SAME deterministic 409, never a leaked Prisma/PostgreSQL error.
    if (isActivePreparationConflict(e)) {
      throw new RunStateError("PREPARATION_ALREADY_ACTIVE", "an active preparation generation already exists for this run");
    }
    throw e;
  }
}

/**
 * Narrow identification of a per-run preparation uniqueness violation (Prisma
 * P2002) — tied SPECIFICALLY to the active-generation partial unique index or the
 * (runId,generationNo) unique. Any other unique violation is left untranslated so
 * it never masquerades as a preparation-multiplicity conflict.
 */
export function isActivePreparationConflict(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  const err = e as { code?: string; meta?: { target?: unknown; modelName?: unknown } };
  if (err.code !== "P2002") return false;
  // Scope precisely to the AuditRunPreparation table. Prisma resolves `target` to
  // the field/constraint for schema-managed uniques, but for the RAW partial unique
  // index it may report "(not available)" (no target) — so `modelName` is the
  // reliable, narrow signal that this is a per-run preparation uniqueness violation
  // (the only per-run uniques the begin path can hit). Unrelated tables never match.
  if (err.meta?.modelName === "AuditRunPreparation") return true;
  const t = err.meta?.target;
  const s = Array.isArray(t) ? t.join(",") : typeof t === "string" ? t : "";
  return (
    s.includes("ux_prep_active_generation_per_run") ||
    s.includes("audit_run_preparations_runId_generationNo") ||
    s.split(",").includes("runId") ||
    (s.includes("runId") && s.includes("generationNo"))
  );
}

/** Assert a preparation belongs to `runId` within the caller's firm (RLS); returns its status. */
async function assertPrepBelongsToRun(tx: TenantTx, prepId: string, runId: string): Promise<{ status: string }> {
  const prep = await tx.auditRunPreparation.findUnique({ where: { id: prepId }, select: { runId: true, status: true } });
  if (!prep) throw new RunAccessError("NOT_FOUND", "preparation not found");
  if (prep.runId !== runId) throw new RunAccessError("NOT_FOUND", "preparation does not belong to run");
  return { status: prep.status };
}

export async function sealRunPreparation(actor: RunActor, runId: string, prepId: string): Promise<{ manifestHash: string }> {
  await withTenantContext(actor.auditFirmId, async (tx) => {
    await authorizeRun(tx, actor, runId);
    const prep = await assertPrepBelongsToRun(tx, prepId, runId);
    // A generation is sealable only while PREPARING; already-sealed/published is a
    // lifecycle error, not an incompleteness one.
    if (prep.status !== "PREPARING") {
      throw new RunStateError("INVALID_RUN_STATE", `preparation is not sealable in status ${prep.status}`);
    }
    // Materialization completeness: every eligible population chunk must be done.
    // beginPreparation records an eligible (test,dataset) as a prep chunk with
    // done=false and defers the scope-resolution/population-fingerprint row until
    // materializePopulation finishes it (preparation.ts). Un-done chunks therefore
    // mean the population has not been materialized yet.
    const pendingChunks = await tx.auditRunPrepChunk.count({ where: { preparationId: prepId, done: false } });
    if (pendingChunks > 0) {
      throw new RunStateError("PREPARATION_NOT_COMPLETE", `preparation materialization incomplete (${pendingChunks} population chunk(s) pending)`);
    }
  });
  return sealPreparation(actor.auditFirmId, prepId);
}

export async function publishRunForActor(
  actor: RunActor, runId: string, prepId: string,
): Promise<{ configFingerprint: string; engineBuildVersion: string }> {
  await withTenantContext(actor.auditFirmId, async (tx) => {
    const run = await authorizeRun(tx, actor, runId);
    if (!PREPARABLE_RUN_STATES.includes(run.status)) {
      throw new RunStateError("INVALID_RUN_STATE", `run is not publishable in status ${run.status}`);
    }
    const prep = await assertPrepBelongsToRun(tx, prepId, runId);
    if (prep.status !== "COMPLETE") {
      throw new RunStateError("PREPARATION_NOT_COMPLETE", `preparation is not complete (status ${prep.status})`);
    }
  });
  return publishRun(actor.auditFirmId, runId, prepId);
}
