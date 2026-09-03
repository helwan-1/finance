/**
 * G4 Phase C2 — FINAL VERIFICATION (C2-V1, C2-V2). Real PostgreSQL, production
 * execution path only. Gated by G4_DB_TEST.
 *
 *  C2-V1: a >=1000-row duplicate TB group → one bounded result (evidence DB-
 *         capped at 3 via fetchTBGroupRows LIMIT 3, never a JS slice of 1000).
 *  C2-V2: real atomic rollback between AuditResult and AuditResultEvidence,
 *         induced through the production persistResult path by a concurrent
 *         owner DELETE of the evidence FK target committed while the unit is
 *         blocked on the evidence-insert FK lock. No mock, no source change.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withTenantContext } from "@/lib/db/tenant";
import { startImport, confirmImport } from "@/lib/import/pipeline";
import { createDraftRun } from "@/lib/g4/run";
import { beginPreparation, materializePopulation, sealPreparation } from "@/lib/g4/preparation";
import { publishRun } from "@/lib/g4/publish";
import { executeRun } from "@/lib/g4/execution/execute";

const run = process.env.G4_DB_TEST ? describe : describe.skip;
const owner = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_DATABASE_URL } } });
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function importTB(csv: string): Promise<string> {
  const n = randomUUID();
  const start = await startImport({ auditFirmId: "firmA", userId: null, engagementId: "engA", datasetKind: "TRIAL_BALANCE", fileName: `v-${n}.csv`, mimeType: "text/csv", bytes: Buffer.from(csv, "utf8"), idempotencyKey: `v-${n}`, acknowledgeDuplicate: true });
  await confirmImport("firmA", null, start.batchId!);
  return start.datasetId!;
}
async function createTBDupTest() {
  const key = `T-${randomUUID()}`;
  return withTenantContext("firmA", async (t) => {
    const test = await t.auditTest.create({ data: { auditFirmId: "firmA", key, name: "n", nameAr: "ن", testType: "ACCOUNTING_INTEGRITY" }, select: { id: true } });
    const tv = await t.auditTestVersion.create({ data: { auditFirmId: "firmA", auditTestId: test.id, version: 1, testType: "ACCOUNTING_INTEGRITY", definitionJson: { kind: "TB_ACCOUNT_DUPLICATION" }, requirementsJson: { requiredDatasetKinds: ["TRIAL_BALANCE"] }, versionHash: `vh-${randomUUID()}`, status: "ACTIVE" }, select: { id: true } });
    await t.auditTest.update({ where: { id: test.id }, data: { currentVersionId: tv.id } });
    return key;
  });
}
async function freeze(datasetId: string, testKey: string) {
  const { runId } = await createDraftRun("firmA", { engagementId: "engA" });
  const { prepId } = await beginPreparation("firmA", { runId, tests: [{ testKey }], datasetIds: [datasetId], batchSize: 500 });
  const chunks = await withTenantContext("firmA", (t) => t.auditRunPrepChunk.findMany({ where: { preparationId: prepId }, select: { auditTestVersionId: true, datasetId: true } }));
  for (const c of chunks) await materializePopulation("firmA", prepId, c.auditTestVersionId, c.datasetId, { batchSize: 500 });
  await sealPreparation("firmA", prepId);
  await publishRun("firmA", runId, prepId);
  return { runId, prepId };
}
const results = (runId: string) => withTenantContext("firmA", (t) => t.auditResult.findMany({ where: { runId }, select: { id: true, resultCode: true, payloadJson: true } }));

run("G4 C2 final verification", () => {
  const PRIOR = process.env.AUDIT_ENGINE_BUILD;
  beforeAll(async () => { process.env.AUDIT_ENGINE_BUILD = "test-build-c2v"; const s = await import("../../_seed"); await s.ensureSeed(); });
  afterAll(async () => { if (PRIOR === undefined) delete process.env.AUDIT_ENGINE_BUILD; else process.env.AUDIT_ENGINE_BUILD = PRIOR; await owner.$disconnect(); await prisma.$disconnect(); });

  it("C2-V1: >=1000-row duplicate group → one result, occurrenceCount=full, evidence DB-bounded to 3", async () => {
    const N = 1000;
    const csv = "account,closing debit,currency\n" + Array.from({ length: N }, () => "900,1.00,USD").join("\n") + "\n";
    const ds = await importTB(csv);
    const testKey = await createTBDupTest();
    const { runId, prepId } = await freeze(ds, testKey);

    // Group size sanity from the frozen population (>= 1000 rows, same trialBalanceId+accountSnapshotId).
    const grp = await withTenantContext("firmA", (t) => t.$queryRaw<Array<{ n: bigint; tbid: string; acc: string }>>(Prisma.sql`
      SELECT count(*) AS n, tbr."trialBalanceId" AS tbid, tbr."accountSnapshotId" AS acc
      FROM "trial_balance_rows" tbr WHERE tbr."datasetId"=${ds} GROUP BY tbr."trialBalanceId", tbr."accountSnapshotId"`));
    const groupSize = Number(grp[0]!.n);
    expect(groupSize).toBeGreaterThanOrEqual(1000);

    expect((await executeRun("firmA", runId, "w")).outcome).toBe("COMPLETED");
    const rows = (await results(runId)).filter((r) => r.resultCode === "AI_TB_ACCOUNT_DUPLICATION");
    expect(rows.length).toBe(1); // exactly one result for the whole 1000-row group
    expect((rows[0]!.payloadJson as { occurrenceCount: number }).occurrenceCount).toBe(groupSize); // full group

    const ev = await withTenantContext("firmA", (t) => t.auditResultEvidence.findMany({ where: { auditResultId: rows[0]!.id }, select: { sourceRowNo: true }, orderBy: { sourceRowNo: "asc" } }));
    expect(ev.length).toBe(3); // DB-capped at K=3 (fetchTBGroupRows: `LIMIT ${k}`) — NOT a JS slice of 1000
    // Evidence is the deterministic first K by sourceRowNo.
    const first3 = await withTenantContext("firmA", (t) => t.$queryRaw<Array<{ sourceRowNo: number }>>(Prisma.sql`
      SELECT ir."sourceRowNo" AS "sourceRowNo" FROM "trial_balance_rows" tbr
      JOIN "imported_records" ir ON ir."id"=tbr."importedRecordId"
      WHERE tbr."trialBalanceId"=${grp[0]!.tbid} AND tbr."accountSnapshotId"=${grp[0]!.acc}
      ORDER BY ir."sourceRowNo" ASC LIMIT 3`));
    expect(ev.map((e) => Number(e.sourceRowNo))).toEqual(first3.map((r) => Number(r.sourceRowNo)));

    // Retry (fresh run over same dataset) is identical and still bounded.
    const f2 = await freeze(ds, await createTBDupTest());
    void prepId; void f2.prepId;
    expect((await executeRun("firmA", f2.runId, "w2")).outcome).toBe("COMPLETED");
    const rows2 = (await results(f2.runId)).filter((r) => r.resultCode === "AI_TB_ACCOUNT_DUPLICATION");
    expect(rows2.length).toBe(1);
    expect((rows2[0]!.payloadJson as { occurrenceCount: number }).occurrenceCount).toBe(groupSize);
    const ev2 = await withTenantContext("firmA", (t) => t.auditResultEvidence.count({ where: { auditResultId: rows2[0]!.id } }));
    expect(ev2).toBe(3);

    console.log("C2-V1 " + JSON.stringify({ groupSize, results: rows.length, occurrenceCount: (rows[0]!.payloadJson as { occurrenceCount: number }).occurrenceCount, evidence: ev.length, firstK: ev.map((e) => Number(e.sourceRowNo)), retryEvidence: ev2 }));
  }, 60000);

  it("C2-V2: real atomic rollback — result INSERT succeeds, evidence FK fails via concurrent target delete", async () => {
    // A duplicate group of 4 so that after one row is deleted, a retry still finds a duplicate.
    const csv = "account,closing debit,currency\n" + Array.from({ length: 4 }, () => "555,2.00,USD").join("\n") + "\n";
    const ds = await importTB(csv);
    const { runId } = await freeze(ds, await createTBDupTest());

    // Evidence target = the TB row with the lowest sourceRowNo in the group (first of K).
    const target = await withTenantContext("firmA", (t) => t.$queryRaw<Array<{ id: string; sourceRowNo: number }>>(Prisma.sql`
      SELECT tbr."id" AS id, ir."sourceRowNo" AS "sourceRowNo" FROM "trial_balance_rows" tbr
      JOIN "imported_records" ir ON ir."id"=tbr."importedRecordId"
      WHERE tbr."datasetId"=${ds} ORDER BY ir."sourceRowNo" ASC LIMIT 1`));
    const targetId = target[0]!.id;

    // Owner tx: DELETE the target row and HOLD it uncommitted until released. Signal
    // once the delete has actually executed (row lock held) so we start the unit only
    // after the FK target is locked — otherwise the unit could race ahead and commit.
    let release!: () => void;
    let deleted!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const deleteDone = new Promise<void>((r) => { deleted = r; });
    const pOwner = owner.$transaction(async (otx) => {
      await otx.$executeRaw(Prisma.sql`DELETE FROM "trial_balance_rows" WHERE "id"=${targetId}`);
      deleted();  // row lock now held (delete uncommitted)
      await gate; // hold until released so the unit's evidence FK insert blocks
    }, { timeout: 60000, maxWait: 5000 });
    await deleteDone; // guarantee the FK target is locked before the unit runs

    // Production execution: fetches (sees the still-present row under MVCC), INSERTs the
    // result, then the evidence INSERT blocks on the FK lock held by the owner delete.
    const pExec = executeRun("firmA", runId, "w");

    // Deterministic: wait until the production unit is actually blocked on a lock
    // (its evidence INSERT waiting on the owner's uncommitted delete of the FK target).
    let blocked = false;
    let blockedQuery = "";
    for (let i = 0; i < 60 && !blocked; i++) {
      const w = await owner.$queryRaw<Array<{ query: string }>>(Prisma.sql`
        SELECT query FROM pg_stat_activity
        WHERE wait_event_type='Lock' AND state='active' AND pid <> pg_backend_pid()`);
      if (w.length > 0) { blocked = true; blockedQuery = w[0]!.query; }
      else await sleep(100);
    }
    expect(blocked).toBe(true); // the result INSERT already ran; the evidence INSERT is blocking
    expect(blockedQuery).toMatch(/audit_result_evidence/i); // specifically the evidence INSERT

    release(); // commit the owner delete → the unit's evidence FK check now fails for real
    await pOwner;
    const out = await pExec;
    expect(out.outcome).toBe("FAILED"); // the whole unit aborted

    // Post-rollback: neither the result nor its evidence (run-scoped) survives.
    const afterResults = await withTenantContext("firmA", (t) => t.auditResult.count({ where: { runId } }));
    const afterEvidence = await withTenantContext("firmA", (t) => t.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`
      SELECT count(*) AS n FROM "audit_result_evidence" e
      WHERE e."auditResultId" IN (SELECT id FROM "audit_results" WHERE "runId"=${runId})`)).then((r) => Number(r[0]!.n));
    expect(afterResults).toBe(0);
    expect(afterEvidence).toBe(0);

    // Locks released + path recovers: a fresh run over the (now 3-row) group succeeds with its required evidence.
    const f2 = await freeze(ds, await createTBDupTest());
    expect((await executeRun("firmA", f2.runId, "w2")).outcome).toBe("COMPLETED");
    const r2 = (await results(f2.runId)).filter((r) => r.resultCode === "AI_TB_ACCOUNT_DUPLICATION");
    expect(r2.length).toBe(1); // still a duplicate group (3 remaining)
    const ev2 = await withTenantContext("firmA", (t) => t.auditResultEvidence.count({ where: { auditResultId: r2[0]!.id } }));
    expect(ev2).toBeGreaterThan(0); // final result has its required evidence
    expect(ev2).toBeLessThanOrEqual(3);

    console.log("C2-V2 " + JSON.stringify({ targetSourceRowNo: Number(target[0]!.sourceRowNo), blockedOn: blockedQuery.replace(/\s+/g, " ").slice(0, 60), outcome: out.outcome, afterResults, afterEvidence, retryResults: r2.length, retryEvidence: ev2 }));
  }, 60000);
});
