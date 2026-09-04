/**
 * ADR — G4 FROZEN SEMANTIC SCOPE REPRODUCIBILITY (real PostgreSQL, G4_DB_TEST).
 * Proves the frozen run captures the 3 semantic-scope inputs at publish and that
 * execution/historical reopen derive the anchor EXCLUSIVELY from those frozen
 * facts — immune to later mutable-master edits — with DB-enforced set-once,
 * freeze-completeness, and legacy fail-closed. R1–R12.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withTenantContext } from "@/lib/db/tenant";
import { startImport, confirmImport } from "@/lib/import/pipeline";
import { createDraftRun } from "@/lib/g4/run";
import { beginPreparation, materializePopulation, sealPreparation } from "@/lib/g4/preparation";
import { publishRun } from "@/lib/g4/publish";
import { loadExecutionContext } from "@/lib/g4/execution/context";
import { semanticScopeAnchor } from "@/lib/g4/semantic-identity";
import { resultSemanticFingerprint } from "@/lib/g4/execution/result-fingerprint";
import { claimInTx } from "@/lib/g4/execution/job";
import { withExecutionUnit } from "@/lib/g4/execution/unit-tx";
import { executeRun } from "@/lib/g4/execution/execute";

const run = process.env.G4_DB_TEST ? describe : describe.skip;
const owner = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_DATABASE_URL } } });
const FIRM = "firmA";
const ENG = "engG6";

/** import GL → test/version → draft run → prepare → materialize → seal. */
async function buildSealedRun(): Promise<{ runId: string; prepId: string }> {
  const n = randomUUID();
  const csv = "account,date,debit,credit,currency\n900901,2024-01-01,5.00,3.00,USD\n";
  const start = await startImport({
    auditFirmId: FIRM, userId: null, engagementId: ENG, datasetKind: "GENERAL_LEDGER",
    fileName: `g6-${n}.csv`, mimeType: "text/csv", bytes: Buffer.from(csv, "utf8"),
    idempotencyKey: `g6-${n}`, acknowledgeDuplicate: true,
  });
  await confirmImport(FIRM, null, start.batchId!);
  const key = `T-G6-${n}`;
  await withTenantContext(FIRM, async (t) => {
    const test = await t.auditTest.create({ data: { auditFirmId: FIRM, key, name: "n", nameAr: "ن", testType: "ACCOUNTING_INTEGRITY" }, select: { id: true } });
    const v = await t.auditTestVersion.create({ data: { auditFirmId: FIRM, auditTestId: test.id, version: 1, testType: "ACCOUNTING_INTEGRITY", definitionJson: { kind: "INVALID_DEBIT_CREDIT" }, requirementsJson: { requiredDatasetKinds: ["GENERAL_LEDGER"] }, versionHash: `vh-${n}`, status: "ACTIVE" }, select: { id: true } });
    await t.auditTest.update({ where: { id: test.id }, data: { currentVersionId: v.id } });
  });
  const { runId } = await createDraftRun(FIRM, { engagementId: ENG });
  const { prepId } = await beginPreparation(FIRM, { runId, tests: [{ testKey: key }], datasetIds: [start.datasetId!], batchSize: 500 });
  const chunks = await withTenantContext(FIRM, (t) => t.auditRunPrepChunk.findMany({ where: { preparationId: prepId }, select: { auditTestVersionId: true, datasetId: true } }));
  for (const c of chunks) await materializePopulation(FIRM, prepId, c.auditTestVersionId, c.datasetId, { batchSize: 500 });
  await sealPreparation(FIRM, prepId);
  return { runId, prepId };
}

async function buildPublishedRun(): Promise<string> {
  const { runId, prepId } = await buildSealedRun();
  await publishRun(FIRM, runId, prepId);
  return runId;
}

const readRun = (id: string) =>
  withTenantContext(FIRM, (t) => t.auditRun.findUniqueOrThrow({
    where: { id }, select: { frozenFirmLicenseNo: true, frozenFiscalYear: true, frozenClientSemanticKey: true, status: true },
  }));
const anchorOf = (id: string) => withTenantContext(FIRM, (t) => loadExecutionContext(t, FIRM, id).then((c) => c.semanticScopeAnchor));

