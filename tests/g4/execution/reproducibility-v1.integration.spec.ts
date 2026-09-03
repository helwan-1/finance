/**
 * G4 Phase C1 — C1-V1: TRUE persisted reproducible re-import.
 *
 * Two SEPARATE imports of byte-identical content (distinct Dataset and
 * ImportedRecord rows), each frozen into a SEPARATE run/preparation, both
 * executed through the REAL persisted execution path. Proves g4sem.3 reproduces
 * across independent imports while g4occ.2 stays run-local. Gated by G4_DB_TEST.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { withTenantContext } from "@/lib/db/tenant";
import { startImport, confirmImport } from "@/lib/import/pipeline";
import { createDraftRun } from "@/lib/g4/run";
import { beginPreparation, materializePopulation, sealPreparation } from "@/lib/g4/preparation";
import { publishRun } from "@/lib/g4/publish";
import { executeRun } from "@/lib/g4/execution/execute";
import { ensureSeed } from "../_seed";

const run = process.env.G4_DB_TEST ? describe : describe.skip;
type TT = "DATA_QUALITY";

/** Byte-identical content for both imports (a fixed, nonce-free CSV). */
const CSV_BYTES = Buffer.from(
  "account,date,debit,currency\n" +
  "700,2024-06-01,10.00,USD\n" +
  "701,2024-06-01,20.00,USD\n" +
  "700,2024-06-01,10.00,USD\n", // duplicate content at a distinct sourceRowNo (occurrence multiplicity)
  "utf8",
);

async function importIdentical(): Promise<string> {
  const key = randomUUID(); // unique idempotency + filename; content bytes are identical
  const start = await startImport({
    auditFirmId: "firmA", userId: null, engagementId: "engA", datasetKind: "GENERAL_LEDGER",
    fileName: `v1-${key}.csv`, mimeType: "text/csv", bytes: CSV_BYTES,
    idempotencyKey: `v1-${key}`, acknowledgeDuplicate: true,
  });
  await confirmImport("firmA", null, start.batchId!);
  return start.datasetId!;
}

async function freezeOver(datasetId: string, testKey: string): Promise<{ runId: string; prepId: string }> {
  const { runId } = await createDraftRun("firmA", { engagementId: "engA" });
  const { prepId } = await beginPreparation("firmA", { runId, tests: [{ testKey }], datasetIds: [datasetId], batchSize: 500 });
  const tvId = await withTenantContext("firmA", async (t) => {
    const test = await t.auditTest.findUnique({ where: { auditFirmId_key: { auditFirmId: "firmA", key: testKey } }, select: { currentVersionId: true } });
    return test!.currentVersionId!;
  });
  await materializePopulation("firmA", prepId, tvId, datasetId, { batchSize: 500 });
  await sealPreparation("firmA", prepId);
  await publishRun("firmA", runId, prepId);
  return { runId, prepId };
}

