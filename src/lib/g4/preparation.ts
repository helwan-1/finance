import type { TenantTx } from "@/lib/db/tenant";
import { withTenantContext } from "@/lib/db/tenant";
import { importedRecordEOI, datasetAccountSemanticId, mappingSemanticHash, effectiveParametersHash } from "./semantic-identity";
import { fingerprint, fields, seq, str, int, foldMember, sealFold, FOLD_SEED } from "./framing";

const RESOLUTION_ALGO_VERSION = "g4res.1";
const DEFAULT_BATCH = 500;

/**
 * Engine-authoritative preparation-completeness failure (G6-DEBT-005). Thrown by
 * sealPreparation when any required population chunk is still unfinished. Typed so
 * every caller — the G6 HTTP boundary and any future internal/background driver —
 * fails deterministically without string matching. The G6 adapter maps this to
 * 409 PREPARATION_NOT_COMPLETE, matching its own early boundary guard.
 */
export class PreparationIncompleteError extends Error {
  readonly code = "PREPARATION_NOT_COMPLETE" as const;
  constructor(public readonly pendingChunks: number) {
    super(`preparation materialization incomplete (${pendingChunks} population chunk(s) pending)`);
    this.name = "PreparationIncompleteError";
  }
}

interface Requirements {
  requiredDatasetKinds?: string[];
  requiresAccountMapping?: boolean;
  requiresJournalEntryGrouping?: boolean;
  partialExecution?: { allowed: boolean; degradableRequirements: string[] };
}

export interface TestSelection { testKey: string; parameters?: Record<string, unknown> }
export interface PrepareParams {
  runId: string;
  tests: TestSelection[];
  datasetIds: string[];
  batchSize?: number; // forced small in tests to exercise multi-chunk
}

