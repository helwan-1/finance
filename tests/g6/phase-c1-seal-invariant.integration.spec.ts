/**
 * G6 PHASE C1 — engine preparation-completeness invariant (G6-DEBT-005).
 * Real PostgreSQL, G4_DB_TEST. Proves sealPreparation refuses to seal while any
 * required population chunk is unfinished, with no side effects, deterministic
 * typed failure, unchanged manifest semantics, boundary agreement, narrow locking
 * (no global serialization, no deadlock), and a real materialize-vs-seal race.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withTenantContext } from "@/lib/db/tenant";
import { startImport, confirmImport } from "@/lib/import/pipeline";
import { beginPreparation, materializePopulation, sealPreparation, PreparationIncompleteError } from "@/lib/g4/preparation";
import { createDraftRun } from "@/lib/g4/run";
import { sealRunPreparation, type RunActor } from "@/lib/g4/app/run-access";
import { runErrorResponse } from "@/lib/g4/app/http";

const run = process.env.G4_DB_TEST ? describe : describe.skip;
const owner = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_DATABASE_URL } } });
const FIRM = "firmA", ENG = "engA";
const U_MEM = "u-c1-member";
const actor: RunActor = { userId: U_MEM, auditFirmId: FIRM };

async function seedTestAndDataset(): Promise<{ testKey: string; datasetId: string }> {
  const n = randomUUID();
  const csv = "account,date,debit,credit,currency\n900951,2024-01-01,6.00,4.00,USD\n900952,2024-01-02,3.00,1.00,USD\n";
  const start = await startImport({ auditFirmId: FIRM, userId: null, engagementId: ENG, datasetKind: "GENERAL_LEDGER", fileName: `c1-${n}.csv`, mimeType: "text/csv", bytes: Buffer.from(csv, "utf8"), idempotencyKey: `c1-${n}`, acknowledgeDuplicate: true });
  await confirmImport(FIRM, null, start.batchId!);
  const testKey = `T-C1-${n}`;
  await withTenantContext(FIRM, async (t) => {
    const test = await t.auditTest.create({ data: { auditFirmId: FIRM, key: testKey, name: "n", nameAr: "ن", testType: "ACCOUNTING_INTEGRITY" }, select: { id: true } });
    const v = await t.auditTestVersion.create({ data: { auditFirmId: FIRM, auditTestId: test.id, version: 1, testType: "ACCOUNTING_INTEGRITY", definitionJson: { kind: "INVALID_DEBIT_CREDIT" }, requirementsJson: { requiredDatasetKinds: ["GENERAL_LEDGER"] }, versionHash: `vh-${n}`, status: "ACTIVE" }, select: { id: true } });
    await t.auditTest.update({ where: { id: test.id }, data: { currentVersionId: v.id } });
  });
  return { testKey, datasetId: start.datasetId! };
}
async function draftRunWithPrep(): Promise<{ runId: string; prepId: string }> {
  const { testKey, datasetId } = await seedTestAndDataset();
  const { runId } = await createDraftRun(FIRM, { engagementId: ENG, createdById: U_MEM });
  const { prepId } = await beginPreparation(FIRM, { runId, tests: [{ testKey }], datasetIds: [datasetId], batchSize: 500 });
  return { runId, prepId };
}
async function materializeAll(prepId: string): Promise<void> {
  const chunks = await withTenantContext(FIRM, (t) => t.auditRunPrepChunk.findMany({ where: { preparationId: prepId }, select: { auditTestVersionId: true, datasetId: true } }));
  for (const c of chunks) await materializePopulation(FIRM, prepId, c.auditTestVersionId, c.datasetId, { batchSize: 500 });
}
const prepRow = (prepId: string) => owner.auditRunPreparation.findUniqueOrThrow({ where: { id: prepId }, select: { status: true, preparationManifestHash: true, expectedCountsJson: true } });
const runRow = (runId: string) => owner.auditRun.findUniqueOrThrow({ where: { id: runId }, select: { status: true, freezeGeneration: true } });

run("G6 Phase C1 — engine seal completeness invariant", () => {
  vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });
  const PRIOR = process.env.AUDIT_ENGINE_BUILD;
  beforeAll(async () => {
    process.env.AUDIT_ENGINE_BUILD = "test-build-c1";
    const s = await import("../g4/_seed"); await s.ensureSeed();
    await owner.user.upsert({ where: { id: U_MEM }, update: {}, create: { id: U_MEM, auditFirmId: FIRM, email: `${U_MEM}@t.example`, fullName: U_MEM, fullNameAr: "م", role: "SENIOR", passwordHash: "x" } });
    await owner.engagementMember.upsert({ where: { engagementId_userId: { engagementId: ENG, userId: U_MEM } }, update: {}, create: { engagementId: ENG, userId: U_MEM } });
  }, 120_000);
  afterAll(async () => {
    if (PRIOR === undefined) delete process.env.AUDIT_ENGINE_BUILD; else process.env.AUDIT_ENGINE_BUILD = PRIOR;
    await owner.$disconnect(); await prisma.$disconnect();
  });

  it("C1-1: seal without materialization fails deterministically (typed)", async () => {
    const { prepId } = await draftRunWithPrep();
    await expect(sealPreparation(FIRM, prepId)).rejects.toBeInstanceOf(PreparationIncompleteError);
  });
  it("C1-2/3/4/12: failed seal has NO side effects", async () => {
    const { runId, prepId } = await draftRunWithPrep();
    await expect(sealPreparation(FIRM, prepId)).rejects.toBeInstanceOf(PreparationIncompleteError);
    const p = await prepRow(prepId);
    const r = await runRow(runId);
    expect(p.status).toBe("PREPARING");                 // C1-2 still PREPARING
    expect(p.preparationManifestHash).toBeNull();       // C1-3 no manifest
    expect(p.expectedCountsJson).toBeNull();            // C1-3 no counts
    expect(r.status).not.toBe("QUEUED");                // C1-4 not frozen/queued
    expect(r.freezeGeneration).toBeNull();              // C1-4 not frozen
    const jobs = await owner.auditJob.count({ where: { runId } });
    expect(jobs).toBe(0);                               // C1-12 no AuditJob
  });
  it("C1-5: seal succeeds once all required chunks are materialized", async () => {
    const { prepId } = await draftRunWithPrep();
    await materializeAll(prepId);
    const out = await sealPreparation(FIRM, prepId);
    expect(out.manifestHash).toBeTruthy();
    expect((await prepRow(prepId)).status).toBe("COMPLETE");
  });
  it("C1-6: successful seal manifest is deterministic (equivalent fixtures → equal hash)", async () => {
    // Two independent runs over identical content + identical single test/dataset
    // shape → identical manifest (the manifest computation is unchanged; the fix
    // only adds a pre-check before it).
    const mk = async () => {
      const { prepId } = await draftRunWithPrep();
      await materializeAll(prepId);
      return (await sealPreparation(FIRM, prepId)).manifestHash;
    };
    const [h1, h2] = [await mk(), await mk()];
    expect(h1).toBe(h2);
  });
  it("C1-7: G6 HTTP boundary still returns 409 PREPARATION_NOT_COMPLETE", async () => {
    const { runId, prepId } = await draftRunWithPrep();
    let status = 0, code = "";
    try { await sealRunPreparation(actor, runId, prepId); }
    catch (e) { const res = runErrorResponse(e); status = res.status; code = ((await res.json()) as { code: string }).code; }
    expect(status).toBe(409);
    expect(code).toBe("PREPARATION_NOT_COMPLETE");
    // and the engine error itself maps to the same contract
    const engRes = runErrorResponse(new PreparationIncompleteError(1));
    expect(engRes.status).toBe(409);
    expect(((await engRes.json()) as { code: string }).code).toBe("PREPARATION_NOT_COMPLETE");
  });
  it("C1-8: two unrelated preparations seal independently (no global serialization)", async () => {
    const a = await draftRunWithPrep(); const b = await draftRunWithPrep();
    await materializeAll(a.prepId); await materializeAll(b.prepId);
    const [ra, rb] = await Promise.all([sealPreparation(FIRM, a.prepId), sealPreparation(FIRM, b.prepId)]);
    expect(ra.manifestHash).toBeTruthy();
    expect(rb.manifestHash).toBeTruthy();
    expect((await prepRow(a.prepId)).status).toBe("COMPLETE");
    expect((await prepRow(b.prepId)).status).toBe("COMPLETE");
  });
  it("C1-9/10: real materialize-vs-seal race never yields a partial manifest; no deadlock", async () => {
    for (let i = 0; i < 6; i++) {
      const { prepId } = await draftRunWithPrep();
      // Independent connections/transactions: materializeAll and sealPreparation
      // each open their own withTenantContext. Interleaving is real.
      const results = await Promise.allSettled([materializeAll(prepId), sealPreparation(FIRM, prepId)]);
      const [mat, seal] = results;
      expect(mat.status).toBe("fulfilled"); // materialization always completes
      // no deadlock surfaced to either side
      for (const r of results) if (r.status === "rejected") {
        expect(String((r.reason as { message?: string })?.message ?? r.reason)).not.toMatch(/deadlock|40P01/i);
      }
      // seal is EITHER refused (saw incomplete) OR succeeded — but if it succeeded,
      // the prep must be genuinely complete: COMPLETE status + zero undone chunks.
      if (seal.status === "fulfilled") {
        const p = await prepRow(prepId);
        const undone = await owner.auditRunPrepChunk.count({ where: { preparationId: prepId, done: false } });
        expect(p.status).toBe("COMPLETE");
        expect(p.preparationManifestHash).toBeTruthy();
        expect(undone).toBe(0);
      } else {
        expect(seal.reason).toBeInstanceOf(PreparationIncompleteError);
      }
      // SAFETY INVARIANT: a sealed (COMPLETE) prep NEVER coexists with undone chunks.
      const finalP = await prepRow(prepId);
      if (finalP.status === "COMPLETE") {
        expect(await owner.auditRunPrepChunk.count({ where: { preparationId: prepId, done: false } })).toBe(0);
      }
    }
  });
  it("C1-11: a sealed preparation cannot be re-sealed", async () => {
    const { prepId } = await draftRunWithPrep();
    await materializeAll(prepId);
    await sealPreparation(FIRM, prepId);
    await expect(sealPreparation(FIRM, prepId)).rejects.toThrow(/not sealable/i); // status now COMPLETE
  });
});