run("G4 C1-V1 reimport semantic reproducibility", () => {
  const PRIOR = process.env.AUDIT_ENGINE_BUILD;
  beforeAll(async () => { process.env.AUDIT_ENGINE_BUILD = "test-build-c1"; await ensureSeed(); });
  afterAll(async () => { if (PRIOR === undefined) delete process.env.AUDIT_ENGINE_BUILD; else process.env.AUDIT_ENGINE_BUILD = PRIOR; await prisma.$disconnect(); });

  it("V1: two separate imports → identical g4sem.3, different g4occ.2", async () => {
    // ONE shared test identity (same key/version/versionHash across both runs).
    const testKey = `T-${randomUUID()}`;
    await withTenantContext("firmA", async (t) => {
      const test = await t.auditTest.create({ data: { auditFirmId: "firmA", key: testKey, name: "n", nameAr: "ن", testType: "DATA_QUALITY" as TT }, select: { id: true } });
      const tv = await t.auditTestVersion.create({ data: { auditFirmId: "firmA", auditTestId: test.id, version: 1, testType: "DATA_QUALITY" as TT, definitionJson: { dqKind: "POPULATION_MEMBER" }, requirementsJson: { requiredDatasetKinds: ["GENERAL_LEDGER"] }, versionHash: "vh-v1-shared", status: "ACTIVE" }, select: { id: true } });
      await t.auditTest.update({ where: { id: test.id }, data: { currentVersionId: tv.id } });
    });

    // Two independent, byte-identical imports → distinct Dataset + ImportedRecord rows.
    const dsA = await importIdentical();
    const dsB = await importIdentical();
    expect(dsA).not.toBe(dsB); // Dataset A ID != Dataset B ID

    const [aRows, bRows, aHash, bHash] = await withTenantContext("firmA", async (t) => {
      const a = await t.importedRecord.findMany({ where: { datasetId: dsA }, orderBy: { sourceRowNo: "asc" }, select: { id: true, sourceRowNo: true, rawHash: true } });
      const b = await t.importedRecord.findMany({ where: { datasetId: dsB }, orderBy: { sourceRowNo: "asc" }, select: { id: true, sourceRowNo: true, rawHash: true } });
      const dh = await t.dataset.findUnique({ where: { id: dsA }, select: { datasetHash: true } });
      const dh2 = await t.dataset.findUnique({ where: { id: dsB }, select: { datasetHash: true } });
      return [a, b, dh?.datasetHash, dh2?.datasetHash] as const;
    });
    // ImportedRecord A IDs != ImportedRecord B IDs (disjoint physical rows)
    const aIds = new Set(aRows.map((r) => r.id));
    expect(bRows.some((r) => aIds.has(r.id))).toBe(false);
    // same sourceRowNo/rawHash correspondence (equivalent semantic content identity)
    expect(aRows.map((r) => [r.sourceRowNo, r.rawHash])).toEqual(bRows.map((r) => [r.sourceRowNo, r.rawHash]));
    // content-derived datasetHash is identical (reproducible dataset identity)
    expect(aHash).toBe(bHash);

    // Freeze + execute each through the real persisted path (distinct run/prep IDs).
    const fa = await freezeOver(dsA, testKey);
    const fb = await freezeOver(dsB, testKey);
    expect(fa.runId).not.toBe(fb.runId);
    expect(fa.prepId).not.toBe(fb.prepId);
    expect((await executeRun("firmA", fa.runId, "w1")).outcome).toBe("COMPLETED");
    expect((await executeRun("firmA", fb.runId, "w2")).outcome).toBe("COMPLETED");

    const rowsA = await withTenantContext("firmA", (t) => t.auditResult.findMany({ where: { runId: fa.runId }, select: { resultSemanticFingerprint: true, resultOccurrenceFingerprint: true } }));
    const rowsB = await withTenantContext("firmA", (t) => t.auditResult.findMany({ where: { runId: fb.runId }, select: { resultSemanticFingerprint: true, resultOccurrenceFingerprint: true } }));
    const semA = new Set(rowsA.map((r) => r.resultSemanticFingerprint));
    const semB = new Set(rowsB.map((r) => r.resultSemanticFingerprint));
    const occA = new Set(rowsA.map((r) => r.resultOccurrenceFingerprint));
    const occB = new Set(rowsB.map((r) => r.resultOccurrenceFingerprint));

    // Three source rows (one duplicate-content occurrence) → three distinct semantic occurrences.
    expect(rowsA.length).toBe(3);
    expect(rowsB.length).toBe(3);
    expect(semA.size).toBe(3);
    // g4sem.3 IDENTICAL across the two independent imports.
    expect(semA).toEqual(semB);
    // g4occ.2 DIFFERENT / run-local (disjoint).
    expect([...occA].some((o) => occB.has(o))).toBe(false);

    // Emit the persisted evidence for the report.
    console.log("C1-V1-EVIDENCE " + JSON.stringify({
      datasetA: dsA, datasetB: dsB, datasetHashEqual: aHash === bHash,
      importedRecordsDisjoint: !bRows.some((r) => aIds.has(r.id)),
      runA: fa.runId, runB: fb.runId, prepA: fa.prepId, prepB: fb.prepId,
      semEqual: JSON.stringify([...semA].sort()) === JSON.stringify([...semB].sort()),
      occDisjoint: ![...occA].some((o) => occB.has(o)),
      semA: [...semA].sort(), occA: [...occA].sort(), occB: [...occB].sort(),
    }));
  }, 30000);
});