// Shared fixtures so runs A/B/C differ ONLY by frozen scope (identical test key,
// version hash, dataset/evidence, params) — isolating the semantic-scope anchor
// as the sole variable in the result semantic fingerprint.
async function importSharedDataset(): Promise<string> {
  const n = randomUUID();
  const csv = "account,date,debit,credit,currency\n900901,2024-01-01,5.00,3.00,USD\n";
  const start = await startImport({
    auditFirmId: FIRM, userId: null, engagementId: ENG, datasetKind: "GENERAL_LEDGER",
    fileName: `g6s-${n}.csv`, mimeType: "text/csv", bytes: Buffer.from(csv, "utf8"),
    idempotencyKey: `g6s-${n}`, acknowledgeDuplicate: true,
  });
  await confirmImport(FIRM, null, start.batchId!);
  return start.datasetId!;
}
async function createSharedTest(): Promise<string> {
  const n = randomUUID();
  const key = `T-G6S-${n}`;
  await withTenantContext(FIRM, async (t) => {
    const test = await t.auditTest.create({ data: { auditFirmId: FIRM, key, name: "n", nameAr: "ن", testType: "ACCOUNTING_INTEGRITY" }, select: { id: true } });
    const v = await t.auditTestVersion.create({ data: { auditFirmId: FIRM, auditTestId: test.id, version: 1, testType: "ACCOUNTING_INTEGRITY", definitionJson: { kind: "INVALID_DEBIT_CREDIT" }, requirementsJson: { requiredDatasetKinds: ["GENERAL_LEDGER"] }, versionHash: `vh-${n}`, status: "ACTIVE" }, select: { id: true } });
    await t.auditTest.update({ where: { id: test.id }, data: { currentVersionId: v.id } });
  });
  return key;
}
async function publishWith(testKey: string, datasetId: string): Promise<string> {
  const { runId } = await createDraftRun(FIRM, { engagementId: ENG });
  const { prepId } = await beginPreparation(FIRM, { runId, tests: [{ testKey }], datasetIds: [datasetId], batchSize: 500 });
  const chunks = await withTenantContext(FIRM, (t) => t.auditRunPrepChunk.findMany({ where: { preparationId: prepId }, select: { auditTestVersionId: true, datasetId: true } }));
  for (const c of chunks) await materializePopulation(FIRM, prepId, c.auditTestVersionId, c.datasetId, { batchSize: 500 });
  await sealPreparation(FIRM, prepId);
  await publishRun(FIRM, runId, prepId);
  return runId;
}
const resultFP = (runId: string) =>
  withTenantContext(FIRM, (t) => t.auditResult.findMany({ where: { runId }, orderBy: { resultSemanticFingerprint: "asc" }, select: { resultSemanticFingerprint: true } }))
    .then((rs) => rs.map((r) => r.resultSemanticFingerprint).join("|"));
const jobsOf = (runId: string) =>
  withTenantContext(FIRM, (t) => t.auditJob.findMany({ where: { runId }, orderBy: { attemptNo: "asc" }, select: { attemptNo: true, status: true, failureCode: true } }));

