/**
 * G4 Phase C1 — C1-V2: REAL concurrent PostgreSQL timeout / takeover.
 *
 * Worker A enters the real fenced execution-unit transaction, acquires the
 * production run/job locks, performs an uncommitted result+evidence write, then
 * exceeds the DB statement_timeout while still holding those locks. Concurrently
 * (real separate pooled connections, no mocks) Worker B runs the legitimate
 * claim/takeover path. Gated by G4_DB_TEST.
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
import { claimInTx, heartbeat, fenceOrThrow } from "@/lib/g4/execution/job";
import { withExecutionUnit } from "@/lib/g4/execution/unit-tx";
import { ensureSeed } from "../_seed";

const run = process.env.G4_DB_TEST ? describe : describe.skip;
type TT = "DATA_QUALITY";
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function freeze(n: number) {
  const key = randomUUID();
  const csv = "account,date,debit,currency\n" + Array.from({ length: n }, (_, i) => `10${i},2024-01-01,${i + 1}.00,USD`).join("\n") + "\n";
  const start = await startImport({ auditFirmId: "firmA", userId: null, engagementId: "engA", datasetKind: "GENERAL_LEDGER", fileName: `v2-${key}.csv`, mimeType: "text/csv", bytes: Buffer.from(csv, "utf8"), idempotencyKey: `v2-${key}`, acknowledgeDuplicate: true });
  await confirmImport("firmA", null, start.batchId!);
  const ds = start.datasetId!;
  const testKey = `T-${randomUUID()}`;
  const tvId = await withTenantContext("firmA", async (t) => {
    const test = await t.auditTest.create({ data: { auditFirmId: "firmA", key: testKey, name: "n", nameAr: "ن", testType: "DATA_QUALITY" as TT }, select: { id: true } });
    const tv = await t.auditTestVersion.create({ data: { auditFirmId: "firmA", auditTestId: test.id, version: 1, testType: "DATA_QUALITY" as TT, definitionJson: { dqKind: "POPULATION_MEMBER" }, requirementsJson: { requiredDatasetKinds: ["GENERAL_LEDGER"] }, versionHash: `vh-${randomUUID()}`, status: "ACTIVE" }, select: { id: true } });
    await t.auditTest.update({ where: { id: test.id }, data: { currentVersionId: tv.id } });
    return tv.id;
  });
  const { runId } = await createDraftRun("firmA", { engagementId: "engA" });
  const { prepId } = await beginPreparation("firmA", { runId, tests: [{ testKey }], datasetIds: [ds], batchSize: 500 });
  await materializePopulation("firmA", prepId, tvId, ds, { batchSize: 500 });
  await sealPreparation("firmA", prepId);
  await publishRun("firmA", runId, prepId);
  const members = await withTenantContext("firmA", (t) => t.auditRunScopeMember.count({ where: { preparationId: prepId } }));
  return { ds, tvId, runId, prepId, members };
}

const countResults = (runId: string) => withTenantContext("firmA", (t) => t.auditResult.count({ where: { runId } }));

run("G4 C1-V2 concurrent timeout takeover", () => {
  const PRIOR = process.env.AUDIT_ENGINE_BUILD;
  beforeAll(async () => { process.env.AUDIT_ENGINE_BUILD = "test-build-c1"; await ensureSeed(); });
  afterAll(async () => { if (PRIOR === undefined) delete process.env.AUDIT_ENGINE_BUILD; else process.env.AUDIT_ENGINE_BUILD = PRIOR; await prisma.$disconnect(); });

  it("V2: A stalls holding locks past statement_timeout; B cannot preempt; A aborts+rolls back; B takes over", async () => {
    const timeline: string[] = [];
    const f = await freeze(4);
    const ctx = await withExecutionUnit("firmA", (tx) => loadExecutionContext(tx, "firmA", f.runId));
    const artv = ctx.testPins[0]!.auditRunTestVersionId;
    const member = await withTenantContext("firmA", (t) => t.auditRunScopeMember.findFirst({ where: { preparationId: f.prepId }, select: { sourceRowNo: true, eoiFrameHash: true, datasetId: true } }));
    const ir = await withTenantContext("firmA", (t) => t.importedRecord.findFirst({ where: { datasetId: member!.datasetId, sourceRowNo: member!.sourceRowNo }, select: { id: true } }));

    // Worker A claims a valid lease (short committed tx).
    const claimA = await withExecutionUnit("firmA", (tx) => claimInTx(tx, "firmA", f.runId, "A"));
    expect(claimA.status).toBe("claimed");
    const jobA = claimA.status === "claimed" ? claimA.jobId : "";
    timeline.push(`A claimed job ${jobA}`);

    // Worker A enters the REAL fenced unit: acquires run/job locks, writes an
    // uncommitted result+evidence, then exceeds statement_timeout while holding them.
    const tmpRid = randomUUID();
    const pA = withExecutionUnit("firmA", async (tx) => {
      await fenceOrThrow(tx, f.runId, jobA, "A"); // run FOR SHARE + job FOR UPDATE (held to end)
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "audit_results" ("id","auditFirmId","runId","auditRunTestVersionId","resultKind","resultCode","severity","score","payloadJson","resultOccurrenceFingerprint","resultSemanticFingerprint","createdAt")
        VALUES (${tmpRid}, 'firmA', ${f.runId}, ${artv}, 'DATA_QUALITY', 'A_TMP', 'LOW'::"AnomalySeverity", 0.00, '{}'::jsonb, ${"occ-A-" + tmpRid}, ${"sem-A-" + tmpRid}, clock_timestamp())`);
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "audit_result_evidence" ("id","auditFirmId","auditResultId","evidenceType","importedRecordId","sourceRowNo","eoiFrameHash")
        VALUES (${randomUUID()}, 'firmA', ${tmpRid}, 'IMPORTED_RECORD'::"AuditEvidenceType", ${ir!.id}, ${member!.sourceRowNo}, ${member!.eoiFrameHash})`);
      await tx.$executeRawUnsafe("SELECT pg_sleep(9)"); // > statement_timeout (8s) → statement aborted → tx rolls back
    });

    // Let A actually acquire and hold the locks.
    await delay(2000);
    timeline.push("A holding run FOR SHARE + job FOR UPDATE, sleeping");

    // (1) While A is inside the tx, B's legitimate claim cannot become authoritative.
    const bDuringA = await withExecutionUnit("firmA", (tx) => claimInTx(tx, "firmA", f.runId, "B"));
    expect(bDuringA.status).not.toBe("claimed");
    expect(["locked", "owned"]).toContain(bDuringA.status);
    timeline.push(`B during A → ${bDuringA.status} (not authoritative)`);
    expect(await countResults(f.runId)).toBe(0); // nothing authoritative yet

    // (2) PostgreSQL statement_timeout aborts A.
    await expect(pA).rejects.toThrow();
    timeline.push("A aborted by statement_timeout");

    // (3) A's uncommitted result+evidence rolled back; (9) no partial/duplicate A rows.
    const strayR = await withTenantContext("firmA", (t) => t.auditResult.count({ where: { runId: f.runId, resultCode: "A_TMP" } }));
    const strayE = await withTenantContext("firmA", (t) => t.auditResultEvidence.count({ where: { auditResultId: tmpRid } }));
    expect(strayR).toBe(0);
    expect(strayE).toBe(0);
    timeline.push("A result+evidence rolled back (0 stray)");

    // (4) A's locks released — proven because B can now claim. Accelerate A's stall to
    // an expired lease so the legitimate takeover path fires (6).
    await withTenantContext("firmA", (t) => t.$executeRaw(Prisma.sql`UPDATE "audit_jobs" SET "leaseExpiresAt" = clock_timestamp() - interval '1 hour' WHERE "id"=${jobA}`));

    // (5)(7)(10) B proceeds through the normal takeover and completes.
    const outB = await executeRun("firmA", f.runId, "B");
    expect(outB.outcome).toBe("COMPLETED");
    timeline.push("B took over and COMPLETED");

    // (6) A attempt FAILED/LEASE_LOST; B attempt SUCCEEDED.
    const jobs = await withTenantContext("firmA", (t) => t.auditJob.findMany({ where: { runId: f.runId }, orderBy: { attemptNo: "asc" }, select: { attemptNo: true, status: true, failureCode: true, leaseOwner: true } }));
    expect(jobs.length).toBe(2);
    expect(jobs[0]!.status).toBe("FAILED");
    expect(jobs[0]!.failureCode).toBe("LEASE_LOST");
    expect(jobs[1]!.status).toBe("SUCCEEDED");

    // (8) stale A cannot heartbeat / write / complete afterward.
    await expect(heartbeat("firmA", f.runId, jobA, "A")).rejects.toThrow();
    await expect(runResultUnit("firmA", ctx, ctx.testPins[0]!, jobA, "A", null, 2)).rejects.toThrow();

    // (9)(10) exactly one result per member; no duplicates; run COMPLETED.
    const finalCount = await countResults(f.runId);
    expect(finalCount).toBe(f.members);
    const st = await withTenantContext("firmA", (t) => t.auditRun.findUnique({ where: { id: f.runId }, select: { status: true } }));
    expect(st?.status).toBe("COMPLETED");

    console.log("C1-V2-TIMELINE " + JSON.stringify({ timeline, jobs, finalCount, members: f.members, bDuringA: bDuringA.status }));
  }, 40000);
});
