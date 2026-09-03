/**
 * G4 Phase C1 — stale-worker fencing, lease loss, bounded-unit timeout rollback
 * and recovery (real PostgreSQL). Gated by G4_DB_TEST. Proves the concurrency
 * invariants from behavior, not description.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withTenantContext } from "@/lib/db/tenant";
import { startImport, confirmImport } from "@/lib/import/pipeline";
import { createDraftRun } from "@/lib/g4/run";
import { beginPreparation, materializePopulation, sealPreparation } from "@/lib/g4/preparation";
import { publishRun } from "@/lib/g4/publish";
import { executeRun, runResultUnit } from "@/lib/g4/execution/execute";
import { loadExecutionContext } from "@/lib/g4/execution/context";
import { claimInTx, heartbeat } from "@/lib/g4/execution/job";
import { withExecutionUnit } from "@/lib/g4/execution/unit-tx";
import { ensureSeed } from "../_seed";

const run = process.env.G4_DB_TEST ? describe : describe.skip;

type TT = "DATA_QUALITY";
async function createDQTest(firm: string) {
  const key = `T-${randomUUID()}`;
  return withTenantContext(firm, async (t) => {
    const test = await t.auditTest.create({ data: { auditFirmId: firm, key, name: "n", nameAr: "ن", testType: "DATA_QUALITY" as TT }, select: { id: true } });
    const tv = await t.auditTestVersion.create({ data: { auditFirmId: firm, auditTestId: test.id, version: 1, testType: "DATA_QUALITY" as TT, definitionJson: { dqKind: "POPULATION_MEMBER" }, requirementsJson: { requiredDatasetKinds: ["GENERAL_LEDGER"] }, versionHash: `vh-${randomUUID()}`, status: "ACTIVE" }, select: { id: true } });
    await t.auditTest.update({ where: { id: test.id }, data: { currentVersionId: tv.id } });
    return { testKey: key, testVersionId: tv.id };
  });
}
async function freeze(firm: string, eng: string, n: number) {
  const nonce = randomUUID();
  const csv = "account,date,debit,currency\n" + Array.from({ length: n }, (_, i) => `10${i},2024-01-01,${i + 1}.00,USD`).join("\n") + "\n";
  const start = await startImport({ auditFirmId: firm, userId: null, engagementId: eng, datasetKind: "GENERAL_LEDGER", fileName: `f-${nonce}.csv`, mimeType: "text/csv", bytes: Buffer.from(csv, "utf8"), idempotencyKey: `f-${nonce}`, acknowledgeDuplicate: true });
  await confirmImport(firm, null, start.batchId!);
  const ds = start.datasetId!;
  const test = await createDQTest(firm);
  const { runId } = await createDraftRun(firm, { engagementId: eng });
  const { prepId } = await beginPreparation(firm, { runId, tests: [{ testKey: test.testKey }], datasetIds: [ds], batchSize: 500 });
  await materializePopulation(firm, prepId, test.testVersionId, ds, { batchSize: 500 });
  await sealPreparation(firm, prepId);
  await publishRun(firm, runId, prepId);
  const members = await withTenantContext(firm, (t) => t.auditRunScopeMember.count({ where: { preparationId: prepId } }));
  return { ds, test, runId, prepId, members };
}
const expireLease = (firm: string, runId: string) =>
  withTenantContext(firm, (t) => t.$executeRaw(Prisma.sql`UPDATE "audit_jobs" SET "leaseExpiresAt" = clock_timestamp() - interval '1 hour' WHERE "runId"=${runId}`));
const resultCount = (firm: string, runId: string) =>
  withTenantContext(firm, (t) => t.auditResult.count({ where: { runId } }));

run("G4 C1 fencing", () => {
  const PRIOR = process.env.AUDIT_ENGINE_BUILD;
  beforeAll(async () => { process.env.AUDIT_ENGINE_BUILD = "test-build-c1"; await ensureSeed(); });
  afterAll(async () => { if (PRIOR === undefined) delete process.env.AUDIT_ENGINE_BUILD; else process.env.AUDIT_ENGINE_BUILD = PRIOR; await prisma.$disconnect(); });

  it("11/12/13/B: stale worker cannot write or heartbeat after takeover; B completes", async () => {
    const f = await freeze("firmA", "engA", 4);
    // Worker A claims, then stalls (lease expired).
    const claimA = await withExecutionUnit("firmA", (tx) => claimInTx(tx, "firmA", f.runId, "A"));
    expect(claimA.status).toBe("claimed");
    const jobA = claimA.status === "claimed" ? claimA.jobId : "";
    await expireLease("firmA", f.runId);

    // A's lease is lost while the run is still RUNNING → heartbeat fails on the lease fence (live=false).
    await expect(heartbeat("firmA", f.runId, jobA, "A")).rejects.toThrow(/fence failed|lease|live=false/i);

    // Worker B takes over and completes.
    const outB = await executeRun("firmA", f.runId, "B", { batchSize: 2 });
    expect(outB.outcome).toBe("COMPLETED");
    const afterB = await resultCount("firmA", f.runId);
    expect(afterB).toBe(f.members);

    // A tries to write a result unit on its dead job → rejected (lease lost / run no longer RUNNING); no new results.
    const ctx = await withExecutionUnit("firmA", (tx) => loadExecutionContext(tx, "firmA", f.runId));
    await expect(runResultUnit("firmA", ctx, ctx.testPins[0]!, jobA, "A", null, 2)).rejects.toThrow(/lease|cancel|not RUNNING/i);
    expect(await resultCount("firmA", f.runId)).toBe(afterB); // unchanged
  });

  it("10: heartbeat with a valid lease succeeds", async () => {
    const f = await freeze("firmA", "engA", 2);
    const claim = await withExecutionUnit("firmA", (tx) => claimInTx(tx, "firmA", f.runId, "A"));
    const jobA = claim.status === "claimed" ? claim.jobId : "";
    await expect(heartbeat("firmA", f.runId, jobA, "A")).resolves.toBeUndefined();
  });

  it("D1-T1/T2/T3: a unit exceeding statement_timeout rolls back result+evidence; lease recoverable", async () => {
    const f = await freeze("firmA", "engA", 3);
    const ctx = await withExecutionUnit("firmA", (tx) => loadExecutionContext(tx, "firmA", f.runId));
    const artv = ctx.testPins[0]!.auditRunTestVersionId;
    // Inside one bounded unit: insert a real result, then sleep past statement_timeout (8s).
    const rid = randomUUID();
    await expect(withExecutionUnit("firmA", async (tx) => {
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "audit_results" ("id","auditFirmId","runId","auditRunTestVersionId","resultKind","resultCode","severity","score","payloadJson","resultOccurrenceFingerprint","resultSemanticFingerprint","createdAt")
        VALUES (${rid}, 'firmA', ${f.runId}, ${artv}, 'DATA_QUALITY', 'TMP', 'LOW'::"AnomalySeverity", 0.00, '{}'::jsonb, ${"occ-" + rid}, ${"sem-" + rid}, clock_timestamp())`);
      await tx.$executeRawUnsafe("SELECT pg_sleep(9)"); // > statement_timeout → aborts the statement → tx rolls back
    })).rejects.toThrow();
    // The inserted result was rolled back (no persist).
    const stray = await withTenantContext("firmA", (t) => t.auditResult.count({ where: { runId: f.runId, resultCode: "TMP" } }));
    expect(stray).toBe(0);
    // Lease/run are recoverable: a normal execution still completes.
    const out = await executeRun("firmA", f.runId, "worker-A");
    expect(out.outcome).toBe("COMPLETED");
    expect(await resultCount("firmA", f.runId)).toBe(f.members);
  }, 30000);

  it("24: cancellation blocks a subsequent result unit (fence observes CANCELLED)", async () => {
    const f = await freeze("firmA", "engA", 3);
    const claim = await withExecutionUnit("firmA", (tx) => claimInTx(tx, "firmA", f.runId, "A"));
    const jobA = claim.status === "claimed" ? claim.jobId : "";
    // Cancel the run.
    await withTenantContext("firmA", (t) => t.$executeRaw(Prisma.sql`UPDATE "audit_runs" SET "status"='CANCELLED', "updatedAt"=now() WHERE "id"=${f.runId}`));
    const ctx = await withExecutionUnit("firmA", (tx) => loadExecutionContext(tx, "firmA", f.runId));
    await expect(runResultUnit("firmA", ctx, ctx.testPins[0]!, jobA, "A", null, 2)).rejects.toThrow(/cancel|not RUNNING/i);
    expect(await resultCount("firmA", f.runId)).toBe(0);
  });

  it("7/9/D1-T5: double claim — only one worker owns; second is skipped/owned", async () => {
    const f = await freeze("firmA", "engA", 2);
    const a = await withExecutionUnit("firmA", (tx) => claimInTx(tx, "firmA", f.runId, "A"));
    expect(a.status).toBe("claimed");
    const b = await withExecutionUnit("firmA", (tx) => claimInTx(tx, "firmA", f.runId, "B"));
    expect(["owned", "locked"]).toContain(b.status); // B cannot also own
    const jobs = await withTenantContext("firmA", (t) => t.auditJob.count({ where: { runId: f.runId } }));
    expect(jobs).toBe(1);
  });
});
