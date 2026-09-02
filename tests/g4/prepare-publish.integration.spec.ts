/**
 * G4 Phase B — prepare / seal / publish pipeline (matrix D,E,F,H,I,J,L,N,O,Q,R,S
 * + fail-closed). Gated by G4_DB_TEST. No AuditJob execution is started.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { withTenantContext } from "@/lib/db/tenant";
import { startImport, confirmImport } from "@/lib/import/pipeline";
import { mapDatasetAccount } from "@/lib/accounting/mapping";
import { createDraftRun } from "@/lib/g4/run";
import { beginPreparation, materializePopulation, sealPreparation } from "@/lib/g4/preparation";
import { publishRun } from "@/lib/g4/publish";
import { ensureSeed } from "./_seed";

const run = process.env.G4_DB_TEST ? describe : describe.skip;

type TestType = "RULE" | "STATISTICAL" | "RECONCILIATION" | "ACCOUNTING_INTEGRITY" | "ANALYTICAL" | "DATA_QUALITY";
async function createActiveTest(firm: string, o: { testType: TestType; requirements?: object; ruleVersionId?: string | null }) {
  const key = `T-${randomUUID()}`;
  return withTenantContext(firm, async (t) => {
    const test = await t.auditTest.create({ data: { auditFirmId: firm, key, name: "n", nameAr: "ن", testType: o.testType }, select: { id: true } });
    const tv = await t.auditTestVersion.create({ data: { auditFirmId: firm, auditTestId: test.id, version: 1, testType: o.testType, definitionJson: {}, requirementsJson: (o.requirements ?? {}) as object, versionHash: `vh-${randomUUID()}`, status: "ACTIVE", auditRuleVersionId: o.ruleVersionId ?? null }, select: { id: true } });
    await t.auditTest.update({ where: { id: test.id }, data: { currentVersionId: tv.id } });
    return { testKey: key, testVersionId: tv.id, testId: test.id };
  });
}

async function importGL(firm: string, eng: string, nRows: number, sourceEntity?: string) {
  const n = randomUUID();
  const cols = sourceEntity ? "entity,account,date,debit,currency" : "account,date,debit,currency";
  const rows = Array.from({ length: nRows }, (_, i) => (sourceEntity ? `${sourceEntity},` : "") + `1${i}0,2024-01-01,${(i + 1)}.00,USD ${n}`).join("\n");
  const start = await startImport({
    auditFirmId: firm, userId: null, engagementId: eng, datasetKind: "GENERAL_LEDGER",
    fileName: `pb-${n}.csv`, mimeType: "text/csv", bytes: Buffer.from(`${cols}\n${rows}\n`, "utf8"),
    idempotencyKey: `pb-${n}`, acknowledgeDuplicate: true,
    sourceIdentityMap: sourceEntity ? { entity: "sourceEntity" } : undefined,
  });
  await confirmImport(firm, null, start.batchId!);
  return start.datasetId!;
}

run("G4 Phase B prepare/publish", () => {
  const PRIOR_BUILD = process.env.AUDIT_ENGINE_BUILD;
  beforeAll(async () => {
    // B1: seal/publish now require a server-configured, build-specific identity in
    // every environment. Tests provide it through the (server) environment, never
    // caller input. Individual B1 cases override it with vi.stubEnv.
    process.env.AUDIT_ENGINE_BUILD = "test-build-g4b1";
    await ensureSeed();
    await withTenantContext("firmA", (t) => t.auditEngagement.upsert({ where: { id: "engA2" }, update: {}, create: { id: "engA2", auditFirmId: "firmA", clientCompanyId: "clientA", title: "A2", titleAr: "أ٢", fiscalYear: 2024, periodStart: new Date("2024-01-01"), periodEnd: new Date("2024-12-31"), currency: "SAR" } }));
  });
  afterEach(() => { vi.unstubAllEnvs(); });
  afterAll(async () => {
    if (PRIOR_BUILD === undefined) delete process.env.AUDIT_ENGINE_BUILD; else process.env.AUDIT_ENGINE_BUILD = PRIOR_BUILD;
    await prisma.$disconnect();
  });

  async function fullFlow(firm: string, eng: string, nRows: number, requirements?: object, batchSize = 2) {
    const ds = await importGL(firm, eng, nRows);
    const test = await createActiveTest(firm, { testType: "STATISTICAL", requirements });
    const { runId } = await createDraftRun(firm, { engagementId: eng });
    const { prepId } = await beginPreparation(firm, { runId, tests: [{ testKey: test.testKey }], datasetIds: [ds], batchSize });
    return { ds, test, runId, prepId };
  }

  it("D/N/O: draft→prepare→seal→publish freezes a QUEUED run; two runs over same evidence share configFingerprint", async () => {
    const ds = await importGL("firmA", "engA", 4);
    const test = await createActiveTest("firmA", { testType: "STATISTICAL", requirements: { requiredDatasetKinds: ["GENERAL_LEDGER"] } });
    const cfgs: string[] = [];
    for (let k = 0; k < 2; k++) {
      const { runId } = await createDraftRun("firmA", { engagementId: "engA" });
      const { prepId } = await beginPreparation("firmA", { runId, tests: [{ testKey: test.testKey }], datasetIds: [ds], batchSize: 2 });
      const tvId = test.testVersionId;
      const m = await materializePopulation("firmA", prepId, tvId, ds, { batchSize: 2 });
      expect(m.done).toBe(true);
      await sealPreparation("firmA", prepId);
      const pub = await publishRun("firmA", runId, prepId);
      const row = await withTenantContext("firmA", (t) => t.auditRun.findUnique({ where: { id: runId }, select: { status: true, freezeGeneration: true, configFingerprint: true, engineBuildVersion: true, frozenAt: true } }));
      expect(row?.status).toBe("QUEUED");
      expect(row?.freezeGeneration).toBe(prepId);
      expect(row?.configFingerprint).toBe(pub.configFingerprint);
      expect(row?.engineBuildVersion).toBeTruthy();
      cfgs.push(pub.configFingerprint);
    }
    expect(cfgs[0]).toBe(cfgs[1]); // cross-run determinism (same evidence + config)
  });

  it("H/I: chunked materialization uses multiple chunks; interrupted+resumed == uninterrupted fingerprint", async () => {
    const ds = await importGL("firmA", "engA", 5);
    const test = await createActiveTest("firmA", { testType: "STATISTICAL" });
    // uninterrupted
    const rA = await createDraftRun("firmA", { engagementId: "engA" });
    const pA = await beginPreparation("firmA", { runId: rA.runId, tests: [{ testKey: test.testKey }], datasetIds: [ds], batchSize: 2 });
    const un = await materializePopulation("firmA", pA.prepId, test.testVersionId, ds, { batchSize: 2 });
    // interrupted: one batch at a time until done
    const rB = await createDraftRun("firmA", { engagementId: "engA" });
    const pB = await beginPreparation("firmA", { runId: rB.runId, tests: [{ testKey: test.testKey }], datasetIds: [ds], batchSize: 2 });
    let steps = 0, done = false, fp: string | null = null;
    while (!done) { const s = await materializePopulation("firmA", pB.prepId, test.testVersionId, ds, { batchSize: 2, maxBatches: 1 }); done = s.done; fp = s.fingerprint; steps++; if (steps > 10) break; }
    expect(steps).toBeGreaterThan(1); // multiple chunks actually used
    expect(fp).toBe(un.fingerprint); // resume equivalence
    const members = await withTenantContext("firmA", (t) => t.auditRunScopeMember.count({ where: { preparationId: pB.prepId } }));
    expect(members).toBe(5);
  });

  it("F: non-degradable missing requirement → NOT_ELIGIBLE; declared degradable → PARTIALLY_ELIGIBLE", async () => {
    const ds = await importGL("firmA", "engA", 2); // GL without source-identity map → no journal entries
    const testStrict = await createActiveTest("firmA", { testType: "ACCOUNTING_INTEGRITY", requirements: { requiresJournalEntryGrouping: true } });
    const testDeg = await createActiveTest("firmA", { testType: "ACCOUNTING_INTEGRITY", requirements: { requiresJournalEntryGrouping: true, partialExecution: { allowed: true, degradableRequirements: ["journalEntryGrouping"] } } });
    const r = await createDraftRun("firmA", { engagementId: "engA" });
    const p = await beginPreparation("firmA", { runId: r.runId, tests: [{ testKey: testStrict.testKey }, { testKey: testDeg.testKey }], datasetIds: [ds], batchSize: 5 });
    // NOT_ELIGIBLE (strict) resolves at begin; PARTIALLY_ELIGIBLE (deg) resolution is
    // deferred until its population is materialized (immutable, single-insert).
    const degDone = await materializePopulation("firmA", p.prepId, testDeg.testVersionId, ds, { batchSize: 5 });
    expect(degDone.done).toBe(true);
    const res = await withTenantContext("firmA", (t) => t.auditRunScopeResolution.findMany({ where: { preparationId: p.prepId }, select: { auditTestVersionId: true, eligibility: true } }));
    const strict = res.find((x) => x.auditTestVersionId === testStrict.testVersionId);
    const deg = res.find((x) => x.auditTestVersionId === testDeg.testVersionId);
    expect(strict?.eligibility).toBe("NOT_ELIGIBLE");
    expect(deg?.eligibility).toBe("PARTIALLY_ELIGIBLE");
  });

  it("J: mapping pins captured only when a test actually consumes account mapping", async () => {
    const ds = await importGL("firmA", "engA", 2);
    // Create master + map one DatasetAccount so the dataset has a current mapping.
    await withTenantContext("firmA", async (t) => {
      const da = await t.datasetAccount.findFirst({ where: { datasetId: ds }, select: { id: true } });
      const scope = await t.accountingScope.create({ data: { auditFirmId: "firmA", clientCompanyId: "clientA", key: `SC-${randomUUID()}` }, select: { id: true } });
      const acc = await t.account.create({ data: { auditFirmId: "firmA", clientCompanyId: "clientA", accountingScopeId: scope.id, accountCode: "100", accountName: "x" }, select: { id: true } });
      await mapDatasetAccount(t, { auditFirmId: "firmA", datasetAccountId: da!.id, accountId: acc.id, basis: "AUDITOR_ASSERTED" });
    });
    const noMap = await createActiveTest("firmA", { testType: "STATISTICAL" });
    const withMap = await createActiveTest("firmA", { testType: "ACCOUNTING_INTEGRITY", requirements: { requiresAccountMapping: true } });
    const r = await createDraftRun("firmA", { engagementId: "engA" });
    const p = await beginPreparation("firmA", { runId: r.runId, tests: [{ testKey: noMap.testKey }, { testKey: withMap.testKey }], datasetIds: [ds], batchSize: 5 });
    const pins = await withTenantContext("firmA", (t) => t.auditRunAccountMappingPin.count({ where: { preparationId: p.prepId } }));
    expect(pins).toBeGreaterThan(0); // captured because withMap consumed the mapping
    // A run with only the non-mapping test captures no pins.
    const r2 = await createDraftRun("firmA", { engagementId: "engA" });
    const p2 = await beginPreparation("firmA", { runId: r2.runId, tests: [{ testKey: noMap.testKey }], datasetIds: [ds], batchSize: 5 });
    const pins2 = await withTenantContext("firmA", (t) => t.auditRunAccountMappingPin.count({ where: { preparationId: p2.prepId } }));
    expect(pins2).toBe(0);
  });

  it("R/S: authoritative generation is set-once; a currentVersion pointer move after publish does not change the frozen run", async () => {
    const f = await fullFlow("firmA", "engA", 3);
    await materializePopulation("firmA", f.prepId, f.test.testVersionId, f.ds, { batchSize: 2 });
    await sealPreparation("firmA", f.prepId);
    const pub = await publishRun("firmA", f.runId, f.prepId);
    // Move the test's currentVersion pointer AFTER publish.
    await withTenantContext("firmA", async (t) => {
      const tv2 = await t.auditTestVersion.create({ data: { auditFirmId: "firmA", auditTestId: f.test.testId, version: 2, testType: "STATISTICAL", definitionJson: { changed: true }, requirementsJson: {}, versionHash: `vh-${randomUUID()}`, status: "ACTIVE" }, select: { id: true } });
      await t.auditTest.update({ where: { id: f.test.testId }, data: { currentVersionId: tv2.id } });
    });
    const row = await withTenantContext("firmA", (t) => t.auditRun.findUnique({ where: { id: f.runId }, select: { configFingerprint: true } }));
    expect(row?.configFingerprint).toBe(pub.configFingerprint); // unchanged (policy B pinned the version)
    // set-once: cannot repoint freezeGeneration.
    const other = await withTenantContext("firmA", (t) => t.auditRunPreparation.create({ data: { auditFirmId: "firmA", runId: f.runId, generationNo: 99 }, select: { id: true } }));
    await expect(withTenantContext("firmA", (t) => t.$executeRaw`UPDATE "audit_runs" SET "freezeGeneration"=${other.id} WHERE "id"=${f.runId}`)).rejects.toThrow(/set-once/i);
  });

  it("fail-closed: unsealed/incomplete preparation cannot be published; generation of another run cannot be published; second publish rejected", async () => {
    const f = await fullFlow("firmA", "engA", 2);
    // not sealed yet → publish rejected
    await expect(publishRun("firmA", f.runId, f.prepId)).rejects.toThrow(/not publishable|not sealed|incomplete/i);
    // materialize + seal + publish once
    await materializePopulation("firmA", f.prepId, f.test.testVersionId, f.ds, { batchSize: 5 });
    await sealPreparation("firmA", f.prepId);
    await publishRun("firmA", f.runId, f.prepId);
    // second publish rejected (already QUEUED / already has authoritative generation)
    await expect(publishRun("firmA", f.runId, f.prepId)).rejects.toThrow();
    // a COMPLETE generation from ANOTHER run cannot be published under a different run
    const g = await fullFlow("firmA", "engA", 2);
    await materializePopulation("firmA", g.prepId, g.test.testVersionId, g.ds, { batchSize: 5 });
    await sealPreparation("firmA", g.prepId);
    const other = await createDraftRun("firmA", { engagementId: "engA" });
    await expect(publishRun("firmA", other.runId, g.prepId)).rejects.toThrow(/different run/i);
  });

  it("E/Q: RULE test missing rule version rejected; cross-tenant dataset rejected", async () => {
    const ds = await importGL("firmA", "engA", 1);
    const ruleTest = await createActiveTest("firmA", { testType: "RULE", ruleVersionId: null }); // RULE with no rule version
    const r = await createDraftRun("firmA", { engagementId: "engA" });
    await expect(beginPreparation("firmA", { runId: r.runId, tests: [{ testKey: ruleTest.testKey }], datasetIds: [ds] })).rejects.toThrow(/rule version/i);
    // cross-tenant dataset: firmB run cannot pin firmA dataset (invisible under RLS).
    const rb = await createDraftRun("firmB", { engagementId: "engB" });
    const okTest = await createActiveTest("firmB", { testType: "STATISTICAL" });
    await expect(beginPreparation("firmB", { runId: rb.runId, tests: [{ testKey: okTest.testKey }], datasetIds: [ds] })).rejects.toThrow(/dataset not found/i);
  });

  it("E: dataset from a different engagement (same tenant) is rejected", async () => {
    const dsOther = await importGL("firmA", "engA2", 1);
    const test = await createActiveTest("firmA", { testType: "STATISTICAL" });
    const r = await createDraftRun("firmA", { engagementId: "engA" });
    await expect(beginPreparation("firmA", { runId: r.runId, tests: [{ testKey: test.testKey }], datasetIds: [dsOther] })).rejects.toThrow(/not in run engagement/i);
  });

  // ── B1 — engine build attestability ─────────────────────────────────────────
  const runState = (runId: string) =>
    withTenantContext("firmA", (t) => t.auditRun.findUnique({ where: { id: runId }, select: { status: true, freezeGeneration: true, engineBuildVersion: true, configFingerprint: true } }));
  const prepState = (prepId: string) =>
    withTenantContext("firmA", (t) => t.auditRunPreparation.findUnique({ where: { id: prepId }, select: { status: true } }));

  it("B1-A: missing AUDIT_ENGINE_BUILD blocks the freeze pipeline (seal rejected; run never QUEUED)", async () => {
    const f = await fullFlow("firmA", "engA", 2);
    await materializePopulation("firmA", f.prepId, f.test.testVersionId, f.ds, { batchSize: 5 });
    vi.stubEnv("AUDIT_ENGINE_BUILD", "");
    await expect(sealPreparation("firmA", f.prepId)).rejects.toThrow(/AUDIT_ENGINE_BUILD/);
    const row = await runState(f.runId);
    expect(row?.status).not.toBe("QUEUED");
    expect(row?.freezeGeneration).toBeNull();
  });

  it("B1-B: placeholder dev:non-production blocks publish (run never QUEUED)", async () => {
    const f = await fullFlow("firmA", "engA", 2);
    await materializePopulation("firmA", f.prepId, f.test.testVersionId, f.ds, { batchSize: 5 });
    await sealPreparation("firmA", f.prepId); // sealed under the server build id
    vi.stubEnv("AUDIT_ENGINE_BUILD", "dev:non-production");
    await expect(publishRun("firmA", f.runId, f.prepId)).rejects.toThrow(); // attestable OR mismatch
    const row = await runState(f.runId);
    expect(row?.status).not.toBe("QUEUED");
    expect(row?.freezeGeneration).toBeNull();
  });

  it("B1-C: build identity is server-controlled only — no caller input can supply or spoof it", async () => {
    // A distinct server build id; caller passes a label + effective parameters that
    // deliberately look like a build — none of it can reach engineBuildVersion.
    const buildId = `server-build-${randomUUID()}`;
    vi.stubEnv("AUDIT_ENGINE_BUILD", buildId);
    const ds = await importGL("firmA", "engA", 2);
    const test = await createActiveTest("firmA", { testType: "STATISTICAL" });
    const { runId } = await createDraftRun("firmA", { engagementId: "engA", label: "engineBuildVersion=attacker-build" });
    const { prepId } = await beginPreparation("firmA", { runId, tests: [{ testKey: test.testKey, parameters: { AUDIT_ENGINE_BUILD: "attacker-build", engineBuildVersion: "attacker-build" } }], datasetIds: [ds], batchSize: 5 });
    await materializePopulation("firmA", prepId, test.testVersionId, ds, { batchSize: 5 });
    await sealPreparation("firmA", prepId);
    await publishRun("firmA", runId, prepId);
    const row = await runState(runId);
    expect(row?.engineBuildVersion).toBe(buildId); // only the server env value; never caller-supplied
  });

  it("B1-D: explicit server build → QUEUED run stores exactly that build id", async () => {
    const buildA = `build-A-${randomUUID()}`;
    vi.stubEnv("AUDIT_ENGINE_BUILD", buildA);
    const f = await fullFlow("firmA", "engA", 3);
    await materializePopulation("firmA", f.prepId, f.test.testVersionId, f.ds, { batchSize: 2 });
    await sealPreparation("firmA", f.prepId);
    const pub = await publishRun("firmA", f.runId, f.prepId);
    expect(pub.engineBuildVersion).toBe(buildA);
    const row = await runState(f.runId);
    expect(row?.status).toBe("QUEUED");
    expect(row?.engineBuildVersion).toBe(buildA);
    expect(row?.configFingerprint).toBe(pub.configFingerprint);
  });

  it("B1-E: identical semantic config under build-A vs build-B → DIFFERENT configFingerprint", async () => {
    const ds = await importGL("firmA", "engA", 3);
    const test = await createActiveTest("firmA", { testType: "STATISTICAL", requirements: { requiredDatasetKinds: ["GENERAL_LEDGER"] } });
    const freezeUnder = async (build: string) => {
      vi.stubEnv("AUDIT_ENGINE_BUILD", build);
      const { runId } = await createDraftRun("firmA", { engagementId: "engA" });
      const { prepId } = await beginPreparation("firmA", { runId, tests: [{ testKey: test.testKey }], datasetIds: [ds], batchSize: 2 });
      await materializePopulation("firmA", prepId, test.testVersionId, ds, { batchSize: 2 });
      await sealPreparation("firmA", prepId);
      return (await publishRun("firmA", runId, prepId)).configFingerprint;
    };
    const cfgA = await freezeUnder(`build-A-${randomUUID()}`);
    const cfgB = await freezeUnder(`build-B-${randomUUID()}`);
    expect(cfgA).not.toBe(cfgB); // build identity is part of the attestable fingerprint
  });

  it("B1-F: sealed under build-A but publish reports build-B → rejected + rolled back (not QUEUED, prep not PUBLISHED)", async () => {
    const buildA = `build-A-${randomUUID()}`;
    vi.stubEnv("AUDIT_ENGINE_BUILD", buildA);
    const f = await fullFlow("firmA", "engA", 2);
    await materializePopulation("firmA", f.prepId, f.test.testVersionId, f.ds, { batchSize: 5 });
    await sealPreparation("firmA", f.prepId); // candidate = build-A
    vi.stubEnv("AUDIT_ENGINE_BUILD", `build-B-${randomUUID()}`);
    await expect(publishRun("firmA", f.runId, f.prepId)).rejects.toThrow(/engine build changed/i);
    const row = await runState(f.runId);
    expect(row?.status).not.toBe("QUEUED");
    expect(row?.freezeGeneration).toBeNull();
    expect((await prepState(f.prepId))?.status).toBe("COMPLETE"); // not PUBLISHED — atomic rollback
  });

  it("B1-G: any build-validation failure leaves the run non-QUEUED with freezeGeneration unset", async () => {
    const f = await fullFlow("firmA", "engA", 2);
    await materializePopulation("firmA", f.prepId, f.test.testVersionId, f.ds, { batchSize: 5 });
    await sealPreparation("firmA", f.prepId);
    vi.stubEnv("AUDIT_ENGINE_BUILD", ""); // missing at publish
    await expect(publishRun("firmA", f.runId, f.prepId)).rejects.toThrow(/AUDIT_ENGINE_BUILD/);
    const row = await runState(f.runId);
    expect(row?.status).not.toBe("QUEUED");
    expect(row?.freezeGeneration).toBeNull();
    expect(row?.engineBuildVersion).toBeNull();
  });

  it("B1-H: same semantic config + same explicit build over two runs → IDENTICAL configFingerprint (determinism preserved)", async () => {
    const buildX = `build-X-${randomUUID()}`;
    vi.stubEnv("AUDIT_ENGINE_BUILD", buildX);
    const ds = await importGL("firmA", "engA", 4);
    const test = await createActiveTest("firmA", { testType: "STATISTICAL", requirements: { requiredDatasetKinds: ["GENERAL_LEDGER"] } });
    const cfgs: string[] = [];
    for (let k = 0; k < 2; k++) {
      const { runId } = await createDraftRun("firmA", { engagementId: "engA" });
      const { prepId } = await beginPreparation("firmA", { runId, tests: [{ testKey: test.testKey }], datasetIds: [ds], batchSize: 2 });
      await materializePopulation("firmA", prepId, test.testVersionId, ds, { batchSize: 2 });
      await sealPreparation("firmA", prepId);
      cfgs.push((await publishRun("firmA", runId, prepId)).configFingerprint);
    }
    expect(cfgs[0]).toBe(cfgs[1]);
  });
});
