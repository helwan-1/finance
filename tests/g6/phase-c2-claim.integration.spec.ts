/**
 * G6 PHASE C2 — preparation claim primitive (claimAndMaterializeBatch).
 * Real PostgreSQL, G4_DB_TEST. C2-1..C2-18 + adversarial multi-worker stress.
 * Proves: chunk-grain claim via FOR UPDATE SKIP LOCKED inside the bounded batch
 * tx; PROGRESSED/CHUNK_COMPLETED/BUSY/COMPLETE/NOT_PREPARING contract; cross-chunk
 * parallelism; same-chunk mutual exclusion; crash/rollback auto-release; RLS;
 * deterministic fingerprints; C1 seal invariant intact; no publish/AuditJob.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withTenantContext } from "@/lib/db/tenant";
import { startImport, confirmImport } from "@/lib/import/pipeline";
import { beginPreparation, materializePopulation, sealPreparation, claimAndMaterializeBatch, PreparationIncompleteError, type ClaimOutcome } from "@/lib/g4/preparation";
import { publishRun } from "@/lib/g4/publish";
import { createDraftRun } from "@/lib/g4/run";

const run = process.env.G4_DB_TEST ? describe : describe.skip;
const OWNER_URL = process.env.DIRECT_DATABASE_URL;
const mkClient = () => new PrismaClient({ datasources: { db: { url: OWNER_URL } } });
const owner = mkClient();
const FIRM = "firmA", ENG = "engA";
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
const LOCK = `SELECT "id" FROM "audit_run_prep_chunks" WHERE "id"=$1 AND "done"=false FOR UPDATE SKIP LOCKED`;

function heldLock(client: PrismaClient, chunkId: string) {
  let rel!: () => void; const released = new Promise<void>((r) => (rel = r));
  let rdy!: (n: number) => void; const ready = new Promise<number>((r) => (rdy = r));
  const done = client.$transaction(async (tx) => {
    const rows = await tx.$queryRawUnsafe<{ id: string }[]>(LOCK, chunkId);
    rdy(rows.length); await released;
  }, { timeout: 25_000, maxWait: 8_000 }).catch(() => {});
  return { ready, release: rel, done };
}

async function importGL(nRows: number): Promise<string> {
  const n = randomUUID();
  let csv = "account,date,debit,credit,currency\n";
  for (let i = 0; i < nRows; i++) csv += `9020${i},2024-01-0${(i % 9) + 1},${i + 2}.00,${i + 1}.00,USD\n`;
  const start = await startImport({ auditFirmId: FIRM, userId: null, engagementId: ENG, datasetKind: "GENERAL_LEDGER", fileName: `c2p-${n}.csv`, mimeType: "text/csv", bytes: Buffer.from(csv, "utf8"), idempotencyKey: `c2p-${n}`, acknowledgeDuplicate: true });
  await confirmImport(FIRM, null, start.batchId!);
  return start.datasetId!;
}
async function makeTest(): Promise<string> {
  const n = randomUUID(); const key = `T-C2P-${n}`;
  await withTenantContext(FIRM, async (t) => {
    const test = await t.auditTest.create({ data: { auditFirmId: FIRM, key, name: "n", nameAr: "ن", testType: "ACCOUNTING_INTEGRITY" }, select: { id: true } });
    const v = await t.auditTestVersion.create({ data: { auditFirmId: FIRM, auditTestId: test.id, version: 1, testType: "ACCOUNTING_INTEGRITY", definitionJson: { kind: "INVALID_DEBIT_CREDIT" }, requirementsJson: { requiredDatasetKinds: ["GENERAL_LEDGER"] }, versionHash: `vh-${n}`, status: "ACTIVE" }, select: { id: true } });
    await t.auditTest.update({ where: { id: test.id }, data: { currentVersionId: v.id } });
  });
  return key;
}
async function makePrep(datasetRowCounts: number[]): Promise<{ prepId: string; runId: string; chunks: { id: string; auditTestVersionId: string; datasetId: string }[] }> {
  const dsIds: string[] = [];
  for (const rc of datasetRowCounts) dsIds.push(await importGL(rc));
  const testKey = await makeTest();
  const { runId } = await createDraftRun(FIRM, { engagementId: ENG });
  const { prepId } = await beginPreparation(FIRM, { runId, tests: [{ testKey }], datasetIds: dsIds, batchSize: 500 });
  const chunks = await withTenantContext(FIRM, (t) => t.auditRunPrepChunk.findMany({ where: { preparationId: prepId }, orderBy: { id: "asc" }, select: { id: true, auditTestVersionId: true, datasetId: true } }));
  return { prepId, runId, chunks };
}
type Counts = { PROGRESSED: number; CHUNK_COMPLETED: number; BUSY: number; COMPLETE: number; NOT_PREPARING: number };
async function workerLoop(prepId: string, batchSize: number): Promise<Counts> {
  const c: Counts = { PROGRESSED: 0, CHUNK_COMPLETED: 0, BUSY: 0, COMPLETE: 0, NOT_PREPARING: 0 };
  for (let i = 0; i < 100_000; i++) {
    const o: ClaimOutcome = await claimAndMaterializeBatch(FIRM, prepId, { batchSize });
    c[o.kind] += 1;
    if (o.kind === "COMPLETE" || o.kind === "NOT_PREPARING") break;
    if (o.kind === "BUSY") await delay(3);
  }
  return c;
}
const memberCount = (prepId: string) => owner.auditRunScopeMember.count({ where: { preparationId: prepId } });
const resolutionCount = (prepId: string) => owner.auditRunScopeResolution.count({ where: { preparationId: prepId } });

run("G6 Phase C2 — preparation claim primitive", () => {
  vi.setConfig({ testTimeout: 90_000, hookTimeout: 120_000 });
  const PRIOR = process.env.AUDIT_ENGINE_BUILD;
  beforeAll(async () => { process.env.AUDIT_ENGINE_BUILD = "test-build-c2p"; const s = await import("../g4/_seed"); await s.ensureSeed(); }, 120_000);
  afterAll(async () => { if (PRIOR === undefined) delete process.env.AUDIT_ENGINE_BUILD; else process.env.AUDIT_ENGINE_BUILD = PRIOR; await owner.$disconnect(); await prisma.$disconnect(); });

  it("C2-1: single worker claims one chunk and progresses one batch", async () => {
    const { prepId } = await makePrep([3]); // 3 rows, batchSize 2 → first batch leaves it unfinished
    const o = await claimAndMaterializeBatch(FIRM, prepId, { batchSize: 2 });
    expect(o.kind).toBe("PROGRESSED");
    expect(await memberCount(prepId)).toBe(2);
  });

  it("C2-2/C2-14: two workers racing the SAME chunk never duplicate-materialize", async () => {
    const { prepId } = await makePrep([6]); // single chunk
    // Drain with 2 concurrent workers; neither may throw a uniqueness error.
    const [a, b] = await Promise.all([workerLoop(prepId, 2), workerLoop(prepId, 2)]);
    expect(await memberCount(prepId)).toBe(6);   // exactly the population, no duplicates
    expect(await resolutionCount(prepId)).toBe(1);
    // both loops terminated at COMPLETE; BUSY (peer-locked) is expected, errors are not
    expect(a.COMPLETE + b.COMPLETE).toBeGreaterThanOrEqual(1);
  });

  it("C2-3: while chunk X is held, a claim takes a DIFFERENT chunk Y (parallelism)", async () => {
    const { prepId, chunks } = await makePrep([3, 3]); // two chunks
    const A = mkClient();
    try {
      const h = heldLock(A, chunks[0]!.id);
      expect(await h.ready).toBe(1); // A holds X
      const o = await claimAndMaterializeBatch(FIRM, prepId, { batchSize: 2 });
      expect(["PROGRESSED", "CHUNK_COMPLETED"]).toContain(o.kind);
      if (o.kind === "PROGRESSED" || o.kind === "CHUNK_COMPLETED") expect(o.chunkId).toBe(chunks[1]!.id); // Y, not X
      h.release(); await h.done;
    } finally { await A.$disconnect(); }
  });

  it("C2-4/C2-5: rollback/crash releases the claim; another worker resumes (no stale owner)", async () => {
    const { prepId, chunks } = await makePrep([4]);
    // A locks the chunk then rolls back (simulated crash) — nothing committed.
    await owner.$transaction(async (tx) => { await tx.$queryRawUnsafe(LOCK, chunks[0]!.id); throw new Error("crash"); }).catch(() => {});
    // Immediately claimable; no owner column to reap.
    const o = await claimAndMaterializeBatch(FIRM, prepId, { batchSize: 2 });
    expect(["PROGRESSED", "CHUNK_COMPLETED"]).toContain(o.kind);
    expect(await memberCount(prepId)).toBe(2); // resumed cleanly from cursor 0
  });

  it("C2-6: BUSY when the only unfinished chunk is peer-locked (not COMPLETE)", async () => {
    const { prepId, chunks } = await makePrep([3]);
    const A = mkClient();
    try {
      const h = heldLock(A, chunks[0]!.id);
      expect(await h.ready).toBe(1);
      const o = await claimAndMaterializeBatch(FIRM, prepId, { batchSize: 2 });
      expect(o.kind).toBe("BUSY");
      if (o.kind === "BUSY") expect(o.unfinished).toBe(1);
      h.release(); await h.done;
    } finally { await A.$disconnect(); }
  });

  it("C2-7: COMPLETE when zero unfinished chunks and prep still PREPARING", async () => {
    const { prepId } = await makePrep([2]);
    let o = await claimAndMaterializeBatch(FIRM, prepId, { batchSize: 500 });
    expect(o.kind).toBe("CHUNK_COMPLETED");
    o = await claimAndMaterializeBatch(FIRM, prepId, { batchSize: 500 });
    expect(o.kind).toBe("COMPLETE");
  });

  it("C2-8: CHUNK_COMPLETED for one chunk does NOT imply whole-prep COMPLETE", async () => {
    const { prepId, chunks } = await makePrep([2, 2]); // two chunks, each finishes in one batch
    const seen: string[] = [];
    for (let i = 0; i < 5; i++) { const o = await claimAndMaterializeBatch(FIRM, prepId, { batchSize: 500 }); seen.push(o.kind); if (o.kind === "COMPLETE") break; }
    // two CHUNK_COMPLETED (one per chunk) precede the single COMPLETE
    expect(seen.filter((k) => k === "CHUNK_COMPLETED").length).toBe(2);
    expect(seen[seen.length - 1]).toBe("COMPLETE");
    expect(seen.indexOf("COMPLETE")).toBe(seen.length - 1); // COMPLETE only after both done
    void chunks;
  });

  it("C2-9: NOT_PREPARING once the prep is no longer PREPARING", async () => {
    const { prepId } = await makePrep([2]);
    await workerLoop(prepId, 500);              // drain → COMPLETE
    await sealPreparation(FIRM, prepId);        // prep → COMPLETE (not PREPARING)
    const o = await claimAndMaterializeBatch(FIRM, prepId, { batchSize: 500 });
    expect(o.kind).toBe("NOT_PREPARING");
  });

  it("C2-10: cross-tenant claim is invisible (NOT_PREPARING, no existence leak)", async () => {
    const { prepId } = await makePrep([2]); // firmA prep
    const o = await claimAndMaterializeBatch("firmB", prepId, { batchSize: 500 });
    expect(o.kind).toBe("NOT_PREPARING");
  });

  it("C2-11: claim-path population fingerprint == targeted materializePopulation path", async () => {
    // Two preps over identical dataset content (content-addressed → equal datasetHash).
    const pA = await makePrep([5]);
    const pB = await makePrep([5]);
    await workerLoop(pA.prepId, 2);                                   // drain A via claim primitive
    const cY = pB.chunks[0]!;
    await materializePopulation(FIRM, pB.prepId, cY.auditTestVersionId, cY.datasetId, { batchSize: 2 }); // drain B targeted
    const fpA = await owner.auditRunScopeResolution.findFirstOrThrow({ where: { preparationId: pA.prepId }, select: { eligiblePopulationFingerprint: true } });
    const fpB = await owner.auditRunScopeResolution.findFirstOrThrow({ where: { preparationId: pB.prepId }, select: { eligiblePopulationFingerprint: true } });
    expect(fpA.eligiblePopulationFingerprint).toBe(fpB.eligiblePopulationFingerprint);
  });

  it("C2-12: a single huge chunk stays sequential across 4 concurrent workers", async () => {
    const { prepId } = await makePrep([40]); // one big chunk
    const loops = await Promise.all([1, 2, 3, 4].map(() => workerLoop(prepId, 5)));
    expect(await memberCount(prepId)).toBe(40); // exactly once each — no duplicate/corruption
    expect(await resolutionCount(prepId)).toBe(1);
    // only one worker ever advances a given batch; peers see BUSY — proven by no error + exact count
    expect(loops.reduce((s, l) => s + l.PROGRESSED + l.CHUNK_COMPLETED, 0)).toBeGreaterThan(0);
  });

  it("C2-13: many chunks distribute across workers with no duplicate errors", async () => {
    const { prepId } = await makePrep([3, 3, 3, 3]); // four chunks
    await Promise.all([1, 2, 3, 4].map(() => workerLoop(prepId, 2)));
    expect(await memberCount(prepId)).toBe(12);
    expect(await resolutionCount(prepId)).toBe(4); // one per test×dataset
    const undone = await owner.auditRunPrepChunk.count({ where: { preparationId: prepId, done: false } });
    expect(undone).toBe(0);
  });

  it("C2-15: partial progress then resume leaves cursor/members consistent", async () => {
    const { prepId } = await makePrep([5]);
    const o1 = await claimAndMaterializeBatch(FIRM, prepId, { batchSize: 2 });
    expect(o1.kind).toBe("PROGRESSED");
    expect(await memberCount(prepId)).toBe(2);
    await workerLoop(prepId, 2); // resume to completion
    expect(await memberCount(prepId)).toBe(5); // no gaps, no dupes
    expect(await resolutionCount(prepId)).toBe(1);
  });

  it("C2-16/C2-17: C1 seal invariant intact; seal succeeds only after true COMPLETE", async () => {
    const { prepId } = await makePrep([3, 3]);
    // C2-16: unfinished → seal refuses (engine invariant)
    await expect(sealPreparation(FIRM, prepId)).rejects.toBeInstanceOf(PreparationIncompleteError);
    await workerLoop(prepId, 2); // drain → COMPLETE
    // C2-17: now seal succeeds
    const sealed = await sealPreparation(FIRM, prepId);
    expect(sealed.manifestHash).toBeTruthy();
  });

  it("C2-18: no publish / no AuditJob side effect from claim+seal", async () => {
    const { prepId, runId } = await makePrep([2, 2]);
    await workerLoop(prepId, 500);
    await sealPreparation(FIRM, prepId);
    const r = await owner.auditRun.findUniqueOrThrow({ where: { id: runId }, select: { status: true, freezeGeneration: true } });
    expect(r.status).not.toBe("QUEUED");         // not published/frozen
    expect(r.freezeGeneration).toBeNull();
    expect(await owner.auditJob.count({ where: { runId } })).toBe(0);
    void publishRun; // publish exists but is never invoked by the claim path
  });

  it("STRESS: 4 workers drain a multi-chunk prep, then seal — deterministic, no dupes, no publish", async () => {
    const { prepId, runId } = await makePrep([5, 5, 5]); // 3 chunks, 15 rows
    const loops = await Promise.all([1, 2, 3, 4].map(() => workerLoop(prepId, 2)));
    // every worker observed COMPLETE (drained state), no NOT_PREPARING mid-flight
    for (const l of loops) { expect(l.COMPLETE).toBeGreaterThanOrEqual(1); expect(l.NOT_PREPARING).toBe(0); }
    expect(await owner.auditRunPrepChunk.count({ where: { preparationId: prepId, done: false } })).toBe(0);
    expect(await memberCount(prepId)).toBe(15);       // exact population, no duplicates
    expect(await resolutionCount(prepId)).toBe(3);    // one per test×dataset
    const sealed = await sealPreparation(FIRM, prepId);
    expect(sealed.manifestHash).toBeTruthy();
    const r = await owner.auditRun.findUniqueOrThrow({ where: { id: runId }, select: { status: true } });
    expect(r.status).not.toBe("QUEUED");             // no auto-publish
    expect(await owner.auditJob.count({ where: { runId } })).toBe(0);
  });
});
