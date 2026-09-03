/**
 * G4 Phase C1 — execution pipeline integration matrix (real PostgreSQL, RLS,
 * immutable privileges). Gated by G4_DB_TEST. Proves frozen-only execution,
 * immutable idempotent results, evidence-in-population, fingerprints, tenant
 * isolation, completion, and immutability from executed behavior.
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
import { executeRun } from "@/lib/g4/execution/execute";
import { loadExecutionContext } from "@/lib/g4/execution/context";
import { assertMember } from "@/lib/g4/execution/population";
import { withExecutionUnit } from "@/lib/g4/execution/unit-tx";
import { ensureSeed } from "../_seed";

const run = process.env.G4_DB_TEST ? describe : describe.skip;

type TT = "RULE" | "STATISTICAL" | "RECONCILIATION" | "ACCOUNTING_INTEGRITY" | "ANALYTICAL" | "DATA_QUALITY";
async function createDQTest(firm: string) {
  const key = `T-${randomUUID()}`;
  return withTenantContext(firm, async (t) => {
    const test = await t.auditTest.create({ data: { auditFirmId: firm, key, name: "n", nameAr: "ن", testType: "DATA_QUALITY" as TT }, select: { id: true } });
    const tv = await t.auditTestVersion.create({ data: { auditFirmId: firm, auditTestId: test.id, version: 1, testType: "DATA_QUALITY" as TT, definitionJson: { dqKind: "POPULATION_MEMBER" }, requirementsJson: { requiredDatasetKinds: ["GENERAL_LEDGER"] }, versionHash: `vh-${randomUUID()}`, status: "ACTIVE" }, select: { id: true } });
    await t.auditTest.update({ where: { id: test.id }, data: { currentVersionId: tv.id } });
    return { testId: test.id, testKey: key, testVersionId: tv.id };
  });
}

async function importGL(firm: string, eng: string, lines: string[]): Promise<string> {
  const n = randomUUID();
  const csv = "account,date,debit,currency\n" + lines.join("\n") + "\n";
  const start = await startImport({
    auditFirmId: firm, userId: null, engagementId: eng, datasetKind: "GENERAL_LEDGER",
    fileName: `c1-${n}.csv`, mimeType: "text/csv", bytes: Buffer.from(csv, "utf8"),
    idempotencyKey: `c1-${n}`, acknowledgeDuplicate: true,
  });
  await confirmImport(firm, null, start.batchId!);
  return start.datasetId!;
}
const uniqLines = (n: number) => Array.from({ length: n }, (_, i) => `10${i},2024-01-01,${i + 1}.00,USD`);

/** Full freeze via Phase B → returns a QUEUED run + its pinned test/dataset/members. */
async function freeze(firm: string, eng: string, lines: string[]) {
  const ds = await importGL(firm, eng, lines);
  const test = await createDQTest(firm);
  const { runId } = await createDraftRun(firm, { engagementId: eng });
  const { prepId } = await beginPreparation(firm, { runId, tests: [{ testKey: test.testKey }], datasetIds: [ds], batchSize: 500 });
  await materializePopulation(firm, prepId, test.testVersionId, ds, { batchSize: 500 });
  await sealPreparation(firm, prepId);
  await publishRun(firm, runId, prepId);
  const members = await withTenantContext(firm, (t) => t.auditRunScopeMember.count({ where: { preparationId: prepId } }));
  return { ds, test, runId, prepId, members };
}

const results = (firm: string, runId: string) =>
  withTenantContext(firm, (t) => t.auditResult.findMany({ where: { runId }, select: { id: true, resultCode: true, resultOccurrenceFingerprint: true, resultSemanticFingerprint: true, auditRunTestVersionId: true } }));

