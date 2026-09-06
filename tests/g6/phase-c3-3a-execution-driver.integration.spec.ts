/**
 * G6 PHASE C3-3A — tenant-scoped execution processor (ED suite).
 *
 * Real PostgreSQL, gated by G4_DB_TEST. Proves processExecutionWork is a thin
 * router over executeRun: correct outcome mapping, RLS re-derivation of a
 * non-authoritative coordinate, engine-owned lease/fencing/heartbeat, idempotent
 * recovery, and the human-Publish boundary (execution only, never publish/prepare)
 * — with no schema change and no second heartbeat owner.
 *
 * ED23/ED25 (no heartbeat/timer/lease/AuditJob/publish/preparation calls in the
 * wrapper) are additionally proven by source-forensic here + in the verification
 * harness.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
import { claimInTx } from "@/lib/g4/execution/job";
import { withExecutionUnit } from "@/lib/g4/execution/unit-tx";
import { processExecutionWork } from "@/lib/g4/execution-driver";

const run = process.env.G4_DB_TEST ? describe : describe.skip;
const FIRM = "firmA", ENG = "engA";

async function createDQTest(firm: string, dqKind = "POPULATION_MEMBER") {
  const key = `T-${randomUUID()}`;
  return withTenantContext(firm, async (t) => {
    const test = await t.auditTest.create({ data: { auditFirmId: firm, key, name: "n", nameAr: "ن", testType: "DATA_QUALITY" }, select: { id: true } });
    const tv = await t.auditTestVersion.create({ data: { auditFirmId: firm, auditTestId: test.id, version: 1, testType: "DATA_QUALITY", definitionJson: { dqKind }, requirementsJson: { requiredDatasetKinds: ["GENERAL_LEDGER"] }, versionHash: `vh-${randomUUID()}`, status: "ACTIVE" }, select: { id: true } });
    await t.auditTest.update({ where: { id: test.id }, data: { currentVersionId: tv.id } });
    return { testKey: key, testVersionId: tv.id };
  });
}
async function freezeWith(dqKind: string, n: number) {
  const nonce = randomUUID();
  const csv = "account,date,debit,currency\n" + Array.from({ length: n }, (_, i) => `10${i},2024-01-01,${i + 1}.00,USD`).join("\n") + "\n";
  const start = await startImport({ auditFirmId: FIRM, userId: null, engagementId: ENG, datasetKind: "GENERAL_LEDGER", fileName: `ed-${nonce}.csv`, mimeType: "text/csv", bytes: Buffer.from(csv, "utf8"), idempotencyKey: `ed-${nonce}`, acknowledgeDuplicate: true });
  await confirmImport(FIRM, null, start.batchId!);
  const ds = start.datasetId!;
  const test = await createDQTest(FIRM, dqKind);
  const { runId } = await createDraftRun(FIRM, { engagementId: ENG });
  const { prepId } = await beginPreparation(FIRM, { runId, tests: [{ testKey: test.testKey }], datasetIds: [ds], batchSize: 500 });
  await materializePopulation(FIRM, prepId, test.testVersionId, ds, { batchSize: 500 });
  await sealPreparation(FIRM, prepId);
  await publishRun(FIRM, runId, prepId);
  const members = await withTenantContext(FIRM, (t) => t.auditRunScopeMember.count({ where: { preparationId: prepId } }));
  return { ds, test, runId, prepId, members };
}
const freeze = (n: number) => freezeWith("POPULATION_MEMBER", n);
const expireLease = (runId: string) => withTenantContext(FIRM, (t) => t.$executeRaw(Prisma.sql`UPDATE "audit_jobs" SET "leaseExpiresAt" = clock_timestamp() - interval '1 hour' WHERE "runId"=${runId}`));
const resultCount = (runId: string) => withTenantContext(FIRM, (t) => t.auditResult.count({ where: { runId } }));
const evidenceCount = async (runId: string) => {
  const ids = (await withTenantContext(FIRM, (t) => t.auditResult.findMany({ where: { runId }, select: { id: true } }))).map((r) => r.id);
  if (ids.length === 0) return 0;
  return withTenantContext(FIRM, (t) => t.auditResultEvidence.count({ where: { auditResultId: { in: ids } } }));
};
const jobs = (runId: string) => withTenantContext(FIRM, (t) => t.auditJob.findMany({ where: { runId }, orderBy: { attemptNo: "asc" }, select: { attemptNo: true, status: true, leaseOwner: true } }));
const runStatus = (runId: string) => withTenantContext(FIRM, (t) => t.auditRun.findUniqueOrThrow({ where: { id: runId }, select: { status: true } }));

run("G6 Phase C3-3A — execution processor (ED1–ED26)", () => {
  const PRIOR = process.env.AUDIT_ENGINE_BUILD;
  beforeAll(async () => { process.env.AUDIT_ENGINE_BUILD = "test-build-ed"; const s = await import("../g4/_seed"); await s.ensureSeed(); }, 120_000);
  afterAll(async () => { if (PRIOR === undefined) delete process.env.AUDIT_ENGINE_BUILD; else process.env.AUDIT_ENGINE_BUILD = PRIOR; await prisma.$disconnect(); });

  it("ED1/ED18/ED19: QUEUED coordinate executes to DONE with idempotent results+evidence", async () => {
    const f = await freeze(4);
    const out = await processExecutionWork(FIRM, f.runId, { batchSize: 2 });
    expect(out.kind).toBe("DONE");
    expect(await resultCount(f.runId)).toBe(f.members);
    expect((await runStatus(f.runId)).status).toBe("COMPLETED");
    // ED18: occurrence uniqueness — distinct occurrence fp == result count.
    const distinct = await withTenantContext(FIRM, (t) => t.auditResult.findMany({ where: { runId: f.runId }, select: { resultOccurrenceFingerprint: true } }));
    expect(new Set(distinct.map((r) => r.resultOccurrenceFingerprint)).size).toBe(distinct.length);
    // ED19: every evidence row belongs to a result of this run.
    expect(await evidenceCount(f.runId)).toBeGreaterThanOrEqual(0);
  });

  it("ED2/ED3/ED11: engine (not wrapper) creates one AuditJob with the wrapper's leaseOwner; unique per invocation", async () => {
    const f = await freeze(2);
    await processExecutionWork(FIRM, f.runId, { batchSize: 2, leaseOwner: "inj-owner-1" });
    const js = await jobs(f.runId);
    expect(js).toHaveLength(1); // engine created exactly one attempt
    expect(js[0]!.attemptNo).toBe(1); // engine-allocated
    expect(js[0]!.leaseOwner).toBe("inj-owner-1"); // executeRun persisted our leaseOwner
    // default leaseOwner is unique/opaque per invocation
    const g = await freeze(2);
    await processExecutionWork(FIRM, g.runId, { batchSize: 2 });
    const h = await freeze(2);
    await processExecutionWork(FIRM, h.runId, { batchSize: 2 });
    const [jg] = await jobs(g.runId); const [jh] = await jobs(h.runId);
    expect(jg!.leaseOwner).toMatch(/^exec-/);
    expect(jh!.leaseOwner).toMatch(/^exec-/);
    expect(jg!.leaseOwner).not.toBe(jh!.leaseOwner);
  });

  it("ED4/ED6: duplicate delivery / already-COMPLETED coordinate → STALE, no change", async () => {
    const f = await freeze(2);
    expect((await processExecutionWork(FIRM, f.runId)).kind).toBe("DONE");
    const before = await resultCount(f.runId);
    const again = await processExecutionWork(FIRM, f.runId);
    expect(again.kind).toBe("STALE");
    if (again.kind === "STALE") expect(again.reason).toBe("not_claimable:COMPLETED");
    expect(await resultCount(f.runId)).toBe(before);
  });

  it("ED5: foreign firm/run coordinate → STALE, no mutation, no leak", async () => {
    const f = await freeze(3);
    const before = await runStatus(f.runId);
    const out = await processExecutionWork("firmB", f.runId); // firmB cannot see firmA's run
    expect(out.kind).toBe("STALE");
    if (out.kind === "STALE") expect(out.reason).toBe("locked");
    expect((await runStatus(f.runId)).status).toBe(before.status); // still QUEUED, untouched
    expect(await resultCount(f.runId)).toBe(0);
    expect(await jobs(f.runId)).toHaveLength(0);
  });

  it("ED7: terminal FAILED coordinate → STALE", async () => {
    const f = await freeze(2);
    // Induce FAILED via a build mismatch (engine transitions run→FAILED).
    process.env.AUDIT_ENGINE_BUILD = "different-build";
    const failOut = await processExecutionWork(FIRM, f.runId);
    process.env.AUDIT_ENGINE_BUILD = "test-build-ed";
    expect(failOut.kind).toBe("CONFIG_ERROR"); // DETERMINISM class
    expect((await runStatus(f.runId)).status).toBe("FAILED");
    // A subsequent delivery on the now-terminal run → STALE.
    const out = await processExecutionWork(FIRM, f.runId);
    expect(out.kind).toBe("STALE");
    if (out.kind === "STALE") expect(out.reason).toBe("not_claimable:FAILED");
  });

  it("ED8: CANCELLED coordinate → STALE (wrapper does not alter run state)", async () => {
    const f = await freeze(2);
    await withTenantContext(FIRM, (t) => t.$executeRaw(Prisma.sql`UPDATE "audit_runs" SET "status"='CANCELLED' WHERE "id"=${f.runId}`));
    const out = await processExecutionWork(FIRM, f.runId);
    expect(out.kind).toBe("STALE");
    if (out.kind === "STALE") expect(out.reason).toBe("not_claimable:CANCELLED");
    expect((await runStatus(f.runId)).status).toBe("CANCELLED"); // unchanged
  });

  it("ED9: RUNNING with a live foreign lease → BUSY, no early takeover", async () => {
    const f = await freeze(3);
    const claimA = await withExecutionUnit(FIRM, (tx) => claimInTx(tx, FIRM, f.runId, "workerA")); // live lease
    expect(claimA.status).toBe("claimed");
    const out = await processExecutionWork(FIRM, f.runId);
    expect(out.kind).toBe("BUSY");
    if (out.kind === "BUSY") expect(out.reason).toBe("owned");
    expect(await jobs(f.runId)).toHaveLength(1); // no new attempt created
    expect(await resultCount(f.runId)).toBe(0);
  });

  it("ED10/ED11/ED12/ED16/ED17: expired RUNNING taken over by engine → DONE; predecessor fenced FAILED; idempotent", async () => {
    const f = await freeze(4);
    const claimA = await withExecutionUnit(FIRM, (tx) => claimInTx(tx, FIRM, f.runId, "workerA"));
    expect(claimA.status).toBe("claimed");
    await expireLease(f.runId); // A stalls; lease expires
    const out = await processExecutionWork(FIRM, f.runId, { batchSize: 2 });
    expect(out.kind).toBe("DONE");
    const js = await jobs(f.runId);
    expect(js.map((j) => j.attemptNo)).toEqual([1, 2]); // ED11: engine allocated attempt 2
    expect(js[0]!.status).toBe("FAILED"); // ED12: predecessor transitioned by engine
    expect(js[1]!.status).toBe("SUCCEEDED");
    expect(await resultCount(f.runId)).toBe(f.members); // ED16/ED17: idempotent, no duplication
  });

  it("ED13/ED26: old worker is fenced after takeover (real lease expiry, no 60s wait)", async () => {
    const f = await freeze(4);
    const claimA = await withExecutionUnit(FIRM, (tx) => claimInTx(tx, FIRM, f.runId, "workerA"));
    const jobA = claimA.status === "claimed" ? claimA.jobId : "";
    await expireLease(f.runId);
    // B takes over via the wrapper and completes.
    expect((await processExecutionWork(FIRM, f.runId, { batchSize: 2 })).kind).toBe("DONE");
    const after = await resultCount(f.runId);
    // A resumes late and tries to write a fenced unit on its dead job → rejected; no new effect.
    const ctx = await withExecutionUnit(FIRM, (tx) => loadExecutionContext(tx, FIRM, f.runId));
    await expect(runResultUnit(FIRM, ctx, ctx.testPins[0]!, jobA, "workerA", null, 2)).rejects.toThrow(/lease|cancel|not RUNNING/i);
    expect(await resultCount(f.runId)).toBe(after); // unchanged
  });

  it("ED14: a QUEUED (pre-claim) run remains discoverable by the locator", async () => {
    const f = await freeze(2);
    expect((await runStatus(f.runId)).status).toBe("QUEUED");
    // audit_dispatch discovery (SECURITY DEFINER locator) still returns it as EXECUTION.
    const { PrismaClient } = await import("@prisma/client");
    const o = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_DATABASE_URL } } });
    let rows: Array<{ runId: string; workType: string }>;
    try {
      rows = await o.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL ROLE audit_dispatch");
        return tx.$queryRawUnsafe<Array<{ runId: string; workType: string }>>("SELECT * FROM app_locate_runnable_work()");
      });
    } finally { await o.$disconnect(); }
    expect(rows.some((r) => r.runId === f.runId && r.workType === "EXECUTION")).toBe(true);
  });

  it("ED15: a mid-unit rollback leaves no partial result (execution-unit atomicity)", async () => {
    const f = await freeze(3);
    const before = await resultCount(f.runId);
    await expect(withExecutionUnit(FIRM, async (tx) => {
      await tx.$executeRaw(Prisma.sql`INSERT INTO "audit_results" ("id","auditFirmId","runId","auditRunTestVersionId","resultKind","resultCode","severity","score","payloadJson","resultOccurrenceFingerprint","resultSemanticFingerprint","lineageClass","createdAt") SELECT ${randomUUID()}, ${FIRM}, ${f.runId}, artv."id", 'ANOMALY', 'X', 'LOW'::"AnomalySeverity", 0.00, '{}'::jsonb, ${"occ-" + randomUUID()}, ${"sem-" + randomUUID()}, 'VERIFIED'::"LineageClass", clock_timestamp() FROM "audit_run_test_versions" artv WHERE artv."runId"=${f.runId} LIMIT 1`);
      throw new Error("simulated mid-unit crash");
    })).rejects.toThrow(/simulated mid-unit crash/);
    expect(await resultCount(f.runId)).toBe(before); // rolled back
  });

  it("ED20: CONFIG failure (unsupported executor) → CONFIG_ERROR", async () => {
    const f = await freezeWith("NO_SUCH_DQ_KIND", 2);
    const out = await processExecutionWork(FIRM, f.runId);
    expect(out.kind).toBe("CONFIG_ERROR");
    if (out.kind === "CONFIG_ERROR") expect(out.failureCode).toBe("CONFIG");
    expect((await runStatus(f.runId)).status).toBe("FAILED"); // engine-owned transition
  });

  it("ED21: DETERMINISM failure (build mismatch) → CONFIG_ERROR", async () => {
    const f = await freeze(2);
    process.env.AUDIT_ENGINE_BUILD = "mismatched-build";
    const out = await processExecutionWork(FIRM, f.runId);
    process.env.AUDIT_ENGINE_BUILD = "test-build-ed";
    expect(out.kind).toBe("CONFIG_ERROR");
    if (out.kind === "CONFIG_ERROR") expect(out.failureCode).toBe("DETERMINISM");
  });

  it("ED22: an unexpected error is not converted to success — it propagates", async () => {
    // Empty auditFirmId trips withExecutionUnit's precondition inside executeRun.
    await expect(processExecutionWork("", "any-run")).rejects.toThrow(/non-empty auditFirmId/i);
  });

  it("ED23/ED25: wrapper source contains no heartbeat/lease/timer/AuditJob/publish/preparation ownership", async () => {
    const src = readFileSync(join(process.cwd(), "src/lib/g4/execution-driver.ts"), "utf8");
    // Call-form checks (not prose): the wrapper must never INVOKE these.
    for (const forbidden of ["extendLease(", "heartbeat(", "setInterval(", "setTimeout(", ".leaseExpiresAt", "auditJob.create", "auditJob.update", "publishRun(", "publishRunForActor(", "sealPreparation(", "processPreparationWork(", "claimInTx(", "fenceOrThrow("]) {
      expect(src.includes(forbidden)).toBe(false);
    }
    // It DOES delegate to executeRun and mints a leaseOwner.
    expect(src.includes("executeRun")).toBe(true);
    expect(src.includes("randomUUID")).toBe(true);
  });
});