/** Stage A step 1: create the generation, pin versions + datasets, resolve capability, capture mapping deps. */
export async function beginPreparation(auditFirmId: string, p: PrepareParams): Promise<{ prepId: string; generationNo: number }> {
  if (p.tests.length === 0) throw new Error("at least one test must be selected");
  if (p.datasetIds.length === 0) throw new Error("at least one dataset must be selected");

  return withTenantContext(auditFirmId, async (tx) => {
    const run = await tx.auditRun.findUnique({ where: { id: p.runId }, select: { id: true, status: true, engagementId: true } });
    if (!run) throw new Error("run not found in tenant");
    if (run.status !== "DRAFT" && run.status !== "PREPARING") throw new Error(`run not preparable (status=${run.status})`);

    const last = await tx.auditRunPreparation.findFirst({ where: { runId: run.id }, orderBy: { generationNo: "desc" }, select: { generationNo: true } });
    const generationNo = (last?.generationNo ?? 0) + 1;

    // Policy B — explicit version selection resolved AT generation start.
    const pinnedTests: { testVersionId: string; ruleVersionId: string | null; testType: string; testKey: string }[] = [];
    for (const sel of p.tests) {
      const test = await tx.auditTest.findUnique({ where: { auditFirmId_key: { auditFirmId, key: sel.testKey } }, select: { id: true, testType: true, currentVersionId: true } });
      if (!test) throw new Error(`test not found: ${sel.testKey}`);
      if (!test.currentVersionId) throw new Error(`test ${sel.testKey} has no current version`);
      const tv = await tx.auditTestVersion.findUnique({ where: { id: test.currentVersionId }, select: { id: true, auditFirmId: true, testType: true, status: true, versionHash: true, requirementsJson: true, auditRuleVersionId: true } });
      if (!tv || tv.auditFirmId !== auditFirmId) throw new Error(`test version cross-tenant or missing for ${sel.testKey}`);
      if (tv.status !== "ACTIVE") throw new Error(`test version not usable (status=${tv.status}) for ${sel.testKey}`);
      if (!tv.versionHash) throw new Error(`test version missing versionHash for ${sel.testKey}`);
      if (typeof tv.requirementsJson !== "object" || tv.requirementsJson === null) throw new Error(`malformed requirements for ${sel.testKey}`);
      if (tv.testType === "RULE" && !tv.auditRuleVersionId) throw new Error(`RULE test ${sel.testKey} missing rule version`);
      if (tv.testType !== "RULE" && tv.auditRuleVersionId) throw new Error(`non-RULE test ${sel.testKey} has an unexpected rule version`);
      pinnedTests.push({ testVersionId: tv.id, ruleVersionId: tv.auditRuleVersionId, testType: tv.testType, testKey: sel.testKey });
    }

    const prep = await tx.auditRunPreparation.create({
      data: {
        auditFirmId, runId: run.id, generationNo, status: "PREPARING",
        pinnedVersionsJson: { tests: pinnedTests } as object,
      },
      select: { id: true },
    });
    if (run.status === "DRAFT") await tx.auditRun.update({ where: { id: run.id }, data: { status: "PREPARING" } });

    // Pin test versions.
    for (const [i, t] of pinnedTests.entries()) {
      const sel = p.tests[i]!;
      await tx.auditRunTestVersion.create({
        data: {
          auditFirmId, preparationId: prep.id, runId: run.id, auditTestVersionId: t.testVersionId,
          testType: t.testType as "RULE" | "STATISTICAL" | "RECONCILIATION" | "ACCOUNTING_INTEGRITY" | "ANALYTICAL" | "DATA_QUALITY",
          auditRuleVersionId: t.ruleVersionId,
          effectiveParametersJson: (sel.parameters ?? {}) as object,
          effectiveParametersHash: effectiveParametersHash(sel.parameters ?? {}),
          orderIndex: i,
        },
      });
    }

    // Pin datasets (validated) + resolve capability per (testVersion, dataset) + capture mapping deps.
    const seenMappingPins = new Set<string>();
    for (const [i, datasetId] of p.datasetIds.entries()) {
      const ds = await tx.dataset.findUnique({ where: { id: datasetId }, select: { id: true, engagementId: true, kind: true, datasetHash: true, lineageClass: true, status: true } });
      if (!ds) throw new Error(`dataset not found in tenant: ${datasetId}`);
      if (ds.engagementId !== run.engagementId) throw new Error(`dataset ${datasetId} not in run engagement`);
      if (ds.status !== "COMPLETED" && ds.status !== "COMPLETED_WITH_ISSUES") throw new Error(`dataset ${datasetId} not consumable (status=${ds.status})`);
      if (!ds.datasetHash) throw new Error(`dataset ${datasetId} has no datasetHash`);
      await tx.auditRunDataset.create({ data: { auditFirmId, preparationId: prep.id, runId: run.id, datasetId: ds.id, datasetHash: ds.datasetHash, datasetKind: ds.kind, lineageClass: ds.lineageClass, orderIndex: i } });

      const cap = await datasetCapability(tx, auditFirmId, ds.id, ds.kind);
      const predicateHash = fingerprint("g4pred.1", str("accepted_records"));
      for (const t of pinnedTests) {
        const tv = await tx.auditTestVersion.findUnique({ where: { id: t.testVersionId }, select: { requirementsJson: true } });
        const req = (tv!.requirementsJson ?? {}) as Requirements;
        const { eligibility, unmet } = resolveEligibility(req, ds.kind, cap);
        if (eligibility === "NOT_ELIGIBLE") {
          // Final, single-insert resolution (no population to materialize).
          await tx.auditRunScopeResolution.create({
            data: {
              auditFirmId, preparationId: prep.id, runId: run.id, auditTestVersionId: t.testVersionId, datasetId: ds.id,
              eligibility, resolutionAlgorithmVersion: RESOLUTION_ALGO_VERSION,
              scopePredicateJson: { predicate: "accepted_records" } as object, scopePredicateHash: predicateHash,
              unmetRequirementsJson: unmet.length ? ({ unmet } as object) : undefined,
              membershipMode: "MATERIALIZED", sourcePopulationCount: 0, eligiblePopulationCount: 0,
            },
          });
        } else {
          // Eligible: defer the (immutable) resolution insert until the population
          // fingerprint is known. The chunk carries the plan + running fold.
          await tx.auditRunPrepChunk.create({
            data: {
              auditFirmId, preparationId: prep.id, auditTestVersionId: t.testVersionId, datasetId: ds.id, lastSourceRowNo: -1, done: false,
              cursorState: { acc: FOLD_SEED, count: 0, eligibility, unmet, predicateHash } as object,
            },
          });
        }
        // Actual mapping-dependency capture: only when the test consumed mapping.
        if (eligibility !== "NOT_ELIGIBLE" && req.requiresAccountMapping) {
          for (const pin of await captureMappingPins(tx, auditFirmId, ds.id, ds.datasetHash)) {
            const key = `${pin.datasetAccountId}/${pin.accountMappingVersionId}`;
            if (seenMappingPins.has(key)) continue;
            seenMappingPins.add(key);
            await tx.auditRunAccountMappingPin.create({ data: { auditFirmId, preparationId: prep.id, runId: run.id, ...pin } });
          }
        }
      }
    }
    return { prepId: prep.id, generationNo };
  });
}