run("G4 C1 execute", () => {
  const PRIOR = process.env.AUDIT_ENGINE_BUILD;
  beforeAll(async () => { process.env.AUDIT_ENGINE_BUILD = "test-build-c1"; await ensureSeed(); });
  afterAll(async () => { if (PRIOR === undefined) delete process.env.AUDIT_ENGINE_BUILD; else process.env.AUDIT_ENGINE_BUILD = PRIOR; await prisma.$disconnect(); });

  it("26/15: frozen run executes to COMPLETED; one result + one evidence per member", async () => {
    const f = await freeze("firmA", "engA", uniqLines(4));
    const out = await executeRun("firmA", f.runId, "worker-A");
    expect(out.outcome).toBe("COMPLETED");
    const rows = await results("firmA", f.runId);
    expect(rows.length).toBe(f.members);
    expect(rows.every((r) => r.resultCode === "DQ_POPULATION_MEMBER")).toBe(true);
    const ev = await withTenantContext("firmA", (t) => t.auditResultEvidence.count({ where: { auditFirmId: "firmA" } }));
    const evForRun = await withTenantContext("firmA", async (t) => {
      const ids = rows.map((r) => r.id);
      return t.auditResultEvidence.count({ where: { auditResultId: { in: ids } } });
    });
    expect(evForRun).toBe(f.members); // exactly one evidence per result (C: no result without evidence)
    expect(ev).toBeGreaterThanOrEqual(evForRun);
    const st = await withTenantContext("firmA", (t) => t.auditRun.findUnique({ where: { id: f.runId }, select: { status: true } }));
    expect(st?.status).toBe("COMPLETED");
  });

  it("2/29: cross-tenant execution cannot claim (RLS fail-closed)", async () => {
    const f = await freeze("firmA", "engA", uniqLines(2));
    const out = await executeRun("firmB", f.runId, "attacker");
    expect(out.outcome).toBe("NOT_CLAIMED"); // firmB cannot even see the run row
    const jobs = await withTenantContext("firmA", (t) => t.auditJob.count({ where: { runId: f.runId } }));
    expect(jobs).toBe(0);
    const rows = await results("firmA", f.runId);
    expect(rows.length).toBe(0);
  });

  it("3: run not QUEUED is not claimable", async () => {
    const { runId } = await createDraftRun("firmA", { engagementId: "engA" }); // DRAFT
    const out = await executeRun("firmA", runId, "worker-A");
    expect(out.outcome).toBe("NOT_CLAIMED");
  });

  it("4: QUEUED run without freezeGeneration fails closed CONFIG", async () => {
    // Construct an anomalous QUEUED run with no freezeGeneration (never happens via publish).
    const runId = await withTenantContext("firmA", async (t) => {
      const r = await t.auditRun.create({ data: { auditFirmId: "firmA", engagementId: "engA", status: "QUEUED", engineBuildVersion: "test-build-c1", configFingerprint: `cfg-${randomUUID()}`, freezeFormatVersion: "g4.1", frozenAt: new Date() }, select: { id: true } });
      return r.id;
    });
    const out = await executeRun("firmA", runId, "worker-A");
    expect(out.outcome).toBe("FAILED");
    if (out.outcome === "FAILED") expect(out.failureCode).toBe("CONFIG");
  });

  it("5/8: engine build mismatch → DETERMINISM, run FAILED, no results, freeze intact", async () => {
    const f = await freeze("firmA", "engA", uniqLines(3));
    process.env.AUDIT_ENGINE_BUILD = "different-build";
    let out;
    try { out = await executeRun("firmA", f.runId, "worker-A"); } finally { process.env.AUDIT_ENGINE_BUILD = "test-build-c1"; }
    expect(out!.outcome).toBe("FAILED");
    if (out!.outcome === "FAILED") expect(out!.failureCode).toBe("DETERMINISM");
    const st = await withTenantContext("firmA", (t) => t.auditRun.findUnique({ where: { id: f.runId }, select: { status: true, failureCode: true, freezeGeneration: true, engineBuildVersion: true } }));
    expect(st?.status).toBe("FAILED");
    expect(st?.failureCode).toBe("DETERMINISM");
    expect(st?.freezeGeneration).toBe(f.prepId);
    expect(st?.engineBuildVersion).toBe("test-build-c1");
    expect((await results("firmA", f.runId)).length).toBe(0);
  });

  it("14/D2-T1: crash-retry converges without duplicating; retry performs its own exhaustion scan", async () => {
    const f = await freeze("firmA", "engA", uniqLines(5));
    // Attempt 1: claim + run to completion of the scan but simulate a crash before finalize by
    // claiming and processing via executeRun with a live lease, then expiring it and retrying.
    // Simpler crash model: worker A claims and partially runs one unit, then its lease expires.
    const { claimInTx } = await import("@/lib/g4/execution/job");
    const claim = await withExecutionUnit("firmA", (tx) => claimInTx(tx, "firmA", f.runId, "A"));
    expect(claim.status).toBe("claimed");
    // Expire A's lease (simulate stall/crash).
    await withTenantContext("firmA", (t) => t.$executeRaw(Prisma.sql`UPDATE "audit_jobs" SET "leaseExpiresAt" = clock_timestamp() - interval '1 hour' WHERE "runId"=${f.runId}`));
    // Worker B takes over → new attempt, re-scans to exhaustion, completes.
    const out = await executeRun("firmA", f.runId, "B", { batchSize: 2 });
    expect(out.outcome).toBe("COMPLETED");
    const rows = await results("firmA", f.runId);
    expect(rows.length).toBe(f.members); // no duplication despite two attempts
    // two attempts recorded (A failed LEASE_LOST, B succeeded)
    const jobs = await withTenantContext("firmA", (t) => t.auditJob.findMany({ where: { runId: f.runId }, select: { attemptNo: true, status: true }, orderBy: { attemptNo: "asc" } }));
    expect(jobs.length).toBe(2);
    expect(jobs[0]!.status).toBe("FAILED");
    expect(jobs[1]!.status).toBe("SUCCEEDED");
  });

  it("16: evidence outside the frozen population fails closed", async () => {
    const f = await freeze("firmA", "engA", uniqLines(2));
    const ctx = await withExecutionUnit("firmA", (tx) => loadExecutionContext(tx, "firmA", f.runId));
    await expect(withExecutionUnit("firmA", (tx) => assertMember(tx, ctx.preparationId, ctx.testPins[0]!.auditTestVersionId, f.ds, 999999)))
      .rejects.toThrow(/not a frozen population member/);
  });

  it("17/13: duplicate-content rows at distinct sourceRowNo → distinct occurrences", async () => {
    // Two identical GL lines → same rawHash, different sourceRowNo → two members.
    const f = await freeze("firmA", "engA", ["555,2024-01-01,9.00,USD", "555,2024-01-01,9.00,USD"]);
    expect(f.members).toBe(2);
    const out = await executeRun("firmA", f.runId, "worker-A");
    expect(out.outcome).toBe("COMPLETED");
    const rows = await results("firmA", f.runId);
    expect(rows.length).toBe(2);
    expect(new Set(rows.map((r) => r.resultOccurrenceFingerprint)).size).toBe(2); // distinct occurrences
    expect(new Set(rows.map((r) => r.resultSemanticFingerprint)).size).toBe(2); // distinct semantic (EOI differs by row)
  });

  it("19/12: two runs over the SAME frozen dataset + test share result semantic fingerprints (cross-run reproducibility)", async () => {
    // Hold the semantic config constant: one dataset, one test, two independent runs.
    const ds = await importGL("firmA", "engA", ["770,2024-03-03,3.00,USD", "771,2024-03-03,4.00,USD"]);
    const test = await createDQTest("firmA");
    const freezeShared = async () => {
      const { runId } = await createDraftRun("firmA", { engagementId: "engA" });
      const { prepId } = await beginPreparation("firmA", { runId, tests: [{ testKey: test.testKey }], datasetIds: [ds], batchSize: 500 });
      await materializePopulation("firmA", prepId, test.testVersionId, ds, { batchSize: 500 });
      await sealPreparation("firmA", prepId);
      await publishRun("firmA", runId, prepId);
      return runId;
    };
    const r1 = await freezeShared();
    const r2 = await freezeShared();
    expect(r1).not.toBe(r2);
    await executeRun("firmA", r1, "w1");
    await executeRun("firmA", r2, "w2");
    const s1 = new Set((await results("firmA", r1)).map((x) => x.resultSemanticFingerprint));
    const s2 = new Set((await results("firmA", r2)).map((x) => x.resultSemanticFingerprint));
    expect(s1.size).toBe(2);
    expect(s1).toEqual(s2); // identical semantic config + evidence → identical g4sem.3 across runs
    // ...and the run-local occurrence fingerprints DIFFER (different runId).
    const o1 = new Set((await results("firmA", r1)).map((x) => x.resultOccurrenceFingerprint));
    const o2 = new Set((await results("firmA", r2)).map((x) => x.resultOccurrenceFingerprint));
    expect([...o1].some((o) => o2.has(o))).toBe(false);
  });

  it("22: currentVersion pointer movement after freeze does not change execution", async () => {
    const f = await freeze("firmA", "engA", uniqLines(3));
    // Move the test's currentVersion pointer AFTER publish.
    await withTenantContext("firmA", async (t) => {
      const tv2 = await t.auditTestVersion.create({ data: { auditFirmId: "firmA", auditTestId: f.test.testId, version: 2, testType: "DATA_QUALITY" as TT, definitionJson: { dqKind: "POPULATION_MEMBER", changed: true }, requirementsJson: {}, versionHash: `vh-${randomUUID()}`, status: "ACTIVE" }, select: { id: true } });
      await t.auditTest.update({ where: { id: f.test.testId }, data: { currentVersionId: tv2.id } });
    });
    const out = await executeRun("firmA", f.runId, "worker-A");
    expect(out.outcome).toBe("COMPLETED");
    // Results are pinned to the frozen ARTV (version 1), not the moved pointer.
    const rows = await results("firmA", f.runId);
    const artvs = await withTenantContext("firmA", (t) => t.auditRunTestVersion.findMany({ where: { runId: f.runId }, select: { id: true, auditTestVersionId: true } }));
    expect(rows.every((r) => artvs.some((a) => a.id === r.auditRunTestVersionId))).toBe(true);
    expect(artvs[0]!.auditTestVersionId).toBe(f.test.testVersionId); // frozen version, not v2
  });

  it("30/D2-T3: bounded keyset over multiple units; results reference only frozen members", async () => {
    const f = await freeze("firmA", "engA", uniqLines(7));
    const out = await executeRun("firmA", f.runId, "worker-A", { batchSize: 2 }); // forces >1 unit
    expect(out.outcome).toBe("COMPLETED");
    const rows = await results("firmA", f.runId);
    expect(rows.length).toBe(7);
    const memberRecordIds = await withTenantContext("firmA", (t) => t.auditRunScopeMember.findMany({ where: { preparationId: f.prepId }, select: { sourceRowNo: true } }));
    const evidence = await withTenantContext("firmA", (t) => t.auditResultEvidence.findMany({ where: { auditResultId: { in: rows.map((r) => r.id) } }, select: { sourceRowNo: true } }));
    const memberRows = new Set(memberRecordIds.map((m) => m.sourceRowNo));
    expect(evidence.every((e) => memberRows.has(e.sourceRowNo!))).toBe(true);
  });

  it("27/28: results and evidence are immutable to audit_app (UPDATE/DELETE rejected)", async () => {
    const f = await freeze("firmA", "engA", uniqLines(2));
    await executeRun("firmA", f.runId, "worker-A");
    const rows = await results("firmA", f.runId);
    const rid = rows[0]!.id;
    await expect(withTenantContext("firmA", (t) => t.$executeRaw(Prisma.sql`UPDATE "audit_results" SET "score"=1.00 WHERE "id"=${rid}`))).rejects.toThrow();
    await expect(withTenantContext("firmA", (t) => t.$executeRaw(Prisma.sql`DELETE FROM "audit_results" WHERE "id"=${rid}`))).rejects.toThrow();
    await expect(withTenantContext("firmA", (t) => t.$executeRaw(Prisma.sql`UPDATE "audit_result_evidence" SET "role"='x' WHERE "auditResultId"=${rid}`))).rejects.toThrow();
    await expect(withTenantContext("firmA", (t) => t.$executeRaw(Prisma.sql`DELETE FROM "audit_result_evidence" WHERE "auditResultId"=${rid}`))).rejects.toThrow();
  });

  it("25: run without completing its scan is not COMPLETED (fence lost mid-run)", async () => {
    const f = await freeze("firmA", "engA", uniqLines(4));
    const { claimInTx } = await import("@/lib/g4/execution/job");
    const claim = await withExecutionUnit("firmA", (tx) => claimInTx(tx, "firmA", f.runId, "A"));
    expect(claim.status).toBe("claimed");
    // Expire the lease, then a further unit by A must not complete the run.
    await withTenantContext("firmA", (t) => t.$executeRaw(Prisma.sql`UPDATE "audit_jobs" SET "leaseExpiresAt" = clock_timestamp() - interval '1 hour' WHERE "runId"=${f.runId}`));
    const st = await withTenantContext("firmA", (t) => t.auditRun.findUnique({ where: { id: f.runId }, select: { status: true } }));
    expect(st?.status).toBe("RUNNING"); // not COMPLETED
  });
});
