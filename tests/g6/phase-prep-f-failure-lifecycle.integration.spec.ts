/**
 * G6 PRE-C3-3C — preparation failure lifecycle (PREP-F, PF1–PF16).
 *
 * Real PostgreSQL, gated by G4_DB_TEST. Proves a deterministic preparation failure
 * durably transitions PREPARING → FAILED (stopping locator poison), a retryable/
 * untyped error leaves PREPARING, history is retained, a new generation can be
 * started, RLS holds, FAILED cannot seal/publish, the transition is idempotent and
 * concurrency-safe, and failureDetail is sanitized/bounded.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withTenantContext } from "@/lib/db/tenant";
import { startImport, confirmImport } from "@/lib/import/pipeline";
import { createDraftRun } from "@/lib/g4/run";
import { beginPreparation, materializePopulation, sealPreparation, terminalFailPreparation } from "@/lib/g4/preparation";
import { publishRun } from "@/lib/g4/publish";
import { processPreparationWork } from "@/lib/g4/preparation-driver";

const run = process.env.G4_DB_TEST ? describe : describe.skip;
const owner = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_DATABASE_URL } } });
const FIRM = "firmA", ENG = "engA";
const GOOD_BUILD = "test-build-prepf";

async function freezePreparing(n: number): Promise<{ runId: string; prepId: string; tvId: string; ds: string }> {
  const nonce = randomUUID();
  const csv = "account,date,debit,credit,currency\n" + Array.from({ length: n }, (_, i) => `9${100000 + i},2024-01-01,${i + 1}.00,${i + 1}.00,USD`).join("\n") + "\n";
  const start = await startImport({ auditFirmId: FIRM, userId: null, engagementId: ENG, datasetKind: "GENERAL_LEDGER", fileName: `pf-${nonce}.csv`, mimeType: "text/csv", bytes: Buffer.from(csv, "utf8"), idempotencyKey: `pf-${nonce}`, acknowledgeDuplicate: true });
  await confirmImport(FIRM, null, start.batchId!);
  const ds = start.datasetId!;
  const key = `T-PF-${nonce}`;
  const tvId = await withTenantContext(FIRM, async (t) => {
    const test = await t.auditTest.create({ data: { auditFirmId: FIRM, key, name: "n", nameAr: "ن", testType: "ACCOUNTING_INTEGRITY" }, select: { id: true } });
    const tv = await t.auditTestVersion.create({ data: { auditFirmId: FIRM, auditTestId: test.id, version: 1, testType: "ACCOUNTING_INTEGRITY", definitionJson: { kind: "INVALID_DEBIT_CREDIT" }, requirementsJson: { requiredDatasetKinds: ["GENERAL_LEDGER"] }, versionHash: `vh-${nonce}`, status: "ACTIVE" }, select: { id: true } });
    await t.auditTest.update({ where: { id: test.id }, data: { currentVersionId: tv.id } });
    return tv.id;
  });
  const { runId } = await createDraftRun(FIRM, { engagementId: ENG, createdById: null });
  const { prepId } = await beginPreparation(FIRM, { runId, tests: [{ testKey: key }], datasetIds: [ds], batchSize: 500 });
  return { runId, prepId, tvId, ds };
}
const materializeAll = async (prepId: string) => {
  const chunks = await withTenantContext(FIRM, (t) => t.auditRunPrepChunk.findMany({ where: { preparationId: prepId }, select: { auditTestVersionId: true, datasetId: true } }));
  for (const c of chunks) await materializePopulation(FIRM, prepId, c.auditTestVersionId, c.datasetId, { batchSize: 500 });
};
const prepRow = (prepId: string) => owner.auditRunPreparation.findUniqueOrThrow({ where: { id: prepId }, select: { status: true, failureCode: true, failureDetail: true, failedAt: true, preparationManifestHash: true } });
const runStatus = (runId: string) => owner.auditRun.findUniqueOrThrow({ where: { id: runId }, select: { status: true, freezeGeneration: true } });
const counts = async (prepId: string) => ({
  chunks: await owner.auditRunPrepChunk.count({ where: { preparationId: prepId } }),
  members: await owner.auditRunScopeMember.count({ where: { preparationId: prepId } }),
  resolutions: await owner.auditRunScopeResolution.count({ where: { preparationId: prepId } }),
});
async function locatorRunIds(): Promise<Set<string>> {
  const rows = await owner.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL ROLE audit_dispatch");
    return tx.$queryRawUnsafe<Array<{ runId: string; workType: string }>>("SELECT * FROM app_locate_runnable_work()");
  });
  return new Set(rows.filter((r) => r.workType === "PREPARATION").map((r) => r.runId));
}

run("G6 PREP-F — preparation failure lifecycle (PF1–PF16)", () => {
  vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });
  const PRIOR = process.env.AUDIT_ENGINE_BUILD;
  beforeAll(async () => { process.env.AUDIT_ENGINE_BUILD = GOOD_BUILD; const s = await import("../g4/_seed"); await s.ensureSeed(); }, 120_000);
  afterAll(async () => { if (PRIOR === undefined) delete process.env.AUDIT_ENGINE_BUILD; else process.env.AUDIT_ENGINE_BUILD = PRIOR; await owner.$disconnect(); await prisma.$disconnect(); });

  it("PF2/PF13/PF14/PF15/PF16: deterministic CONFIG failure → FAILED; run PREPARING; locator excludes; history kept; sanitized detail", async () => {
    const f = await freezePreparing(3);
    await materializeAll(f.prepId);
    const before = await counts(f.prepId);
    process.env.AUDIT_ENGINE_BUILD = ""; // non-attestable → deterministic CONFIG at seal
    let out;
    try { out = await processPreparationWork(FIRM, f.runId); } finally { process.env.AUDIT_ENGINE_BUILD = GOOD_BUILD; }
    expect(out!.kind).toBe("FAILED");
    if (out!.kind === "FAILED") expect(out!.failureCode).toBe("CONFIG");
    const p = await prepRow(f.prepId);
    expect(p.status).toBe("FAILED");
    expect(p.failureCode).toBe("CONFIG");
    expect(p.failedAt).not.toBeNull();
    expect(p.preparationManifestHash).toBeNull(); // never sealed
    // PF13: run remains PREPARING, no freeze.
    expect((await runStatus(f.runId)).status).toBe("PREPARING");
    expect((await runStatus(f.runId)).freezeGeneration).toBeNull();
    // PF14: locator no longer selects it.
    expect((await locatorRunIds()).has(f.runId)).toBe(false);
    // PF15: history retained.
    expect(await counts(f.prepId)).toEqual(before);
    // PF16: sanitized, bounded, no raw exception/SQL artifacts.
    expect(p.failureDetail!.length).toBeLessThanOrEqual(500);
    expect(p.failureDetail).not.toMatch(/\n|Error:|at Object|SELECT |INSERT |prisma\./i);
    expect(p.failureDetail).toMatch(/attestable engine build/i);
  });

  it("PF1: deterministic DATA/INVARIANT failure → FAILED and locator stops selecting", async () => {
    const f = await freezePreparing(3);
    await materializeAll(f.prepId);
    // Corrupt a resolution fingerprint → seal raises a deterministic INVARIANT error.
    await owner.$executeRawUnsafe(`UPDATE public."audit_run_scope_resolutions" SET "eligiblePopulationFingerprint"=NULL WHERE "preparationId"=$1`, f.prepId);
    const out = await processPreparationWork(FIRM, f.runId);
    expect(out.kind).toBe("FAILED");
    if (out.kind === "FAILED") expect(out.failureCode).toBe("INVARIANT");
    expect((await prepRow(f.prepId)).status).toBe("FAILED");
    expect((await locatorRunIds()).has(f.runId)).toBe(false);
  });

  it("PF3: retryable/untyped error leaves PREPARING (no FAILED transition) and stays rediscoverable", async () => {
    const f = await freezePreparing(3);
    // Pre-insert a scope member that collides with the first record materialize will
    // write (unique preparationId,tvId,datasetId,sourceRowNo) → the batch tx raises a
    // generic P2002 (untyped, NOT a PreparationDeterministicError) → driver must
    // rethrow (leave PREPARING), never fail-close.
    const firstRow = await withTenantContext(FIRM, (t) => t.importedRecord.findFirstOrThrow({ where: { datasetId: f.ds, status: { not: "REJECTED" } }, orderBy: { sourceRowNo: "asc" }, select: { sourceRowNo: true } }));
    await owner.auditRunScopeMember.create({ data: { auditFirmId: FIRM, preparationId: f.prepId, auditTestVersionId: f.tvId, datasetId: f.ds, sourceRowNo: firstRow.sourceRowNo, evidenceType: "IMPORTED_RECORD", eoiFrameHash: "deadbeef", contentHash: "deadbeef" } });
    await expect(processPreparationWork(FIRM, f.runId)).rejects.toBeTruthy();
    const p = await prepRow(f.prepId);
    expect(p.status).toBe("PREPARING"); // NOT failed
    expect(p.failureCode).toBeNull();
    expect((await locatorRunIds()).has(f.runId)).toBe(true); // still discoverable
  });

  it("PF6/PF7: after FAILED a new generation can start; one-active-PREPARING invariant holds", async () => {
    const f = await freezePreparing(2);
    await materializeAll(f.prepId);
    await owner.$executeRawUnsafe(`UPDATE public."audit_run_scope_resolutions" SET "eligiblePopulationFingerprint"=NULL WHERE "preparationId"=$1`, f.prepId);
    expect((await processPreparationWork(FIRM, f.runId)).kind).toBe("FAILED");
    // New generation on the same (still-PREPARING) run — index permits since gen1 is FAILED.
    const key2 = `T-PF2-${randomUUID()}`;
    await withTenantContext(FIRM, async (t) => {
      const test = await t.auditTest.create({ data: { auditFirmId: FIRM, key: key2, name: "n", nameAr: "ن", testType: "ACCOUNTING_INTEGRITY" }, select: { id: true } });
      const tv = await t.auditTestVersion.create({ data: { auditFirmId: FIRM, auditTestId: test.id, version: 1, testType: "ACCOUNTING_INTEGRITY", definitionJson: { kind: "INVALID_DEBIT_CREDIT" }, requirementsJson: { requiredDatasetKinds: ["GENERAL_LEDGER"] }, versionHash: `vh2-${randomUUID()}`, status: "ACTIVE" }, select: { id: true } });
      await t.auditTest.update({ where: { id: test.id }, data: { currentVersionId: tv.id } });
    });
    const gen2 = await beginPreparation(FIRM, { runId: f.runId, tests: [{ testKey: key2 }], datasetIds: [f.ds], batchSize: 500 });
    expect(gen2.generationNo).toBe(2);
    const preparing = await owner.auditRunPreparation.count({ where: { runId: f.runId, status: "PREPARING" } });
    expect(preparing).toBe(1); // only gen2
  });

  it("PF8: a completed generation cannot be terminal-failed (status guard)", async () => {
    const f = await freezePreparing(2);
    await materializeAll(f.prepId);
    const sealed = await processPreparationWork(FIRM, f.runId);
    expect(sealed.kind).toBe("SEALED");
    const r = await terminalFailPreparation(FIRM, f.prepId, "DATA", "should not fail a COMPLETE prep");
    expect(r.status).toBe("ALREADY_TERMINAL");
    expect((await prepRow(f.prepId)).status).toBe("COMPLETE");
  });

  it("PF9: duplicate terminal-fail is idempotent", async () => {
    const f = await freezePreparing(1);
    const first = await terminalFailPreparation(FIRM, f.prepId, "DATA", "boom");
    const second = await terminalFailPreparation(FIRM, f.prepId, "DATA", "boom again");
    expect(first.status).toBe("FAILED");
    expect(second.status).toBe("ALREADY_TERMINAL");
    const p = await prepRow(f.prepId);
    expect(p.status).toBe("FAILED");
    expect(p.failureDetail).toBe("boom"); // first write wins; not overwritten
  });

  it("PF10: terminal-fail under a foreign firm cannot affect another firm's prep (RLS)", async () => {
    const f = await freezePreparing(1);
    const r = await terminalFailPreparation("firmB", f.prepId, "DATA", "cross-tenant attempt");
    expect(r.status).toBe("ALREADY_TERMINAL"); // invisible under firmB RLS → no-op
    expect((await prepRow(f.prepId)).status).toBe("PREPARING"); // untouched
  });

  it("PF11/PF12: a FAILED preparation cannot be sealed or published", async () => {
    const f = await freezePreparing(1);
    await terminalFailPreparation(FIRM, f.prepId, "DATA", "boom");
    await expect(sealPreparation(FIRM, f.prepId)).rejects.toThrow(/not sealable/i);
    await expect(publishRun(FIRM, f.runId, f.prepId)).rejects.toThrow(/not publishable/i);
  });
});