/** Read-only capability probe from immutable G2/G3 facts. */
async function datasetCapability(tx: TenantTx, auditFirmId: string, datasetId: string, kind: string) {
  const journalEntries = kind === "GENERAL_LEDGER" ? await tx.journalEntry.count({ where: { datasetId } }) : 0;
  const datasetAccounts = await tx.datasetAccount.count({ where: { datasetId } });
  let hasMapping = false;
  if (datasetAccounts > 0) {
    const da = await tx.datasetAccount.findFirst({ where: { datasetId }, select: { id: true } });
    if (da) {
      const m = await tx.accountMapping.findUnique({ where: { auditFirmId_datasetAccountId: { auditFirmId, datasetAccountId: da.id } }, select: { currentVersionId: true } });
      hasMapping = !!m?.currentVersionId;
    }
  }
  return { hasJournalEntries: journalEntries > 0, hasAccountMapping: hasMapping };
}

function resolveEligibility(req: Requirements, kind: string, cap: { hasJournalEntries: boolean; hasAccountMapping: boolean }): { eligibility: "ELIGIBLE" | "PARTIALLY_ELIGIBLE" | "NOT_ELIGIBLE"; unmet: string[] } {
  const degradable = new Set(req.partialExecution?.allowed ? req.partialExecution.degradableRequirements : []);
  const unmet: string[] = [];
  const check = (name: string, ok: boolean) => { if (!ok) unmet.push(name); };
  if (req.requiredDatasetKinds && req.requiredDatasetKinds.length) check("datasetKind", req.requiredDatasetKinds.includes(kind));
  if (req.requiresJournalEntryGrouping) check("journalEntryGrouping", cap.hasJournalEntries);
  if (req.requiresAccountMapping) check("accountMapping", cap.hasAccountMapping);
  if (unmet.length === 0) return { eligibility: "ELIGIBLE", unmet };
  // Fail-closed: any non-degradable unmet requirement → NOT_ELIGIBLE.
  const allDegradable = unmet.every((u) => degradable.has(u));
  return { eligibility: allDegradable ? "PARTIALLY_ELIGIBLE" : "NOT_ELIGIBLE", unmet };
}

async function captureMappingPins(tx: TenantTx, auditFirmId: string, datasetId: string, datasetHash: string) {
  const das = await tx.datasetAccount.findMany({ where: { datasetId }, select: { id: true, sourceAccountCode: true, sourceAccountingContextId: true } });
  const pins: { datasetAccountId: string; accountMappingVersionId: string; mappingSemanticHash: string }[] = [];
  for (const da of das) {
    const mapping = await tx.accountMapping.findUnique({ where: { auditFirmId_datasetAccountId: { auditFirmId, datasetAccountId: da.id } }, select: { currentVersionId: true } });
    if (!mapping?.currentVersionId) continue;
    const mv = await tx.accountMappingVersion.findUnique({ where: { id: mapping.currentVersionId }, select: { id: true, version: true, basis: true, accountId: true } });
    if (!mv) continue;
    const acct = await tx.account.findUnique({ where: { id: mv.accountId }, select: { accountCode: true, accountingScopeId: true } });
    const scope = acct ? await tx.accountingScope.findUnique({ where: { id: acct.accountingScopeId }, select: { key: true } }) : null;
    const ctx = da.sourceAccountingContextId ? await tx.sourceAccountingContext.findUnique({ where: { id: da.sourceAccountingContextId }, select: { sourceSystem: true, sourceEntity: true, sourceLedger: true } }) : null;
    const daSem = datasetAccountSemanticId({ datasetHash, sourceSystem: ctx?.sourceSystem ?? null, sourceEntity: ctx?.sourceEntity ?? null, sourceLedger: ctx?.sourceLedger ?? null, sourceAccountCode: da.sourceAccountCode });
    pins.push({ datasetAccountId: da.id, accountMappingVersionId: mv.id, mappingSemanticHash: mappingSemanticHash({ datasetAccountSemanticId: daSem, mappingVersion: mv.version, basis: mv.basis, accountingScopeKey: scope?.key ?? "", accountCode: acct?.accountCode ?? "" }) });
  }
  return pins;
}

