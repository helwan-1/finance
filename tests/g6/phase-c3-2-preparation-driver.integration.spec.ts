/**
 * G6 PHASE C3-2 — tenant-scoped preparation driver (PD suite).
 *
 * Real PostgreSQL, gated by G4_DB_TEST. Proves processPreparationWork drives a
 * PREPARING preparation to a sealed COMPLETE state using ONLY the authoritative
 * engine primitives, bounded per invocation, idempotent under duplicate/stale
 * coordinates and concurrency, never publishing, and failing closed on dirty
 * multiplicity — all under RLS with no schema change.
 *
 * PD20 (no persistent retry/job state) and PD23 (driver performs no direct
 * chunk/member/resolution writes) are proven by source forensic in the C3-2
 * verification harness — see the phase report.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withTenantContext } from "@/lib/db/tenant";
import { startImport, confirmImport } from "@/lib/import/pipeline";
import { createDraftRun } from "@/lib/g4/run";
import { beginPreparation, materializePopulation } from "@/lib/g4/preparation";
import { publishRun } from "@/lib/g4/publish";
import { processPreparationWork } from "@/lib/g4/preparation-driver";

const run = process.env.G4_DB_TEST ? describe : describe.skip;
const owner = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_DATABASE_URL } } });
const FIRM = "firmA", ENG = "engA", U = "u-c32d";
const INDEX = "ux_prep_active_generation_per_run";

async function seedTestsAndDataset(rows: number, testCount: number): Promise<{ testKeys: string[]; datasetId: string }> {
  const n = randomUUID();
  let csv = "account,date,debit,credit,currency\n";
  for (let i = 0; i < rows; i++) csv += `9${100000 + i},2024-01-${String((i % 27) + 1).padStart(2, "0")},${i + 1}.00,${i + 1}.00,USD\n`;
  const start = await startImport({ auditFirmId: FIRM, userId: null, engagementId: ENG, datasetKind: "GENERAL_LEDGER", fileName: `c32d-${n}.csv`, mimeType: "text/csv", bytes: Buffer.from(csv, "utf8"), idempotencyKey: `c32d-${n}`, acknowledgeDuplicate: true });
  await confirmImport(FIRM, null, start.batchId!);
  const testKeys: string[] = [];
  await withTenantContext(FIRM, async (t) => {
    for (let k = 0; k < testCount; k++) {
      const key = `T-C32D-${n}-${k}`;
      const test = await t.auditTest.create({ data: { auditFirmId: FIRM, key, name: "n", nameAr: "ن", testType: "ACCOUNTING_INTEGRITY" }, select: { id: true } });
      const v = await t.auditTestVersion.create({ data: { auditFirmId: FIRM, auditTestId: test.id, version: 1, testType: "ACCOUNTING_INTEGRITY", definitionJson: { kind: "INVALID_DEBIT_CREDIT" }, requirementsJson: { requiredDatasetKinds: ["GENERAL_LEDGER"] }, versionHash: `vh-${n}-${k}`, status: "ACTIVE" }, select: { id: true } });
      await t.auditTest.update({ where: { id: test.id }, data: { currentVersionId: v.id } });
      testKeys.push(key);
    }
  });
  return { testKeys, datasetId: start.datasetId! };
}
async function draftPreparing(rows: number, testCount: number, batchSize: number): Promise<{ runId: string; prepId: string }> {
  const { testKeys, datasetId } = await seedTestsAndDataset(rows, testCount);
  const { runId } = await createDraftRun(FIRM, { engagementId: ENG, createdById: U });
  const { prepId } = await beginPreparation(FIRM, { runId, tests: testKeys.map((testKey) => ({ testKey })), datasetIds: [datasetId], batchSize });
  return { runId, prepId };
}
async function materializeAll(prepId: string, batchSize = 500): Promise<void> {
  const chunks = await withTenantContext(FIRM, (t) => t.auditRunPrepChunk.findMany({ where: { preparationId: prepId }, select: { auditTestVersionId: true, datasetId: true } }));
  for (const c of chunks) await materializePopulation(FIRM, prepId, c.auditTestVersionId, c.datasetId, { batchSize });
}
const prepRow = (prepId: string) => owner.auditRunPreparation.findUniqueOrThrow({ where: { id: prepId }, select: { status: true, preparationManifestHash: true, failureCode: true } });
const runRow = (runId: string) => owner.auditRun.findUniqueOrThrow({ where: { id: runId }, select: { status: true, freezeGeneration: true } });
const memberCount = (prepId: string) => owner.auditRunScopeMember.count({ where: { preparationId: prepId } });
const undoneCount = (prepId: string) => owner.auditRunPrepChunk.count({ where: { preparationId: prepId, done: false } });

run("G6 Phase C3-2 — preparation driver (PD1–PD25)", () => {
  vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });
  const PRIOR = process.env.AUDIT_ENGINE_BUILD;
  beforeAll(async () => {
    process.env.AUDIT_ENGINE_BUILD = "test-build-c32d";
    const s = await import("../g4/_seed"); await s.ensureSeed();
    await owner.user.upsert({ where: { id: U }, update: {}, create: { id: U, auditFirmId: FIRM, email: `${U}@t.example`, fullName: U, fullNameAr: "م", role: "SENIOR", passwordHash: "x" } });
  }, 120_000);
  afterAll(async () => {
    if (PRIOR === undefined) delete process.env.AUDIT_ENGINE_BUILD; else process.env.AUDIT_ENGINE_BUILD = PRIOR;
    await owner.$disconnect(); await prisma.$disconnect();
  });

  it("PD1: an unfinished preparation progresses", async () => {
    const { runId, prepId } = await draftPreparing(5, 1, 2); // 1 chunk, 3 batches
    const out = await processPreparationWork(FIRM, runId, { batchSize: 2, maxClaims: 1 });
    expect(out.kind).toBe("YIELDED");
    if (out.kind === "YIELDED") { expect(out.claims).toBe(1); expect(out.reason).toBe("maxClaims"); }
    expect(await memberCount(prepId)).toBe(2); // one batch committed
  });

  it("PD2: multiple chunks eventually seal", async () => {
    const { runId, prepId } = await draftPreparing(3, 2, 500); // 2 chunks
    const out = await processPreparationWork(FIRM, runId, { batchSize: 500 });
    expect(out.kind).toBe("SEALED");
    expect((await prepRow(prepId)).status).toBe("COMPLETE");
    expect((await runRow(runId)).status).toBe("PREPARING");
  });

  it("PD3/PD10: zero-undone unsealed prep (crashed before seal) recovers and seals", async () => {
    const { runId, prepId } = await draftPreparing(4, 1, 500);
    await materializeAll(prepId); // all chunks done, prep still PREPARING
    expect(await undoneCount(prepId)).toBe(0);
    expect((await prepRow(prepId)).status).toBe("PREPARING");
    const out = await processPreparationWork(FIRM, runId);
    expect(out.kind).toBe("SEALED");
    if (out.kind === "SEALED") expect(out.idempotent).toBe(false);
    expect((await prepRow(prepId)).status).toBe("COMPLETE");
  });

  it("PD4: BUSY yields and never seals (real concurrent chunk lock)", async () => {
    const { runId, prepId } = await draftPreparing(2, 1, 500); // single chunk
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const holder = owner.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT "id" FROM "audit_run_prep_chunks" WHERE "preparationId"=$1 AND "done"=false ORDER BY "id" FOR UPDATE SKIP LOCKED LIMIT 1`, prepId);
      await held; // hold the row lock while the driver runs
    }, { timeout: 30_000, maxWait: 30_000 });
    await new Promise((r) => setTimeout(r, 250)); // ensure the lock is acquired
    const out = await processPreparationWork(FIRM, runId, { batchSize: 500 });
    release();
    await holder;
    expect(out.kind).toBe("BUSY_YIELDED");
    expect((await prepRow(prepId)).status).toBe("PREPARING"); // never sealed
  });

  it("PD5/PD12/PD21: duplicate/stale coordinate is safe (repeat delivery → NOOP)", async () => {
    const { runId, prepId } = await draftPreparing(2, 1, 500);
    const first = await processPreparationWork(FIRM, runId);
    expect(first.kind).toBe("SEALED");
    const second = await processPreparationWork(FIRM, runId);
    const third = await processPreparationWork(FIRM, runId);
    expect(second.kind).toBe("NOOP");
    expect(third.kind).toBe("NOOP");
    expect((await prepRow(prepId)).status).toBe("COMPLETE");
  });

  it("PD6: two drivers on the same prep are safe (real concurrency)", async () => {
    const { runId, prepId } = await draftPreparing(6, 3, 2); // 3 chunks, multi-batch
    const [a, b] = await Promise.all([
      processPreparationWork(FIRM, runId, { batchSize: 2 }),
      processPreparationWork(FIRM, runId, { batchSize: 2 }),
    ]);
    for (const o of [a, b]) expect(["SEALED", "NOOP", "YIELDED", "BUSY_YIELDED"]).toContain(o.kind);
    expect((await prepRow(prepId)).status).toBe("COMPLETE"); // one of them sealed
    expect(await undoneCount(prepId)).toBe(0);
  });

  it("PD7: different runs progress in parallel (real concurrency)", async () => {
    const r1 = await draftPreparing(3, 1, 500);
    const r2 = await draftPreparing(3, 1, 500);
    const [a, b] = await Promise.all([processPreparationWork(FIRM, r1.runId), processPreparationWork(FIRM, r2.runId)]);
    expect(a.kind).toBe("SEALED");
    expect(b.kind).toBe("SEALED");
    expect((await prepRow(r1.prepId)).status).toBe("COMPLETE");
    expect((await prepRow(r2.prepId)).status).toBe("COMPLETE");
  });

  it("PD8: a crash before batch commit leaves no partial state (rollback atomicity)", async () => {
    const { prepId } = await draftPreparing(3, 1, 500);
    const chunk = await withTenantContext(FIRM, (t) => t.auditRunPrepChunk.findFirstOrThrow({ where: { preparationId: prepId }, select: { auditTestVersionId: true, datasetId: true } }));
    const before = await memberCount(prepId);
    await expect(withTenantContext(FIRM, async (t) => {
      await t.auditRunScopeMember.create({ data: { auditFirmId: FIRM, preparationId: prepId, auditTestVersionId: chunk.auditTestVersionId, datasetId: chunk.datasetId, sourceRowNo: 999999, evidenceType: "IMPORTED_RECORD", eoiFrameHash: "deadbeef", contentHash: "deadbeef" } });
      throw new Error("simulated crash before commit");
    })).rejects.toThrow(/simulated crash/);
    expect(await memberCount(prepId)).toBe(before); // rolled back — no partial member
  });

  it("PD9: after a committed batch, the next invocation resumes from the durable cursor", async () => {
    const { runId, prepId } = await draftPreparing(5, 1, 2); // 3 batches
    const first = await processPreparationWork(FIRM, runId, { batchSize: 2, maxClaims: 1 });
    expect(first.kind).toBe("YIELDED");
    expect(await memberCount(prepId)).toBe(2);
    const second = await processPreparationWork(FIRM, runId, { batchSize: 2 });
    expect(second.kind).toBe("SEALED");
    expect(await memberCount(prepId)).toBe(5); // resumed, no duplicates
    expect(await undoneCount(prepId)).toBe(0);
  });

  it("PD11: concurrent seal — one seals, the other is idempotent (real concurrency)", async () => {
    const { runId, prepId } = await draftPreparing(3, 1, 500);
    await materializeAll(prepId); // zero undone, prep PREPARING → both drivers hit COMPLETE
    const [a, b] = await Promise.all([processPreparationWork(FIRM, runId), processPreparationWork(FIRM, runId)]);
    for (const o of [a, b]) expect(["SEALED", "NOOP"]).toContain(o.kind);
    expect([a.kind, b.kind]).toContain("SEALED");
    expect((await prepRow(prepId)).status).toBe("COMPLETE");
  });

  it("PD13/PD14: driver never publishes; after human Publish a stale coordinate is NOOP", async () => {
    const { runId, prepId } = await draftPreparing(2, 1, 500);
    const sealed = await processPreparationWork(FIRM, runId);
    expect(sealed.kind).toBe("SEALED");
    // PD14: run remains PREPARING, no freeze — the driver did not publish.
    let r = await runRow(runId);
    expect(r.status).toBe("PREPARING");
    expect(r.freezeGeneration).toBeNull();
    // Human publish (in the TEST, not the driver) → run QUEUED.
    await publishRun(FIRM, runId, prepId);
    r = await runRow(runId);
    expect(r.status).toBe("QUEUED");
    // PD13: driver on the now-QUEUED run → NOOP.
    const out = await processPreparationWork(FIRM, runId);
    expect(out.kind).toBe("NOOP");
  });

  it("PD15/PD16: wrong tenant cannot mutate/infer; cross-firm isolation", async () => {
    const { runId, prepId } = await draftPreparing(2, 1, 500);
    const before = await memberCount(prepId);
    // Firm B drives firm A's runId → RLS-hidden run → NOOP, no leak, no mutation.
    const out = await processPreparationWork("firmB", runId);
    expect(out.kind).toBe("NOOP");
    if (out.kind === "NOOP") expect(out.reason).toBe("run_not_preparing");
    expect(await memberCount(prepId)).toBe(before);
    expect((await prepRow(prepId)).status).toBe("PREPARING");
  });

  it("PD17: maxClaims bound yields before completion with durable progress", async () => {
    const { runId, prepId } = await draftPreparing(6, 1, 2); // 3 batches
    const out = await processPreparationWork(FIRM, runId, { batchSize: 2, maxClaims: 2 });
    expect(out.kind).toBe("YIELDED");
    if (out.kind === "YIELDED") { expect(out.reason).toBe("maxClaims"); expect(out.claims).toBe(2); }
    expect(await memberCount(prepId)).toBe(4); // 2 batches durable
    expect((await prepRow(prepId)).status).toBe("PREPARING");
    const done = await processPreparationWork(FIRM, runId, { batchSize: 2 });
    expect(done.kind).toBe("SEALED");
  });

  it("PD18/PD22: wallClock bound yields between txns; progress summary is truthful", async () => {
    const { runId, prepId } = await draftPreparing(6, 1, 2);
    let n = 0;
    const now = () => { n += 1; return n <= 2 ? 0 : 1_000_000; }; // start=0, iter1=0, iter2=huge
    const out = await processPreparationWork(FIRM, runId, { batchSize: 2, wallClockBudgetMs: 1000, now });
    expect(out.kind).toBe("YIELDED");
    if (out.kind === "YIELDED") {
      expect(out.reason).toBe("wallClock");
      expect(out.claims).toBe(1);
      const total = await owner.auditRunPrepChunk.count({ where: { preparationId: prepId } });
      const doneC = await owner.auditRunPrepChunk.count({ where: { preparationId: prepId, done: true } });
      expect(out.progress).toEqual({ chunksTotal: total, chunksDone: doneC, chunksRemaining: total - doneC });
    }
    expect(await memberCount(prepId)).toBe(2); // one committed batch, no interruption
  });

  it("PD19: an unexpected (untyped/infra) error is NOT silently converted to success", async () => {
    // NOTE: under PREP-F, a deterministic engine error (e.g. a missing fingerprint)
    // is now a typed PreparationDeterministicError → durable FAILED (see PREP-F PF1).
    // This case proves the OTHER branch: a generic/untyped error (here a P2002 from a
    // pre-seeded colliding scope member) must PROPAGATE and leave the prep PREPARING.
    const { runId, prepId } = await draftPreparing(3, 1, 500);
    const chunk = await withTenantContext(FIRM, (t) => t.auditRunPrepChunk.findFirstOrThrow({ where: { preparationId: prepId }, select: { auditTestVersionId: true, datasetId: true } }));
    const firstRow = await withTenantContext(FIRM, (t) => t.importedRecord.findFirstOrThrow({ where: { datasetId: chunk.datasetId, status: { not: "REJECTED" } }, orderBy: { sourceRowNo: "asc" }, select: { sourceRowNo: true } }));
    await owner.auditRunScopeMember.create({ data: { auditFirmId: FIRM, preparationId: prepId, auditTestVersionId: chunk.auditTestVersionId, datasetId: chunk.datasetId, sourceRowNo: firstRow.sourceRowNo, evidenceType: "IMPORTED_RECORD", eoiFrameHash: "deadbeef", contentHash: "deadbeef" } });
    await expect(processPreparationWork(FIRM, runId)).rejects.toThrow();
    const p = await prepRow(prepId);
    expect(p.status).toBe("PREPARING"); // not sealed, not faked, not FAILED
    expect(p.failureCode).toBeNull();
  });

  it("PD25: dirty multiplicity (>1 PREPARING) fails closed with DATA_ERROR (disposable index bypass)", async () => {
    const { runId } = await draftPreparing(2, 1, 500);
    // draftPreparing already created gen1 PREPARING. Temporarily drop the invariant
    // to inject an impossible second PREPARING, then restore it in finally.
    await owner.$executeRawUnsafe(`DROP INDEX "${INDEX}"`);
    try {
      await owner.auditRunPreparation.create({ data: { auditFirmId: FIRM, runId, generationNo: 2, status: "PREPARING" } });
      const out = await processPreparationWork(FIRM, runId);
      expect(out.kind).toBe("DATA_ERROR");
      if (out.kind === "DATA_ERROR") expect(out.preparing).toBe(2);
      expect((await runRow(runId)).status).toBe("PREPARING"); // nothing sealed
    } finally {
      // Clean the dirty state, then restore the invariant for the rest of the run.
      await owner.auditRunPreparation.deleteMany({ where: { runId, generationNo: 2 } });
      await owner.$executeRawUnsafe(`CREATE UNIQUE INDEX "${INDEX}" ON public."audit_run_preparations" ("runId") WHERE "status" = 'PREPARING'`);
    }
  });
});