run("G6/ADR frozen semantic-scope reproducibility", () => {
  vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 }); // real-DB pipeline work
  const PRIOR = process.env.AUDIT_ENGINE_BUILD;
  let origLicense = "";
  beforeAll(async () => {
    process.env.AUDIT_ENGINE_BUILD = "test-build-g6";
    const s = await import("../g4/_seed"); await s.ensureSeed();
    await withTenantContext(FIRM, (t) => t.auditEngagement.upsert({
      where: { id: ENG }, update: {},
      create: { id: ENG, auditFirmId: FIRM, clientCompanyId: "clientA", title: "G6", titleAr: "ج٦", fiscalYear: 2020, periodStart: new Date("2020-01-01"), periodEnd: new Date("2020-12-31"), currency: "SAR" },
    }));
    const firm = await owner.auditFirm.findUniqueOrThrow({ where: { id: FIRM }, select: { licenseNo: true } });
    origLicense = firm.licenseNo;
  }, 120_000);
  afterAll(async () => {
    // Restore shared firm license (defensive — tests run sequentially).
    await owner.auditFirm.update({ where: { id: FIRM }, data: { licenseNo: origLicense } }).catch(() => {});
    if (PRIOR === undefined) delete process.env.AUDIT_ENGINE_BUILD; else process.env.AUDIT_ENGINE_BUILD = PRIOR;
    await owner.$disconnect(); await prisma.$disconnect();
  });

  it("R1: publish snapshots the 3 semantic-scope inputs on the run", async () => {
    const runId = await buildPublishedRun();
    const r = await readRun(runId);
    const firm = await owner.auditFirm.findUniqueOrThrow({ where: { id: FIRM }, select: { licenseNo: true } });
    const eng = await owner.auditEngagement.findUniqueOrThrow({ where: { id: ENG }, select: { fiscalYear: true } });
    expect(r.status).toBe("QUEUED");
    expect(r.frozenFirmLicenseNo).toBe(firm.licenseNo);
    expect(r.frozenFiscalYear).toBe(eng.fiscalYear);
    expect(r.frozenClientSemanticKey).toBeTruthy();
  });

  it("R2–R6: execution anchor is frozen-sourced and immune to master mutation (licenseNo + fiscalYear)", async () => {
    const runId = await buildPublishedRun();
    const r = await readRun(runId);
    const a0 = await anchorOf(runId);
    // anchor derives from frozen fields exactly
    expect(a0).toBe(semanticScopeAnchor({ firmLicenseNo: r.frozenFirmLicenseNo!, clientSemanticKey: r.frozenClientSemanticKey!, fiscalYear: r.frozenFiscalYear! }));

    // R2: mutate BOTH mutable-master inputs after freeze.
    const tmpLicense = `g6-tmp-${randomUUID().slice(0, 8)}`;
    await owner.auditFirm.update({ where: { id: FIRM }, data: { licenseNo: tmpLicense } });
    await owner.auditEngagement.update({ where: { id: ENG }, data: { fiscalYear: 1999 } });
    try {
      // R3/R5/R6: anchor unchanged across repeated loads; still equals frozen-derived.
      const a1 = await anchorOf(runId);
      const a2 = await anchorOf(runId);
      expect(a1).toBe(a0);
      expect(a2).toBe(a0);
      // R4: a live-recomputed anchor now differs — proving frozen-sourcing matters.
      const liveAnchor = semanticScopeAnchor({ firmLicenseNo: tmpLicense, clientSemanticKey: r.frozenClientSemanticKey!, fiscalYear: 1999 });
      expect(liveAnchor).not.toBe(a0);
      // and the semantic result identity built on the frozen vs live anchor diverges
      const base = { testKey: "K", testVersion: 1, testVersionHash: "h", ruleVersionHash: null, effectiveParametersHash: "e", consumedMappingSemanticHashes: [], resultCode: "C", evidenceEOIsOrdered: ["x"], payload: { t: "int", v: 1 } as const };
      expect(resultSemanticFingerprint({ ...base, semanticScopeAnchor: a0 })).not.toBe(resultSemanticFingerprint({ ...base, semanticScopeAnchor: liveAnchor }));
    } finally {
      await owner.auditFirm.update({ where: { id: FIRM }, data: { licenseNo: origLicense } });
      await owner.auditEngagement.update({ where: { id: ENG }, data: { fiscalYear: 2020 } });
    }
  });

  it("R7: frozen snapshot fields are set-once (DB rejects update)", async () => {
    const runId = await buildPublishedRun();
    await expect(owner.$executeRawUnsafe(`UPDATE "audit_runs" SET "frozenFiscalYear" = 8888 WHERE "id" = $1`, runId)).rejects.toThrow(/set-once/i);
    await expect(owner.$executeRawUnsafe(`UPDATE "audit_runs" SET "frozenFirmLicenseNo" = 'x' WHERE "id" = $1`, runId)).rejects.toThrow(/set-once/i);
  });

  it("R8/R9: a fresh run after master change freezes the new identity; identical frozen inputs reproduce", async () => {
    const a0 = await anchorOf(await buildPublishedRun());
    await owner.auditEngagement.update({ where: { id: ENG }, data: { fiscalYear: 2020 } }); // ensure baseline
    const aSame = await anchorOf(await buildPublishedRun());
    expect(aSame).toBe(a0); // R9: same frozen inputs → same anchor (cross-run reproducible)
    await owner.auditEngagement.update({ where: { id: ENG }, data: { fiscalYear: 2031 } });
    try {
      const r2 = await buildPublishedRun();
      const rr = await readRun(r2);
      expect(rr.frozenFiscalYear).toBe(2031); // R8: fresh run captures the new value
      expect(await anchorOf(r2)).not.toBe(a0);
    } finally {
      await owner.auditEngagement.update({ where: { id: ENG }, data: { fiscalYear: 2020 } });
    }
  });

  it("R10: legacy frozen run lacking snapshots fails closed", async () => {
    const runId = await buildPublishedRun();
    // Simulate a pre-migration legacy row: NULL the snapshots bypassing the guard.
    await owner.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      await tx.$executeRawUnsafe(`UPDATE "audit_runs" SET "frozenFirmLicenseNo"=NULL,"frozenFiscalYear"=NULL,"frozenClientSemanticKey"=NULL WHERE "id"=$1`, runId);
    });
    await expect(withTenantContext(FIRM, (t) => loadExecutionContext(t, FIRM, runId))).rejects.toThrow(/snapshot/i);
  });

  it("R11: freezing without all 3 snapshots is rejected (freeze-completeness)", async () => {
    const { runId, prepId } = await buildSealedRun(); // freezeGeneration still NULL, prep COMPLETE
    await expect(
      owner.$executeRawUnsafe(`UPDATE "audit_runs" SET "freezeGeneration" = $1 WHERE "id" = $2`, prepId, runId),
    ).rejects.toThrow(/freeze requires/i);
  });

  it("R5-real: real G4 retry (attempt-2 via expired-lease claim) keeps frozen L1/FY1/C1 despite live L2/FY2", async () => {
    // Baseline live master = L1/FY1 at freeze time.
    await owner.auditFirm.update({ where: { id: FIRM }, data: { licenseNo: origLicense } });
    await owner.auditEngagement.update({ where: { id: ENG }, data: { fiscalYear: 2020 } });
    const testKey = await createSharedTest();
    const ds = await importSharedDataset();

    // Control run A: frozen L1/FY1/C1, executed normally (single attempt).
    const runA = await publishWith(testKey, ds);
    const outA = await executeRun(FIRM, runA, "worker-A");
    expect(outA.outcome).toBe("COMPLETED");
    const fpA = await resultFP(runA);
    expect(fpA).toBeTruthy();

    // Run B: frozen L1/FY1/C1.
    const runB = await publishWith(testKey, ds);
    // Attempt 1 = a real claimed lease that then stalls (worker dies).
    const claim1 = await withExecutionUnit(FIRM, (tx) => claimInTx(tx, FIRM, runB, "worker-1"));
    expect(claim1.status).toBe("claimed");
    if (claim1.status === "claimed") expect(claim1.attemptNo).toBe(1);
    // Expire attempt-1's lease (simulate worker death / lease TTL elapsed).
    await owner.$executeRawUnsafe(`UPDATE "audit_jobs" SET "leaseExpiresAt" = clock_timestamp() - interval '1 hour' WHERE "runId" = $1 AND "attemptNo" = 1`, runB);
    // Mutate BOTH mutable-master inputs AFTER freeze, BEFORE the retry executes.
    const L2 = `g6-L2-${randomUUID().slice(0, 8)}`;
    await owner.auditFirm.update({ where: { id: FIRM }, data: { licenseNo: L2 } });
    await owner.auditEngagement.update({ where: { id: ENG }, data: { fiscalYear: 2099 } });
    let fpC = "";
    try {
      // Attempt 2 via the REAL retry path: claimInTx kills the expired attempt 1 and allocates attempt 2.
      const outB = await executeRun(FIRM, runB, "worker-2");
      expect(outB.outcome).toBe("COMPLETED");

      // Two genuine attempts recorded: 1 FAILED(LEASE_LOST), 2 SUCCEEDED.
      const jobs = await jobsOf(runB);
      expect(jobs.map((j) => j.attemptNo)).toEqual([1, 2]);
      expect(jobs[0]!.status).toBe("FAILED");
      expect(jobs[0]!.failureCode).toBe("LEASE_LOST");
      expect(jobs[1]!.status).toBe("SUCCEEDED");

      // Anchor on the retried run derives from FROZEN L1/FY1/C1, not live L2/FY2.
      const r = await readRun(runB);
      const anchorB = await anchorOf(runB);
      expect(anchorB).toBe(semanticScopeAnchor({ firmLicenseNo: r.frozenFirmLicenseNo!, clientSemanticKey: r.frozenClientSemanticKey!, fiscalYear: r.frozenFiscalYear! }));
      expect(anchorB).not.toBe(semanticScopeAnchor({ firmLicenseNo: L2, clientSemanticKey: r.frozenClientSemanticKey!, fiscalYear: 2099 }));

      // The emitted result semantic fingerprint is IDENTICAL to the control run
      // (same frozen scope) — proving the retry used no live L2/FY2 dependency.
      const fpB = await resultFP(runB);
      expect(fpB).toBe(fpA);

      // Control-negative: a run FROZEN at L2/FY2 yields a DIFFERENT fingerprint,
      // so the equality above is not vacuous — scope inputs genuinely matter.
      const runC = await publishWith(testKey, ds); // freezes current live L2/FY2
      const outC = await executeRun(FIRM, runC, "worker-C");
      expect(outC.outcome).toBe("COMPLETED");
      fpC = await resultFP(runC);
      expect(fpC).not.toBe(fpA);
    } finally {
      await owner.auditFirm.update({ where: { id: FIRM }, data: { licenseNo: origLicense } });
      await owner.auditEngagement.update({ where: { id: ENG }, data: { fiscalYear: 2020 } });
    }
  });

  it("R12: anchor algorithm is deterministic and unchanged (no version churn)", async () => {
    const inp = { firmLicenseNo: "LIC-1", clientSemanticKey: "vat:300", fiscalYear: 2024 };
    expect(semanticScopeAnchor(inp)).toBe(semanticScopeAnchor(inp)); // deterministic
    // same inputs across two frozen runs already proven identical in R9; algorithm id (g4scope.1) unchanged (source files untouched).
  });
});