/**
 * Stage A step 2: chunked, resumable population materialization + rolling
 * eligiblePopulationFingerprint (g4pop.2) for one (testVersion, dataset). Keyset
 * over imported_records by sourceRowNo; bounded batch; the running fold state is
 * persisted in AuditRunPrepChunk so an interrupted run resumes to the SAME
 * fingerprint. Returns { done, fingerprint? }.
 */
export async function materializePopulation(
  auditFirmId: string, prepId: string, testVersionId: string, datasetId: string, opts?: { batchSize?: number; maxBatches?: number },
): Promise<{ done: boolean; processed: number; fingerprint: string | null }> {
  const batchSize = opts?.batchSize ?? DEFAULT_BATCH;
  const maxBatches = opts?.maxBatches ?? Number.MAX_SAFE_INTEGER;
  let processed = 0;

  for (let b = 0; b < maxBatches; b++) {
    const step = await withTenantContext(auditFirmId, async (tx) => {
      const cursor = await tx.auditRunPrepChunk.findUnique({
        where: { preparationId_auditTestVersionId_datasetId: { preparationId: prepId, auditTestVersionId: testVersionId, datasetId } },
        select: { lastSourceRowNo: true, cursorState: true, done: true },
      });
      if (cursor?.done) return { finished: true, batchCount: 0, fp: (cursor.cursorState as { fingerprint?: string })?.fingerprint ?? null };
      if (!cursor) throw new Error("prep chunk missing — beginPreparation must create it for eligible (testVersion,dataset)");
      const state = (cursor.cursorState as { acc?: string; count?: number; eligibility?: string; unmet?: string[]; predicateHash?: string } | null) ?? {};
      let acc = state.acc ?? FOLD_SEED;
      let count = state.count ?? 0;
      const eligibility = (state.eligibility ?? "ELIGIBLE") as "ELIGIBLE" | "PARTIALLY_ELIGIBLE" | "NOT_ELIGIBLE";
      const unmet = state.unmet ?? [];
      const predicateHash = state.predicateHash ?? fingerprint("g4pred.1", str("accepted_records"));
      const after = cursor.lastSourceRowNo ?? -1;

      const ds = await tx.dataset.findUnique({ where: { id: datasetId }, select: { datasetHash: true } });
      const recs = await tx.importedRecord.findMany({
        where: { datasetId, status: { not: "REJECTED" }, sourceRowNo: { gt: after } },
        orderBy: { sourceRowNo: "asc" }, take: batchSize,
        select: { sourceRowNo: true, rawHash: true },
      });
      let lastRow = after;
      for (const r of recs) {
        const eoi = importedRecordEOI({ datasetHash: ds!.datasetHash!, sourceRowNo: r.sourceRowNo, rawHash: r.rawHash });
        await tx.auditRunScopeMember.create({
          data: { auditFirmId, preparationId: prepId, auditTestVersionId: testVersionId, datasetId, sourceRowNo: r.sourceRowNo, evidenceType: "IMPORTED_RECORD", eoiFrameHash: eoi, contentHash: r.rawHash },
        });
        acc = foldMember(acc, Buffer.from(eoi, "hex"));
        count += 1;
        lastRow = r.sourceRowNo;
      }
      const finished = recs.length < batchSize;
      const fp = finished ? sealFold("g4pop.2", acc, count) : null;
      // Chunk always exists (created by beginPreparation) — update the running fold.
      await tx.auditRunPrepChunk.update({
        where: { preparationId_auditTestVersionId_datasetId: { preparationId: prepId, auditTestVersionId: testVersionId, datasetId } },
        data: { lastSourceRowNo: lastRow, cursorState: { acc, count, eligibility, unmet, predicateHash, ...(fp ? { fingerprint: fp } : {}) } as object, done: finished },
      });
      if (finished) {
        // Single, final, immutable resolution insert — now that the population
        // fingerprint is known. audit_app has INSERT-only on this table.
        const existing = await tx.auditRunScopeResolution.findFirst({
          where: { preparationId: prepId, auditTestVersionId: testVersionId, datasetId }, select: { id: true },
        });
        if (!existing) {
          const prep = await tx.auditRunPreparation.findUnique({ where: { id: prepId }, select: { runId: true } });
          await tx.auditRunScopeResolution.create({
            data: {
              auditFirmId, preparationId: prepId, runId: prep!.runId, auditTestVersionId: testVersionId, datasetId,
              eligibility, resolutionAlgorithmVersion: RESOLUTION_ALGO_VERSION,
              scopePredicateJson: { predicate: "accepted_records" } as object, scopePredicateHash: predicateHash,
              unmetRequirementsJson: unmet.length ? ({ unmet } as object) : undefined,
              membershipMode: "MATERIALIZED", eligiblePopulationFingerprint: fp, sourcePopulationCount: count, eligiblePopulationCount: count,
            },
          });
        }
      }
      return { finished, batchCount: recs.length, fp };
    });
    processed += step.batchCount;
    if (step.finished) return { done: true, processed, fingerprint: step.fp };
  }
  return { done: false, processed, fingerprint: null };
}

/** Stage A step 3: seal the generation — compute expected counts + manifest hash → COMPLETE. */
export async function sealPreparation(auditFirmId: string, prepId: string): Promise<{ manifestHash: string }> {
  return withTenantContext(auditFirmId, async (tx) => {
    // Lock THIS generation row (narrow — never serializes unrelated runs) so two
    // concurrent seals of the same prep cannot both proceed, and the status +
    // completeness reads below are a stable snapshot for this sealing.
    await tx.$queryRaw`SELECT "id" FROM "audit_run_preparations" WHERE "id" = ${prepId} FOR UPDATE`;

    const prep = await tx.auditRunPreparation.findUnique({ where: { id: prepId }, select: { id: true, status: true, runId: true } });
    if (!prep) throw new Error("preparation not found");
    if (prep.status !== "PREPARING") throw new Error(`preparation not sealable (status=${prep.status})`);

    // ENGINE COMPLETENESS INVARIANT (G6-DEBT-005): refuse to seal while any
    // required population chunk is unfinished. beginPreparation records each
    // eligible (testVersion,dataset) as a chunk with done=false and defers its
    // scope-resolution + population fingerprint until materializePopulation
    // finishes it; both commit atomically and `done` is monotonic (only ever set
    // true), so once zero unfinished chunks are observed under this locked
    // snapshot the population is transactionally complete. Fail deterministically
    // BEFORE any status/manifest/count write — no partial seal, no side effects.
    const pendingChunks = await tx.auditRunPrepChunk.count({ where: { preparationId: prepId, done: false } });
    if (pendingChunks > 0) throw new PreparationIncompleteError(pendingChunks);

    const [datasets, testVersions, resolutions, members, mappingPins] = await Promise.all([
      tx.auditRunDataset.count({ where: { preparationId: prepId } }),
      tx.auditRunTestVersion.count({ where: { preparationId: prepId } }),
      tx.auditRunScopeResolution.findMany({ where: { preparationId: prepId }, select: { eligibility: true, eligiblePopulationFingerprint: true }, orderBy: { id: "asc" } }),
      tx.auditRunScopeMember.count({ where: { preparationId: prepId } }),
      tx.auditRunAccountMappingPin.count({ where: { preparationId: prepId } }),
    ]);
    // Every eligible/partial resolution must have a sealed population fingerprint.
    const unfinished = resolutions.filter((r) => r.eligibility !== "NOT_ELIGIBLE" && !r.eligiblePopulationFingerprint);
    if (unfinished.length) throw new Error(`preparation incomplete: ${unfinished.length} resolution(s) without a population fingerprint`);

    // B1: sealing a publishable generation requires an attestable, build-specific
    // identity — never the dev fallback — so the manifest attests a real build.
    const engineBuildVersionCandidate = (await import("./engine-build")).getAttestableEngineBuildVersion();
    const expected = { datasets, testVersions, resolutions: resolutions.length, members, mappingPins };
    const manifestHash = fingerprint("g4manifest.1", fields([
      ["expected", fields(Object.entries(expected).map(([k, v]) => [k, int(v)]))],
      ["engineBuildVersionCandidate", str(engineBuildVersionCandidate)],
      ["popFingerprints", seq(resolutions.map((r) => str(r.eligiblePopulationFingerprint)))],
    ]));

    await tx.auditRunPreparation.update({
      where: { id: prepId },
      data: { status: "COMPLETE", sealedAt: new Date(), engineBuildVersionCandidate, expectedCountsJson: expected as object, preparationManifestHash: manifestHash },
    });
    return { manifestHash };
  });
}
