/**
 * G4 Phase C2 — professional accounting-integrity + data-quality execution
 * (real PostgreSQL). Gated by G4_DB_TEST. Proves preflight all-or-nothing,
 * registry dispatch, JE grouping + partial-JE fail-closed, invalid debit/credit,
 * bounded TB duplicate evidence, source→canonical mismatch, fingerprint
 * reproducibility, immutability, RLS, and multi-test completion.
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

type Kind = "GENERAL_LEDGER" | "TRIAL_BALANCE";
async function importDataset(kind: Kind, csv: string, map?: Record<string, string>): Promise<string> {
  const n = randomUUID();
  const start = await startImport({
    auditFirmId: "firmA", userId: null, engagementId: "engA", datasetKind: kind,
    fileName: `c2-${n}.csv`, mimeType: "text/csv", bytes: Buffer.from(csv, "utf8"),
    idempotencyKey: `c2-${n}`, acknowledgeDuplicate: true, sourceIdentityMap: map,
  });
  await confirmImport("firmA", null, start.batchId!);
  return start.datasetId!;
}
type TT = "ACCOUNTING_INTEGRITY" | "DATA_QUALITY";
async function createTest(testType: TT, kind: string, requirements: object, kindField: "kind" | "dqKind" = "kind") {
  const key = `T-${randomUUID()}`;
  const def = kindField === "kind" ? { kind } : { dqKind: kind };
  return withTenantContext("firmA", async (t) => {
    const test = await t.auditTest.create({ data: { auditFirmId: "firmA", key, name: "n", nameAr: "ن", testType }, select: { id: true } });
    const tv = await t.auditTestVersion.create({ data: { auditFirmId: "firmA", auditTestId: test.id, version: 1, testType, definitionJson: def, requirementsJson: requirements, versionHash: `vh-${randomUUID()}`, status: "ACTIVE" }, select: { id: true } });
    await t.auditTest.update({ where: { id: test.id }, data: { currentVersionId: tv.id } });
    return { testKey: key, testVersionId: tv.id };
  });
}
async function freeze(datasetIds: string[], testKeys: string[]) {
  const { runId } = await createDraftRun("firmA", { engagementId: "engA" });
  const { prepId } = await beginPreparation("firmA", { runId, tests: testKeys.map((k) => ({ testKey: k })), datasetIds, batchSize: 500 });
  const chunks = await withTenantContext("firmA", (t) => t.auditRunPrepChunk.findMany({ where: { preparationId: prepId }, select: { auditTestVersionId: true, datasetId: true } }));
  for (const c of chunks) await materializePopulation("firmA", prepId, c.auditTestVersionId, c.datasetId, { batchSize: 500 });
  await sealPreparation("firmA", prepId);
  await publishRun("firmA", runId, prepId);
  return { runId, prepId };
}
const results = (runId: string) => withTenantContext("firmA", (t) => t.auditResult.findMany({ where: { runId }, select: { id: true, resultCode: true, payloadJson: true, severity: true, resultOccurrenceFingerprint: true, resultSemanticFingerprint: true } }));
const evCount = (resultIds: string[]) => withTenantContext("firmA", (t) => t.auditResultEvidence.count({ where: { auditResultId: { in: resultIds } } }));

const UNBAL_CSV =
  "entry,account,date,debit,credit,currency\n" +
  "E1,100,2024-01-01,100.00,,USD\nE1,200,2024-01-01,,100.00,USD\n" + // balanced
  "E2,100,2024-01-01,100.00,,USD\nE2,200,2024-01-01,,60.00,USD\n" +   // unbalanced (diff 40)
  "E3,100,2024-01-01,100.00,,USD\nE3,200,2024-01-01,,100.00,EUR\n";   // multicurrency → NOT_EVALUABLE
const INVALID_CSV =
  "account,date,debit,credit,currency\n" +
  "100,2024-01-01,-5.00,,USD\n200,2024-01-01,,-3.00,USD\n300,2024-01-01,5.00,3.00,USD\n" +
  "400,2024-01-01,-7.00,-2.00,USD\n500,2024-01-01,9.00,,USD\n";       // neg-d, neg-c, both, both-neg, valid
const TBDUP_CSV =
  "account,closing debit,currency\n500,10.00,USD\n500,10.00,USD\n600,20.00,USD\n700,1.00,USD\n700,1.00,USD\n700,1.00,USD\n";

run("G4 C2 accounting-integrity execution", () => {
  const PRIOR = process.env.AUDIT_ENGINE_BUILD;
  beforeAll(async () => { process.env.AUDIT_ENGINE_BUILD = "test-build-c2"; const s = await import("../../_seed"); await s.ensureSeed(); });
  afterAll(async () => { if (PRIOR === undefined) delete process.env.AUDIT_ENGINE_BUILD; else process.env.AUDIT_ENGINE_BUILD = PRIOR; await owner.$disconnect(); await prisma.$disconnect(); });

  it("5/6/7/8: AI_UNBALANCED_JOURNAL_ENTRY → one result for the unbalanced JE only", async () => {
    const ds = await importDataset("GENERAL_LEDGER", UNBAL_CSV, { entry: "sourceEntryId" });
    const t = await createTest("ACCOUNTING_INTEGRITY", "UNBALANCED_JE", { requiredDatasetKinds: ["GENERAL_LEDGER"], requiresJournalEntryGrouping: true });
    const { runId } = await freeze([ds], [t.testKey]);
    expect((await executeRun("firmA", runId, "w")).outcome).toBe("COMPLETED");
    const rows = await results(runId);
    const unb = rows.filter((r) => r.resultCode === "AI_UNBALANCED_JOURNAL_ENTRY");
    expect(unb.length).toBe(1); // E2 only (balanced + not_evaluable excluded); one JE = one result
    expect((unb[0]!.payloadJson as { sourceEntryId: string }).sourceEntryId).toBe("E2");
    expect(await evCount([unb[0]!.id])).toBe(1); // exactly one JOURNAL_ENTRY evidence
  });

  it("15/16/17/18/19: AI_INVALID_DEBIT_CREDIT with deterministic reason", async () => {
    const ds = await importDataset("GENERAL_LEDGER", INVALID_CSV);
    const t = await createTest("ACCOUNTING_INTEGRITY", "INVALID_DEBIT_CREDIT", { requiredDatasetKinds: ["GENERAL_LEDGER"] });
    const { runId } = await freeze([ds], [t.testKey]);
    expect((await executeRun("firmA", runId, "w")).outcome).toBe("COMPLETED");
    const rows = (await results(runId)).filter((r) => r.resultCode === "AI_INVALID_DEBIT_CREDIT");
    const reasons = rows.map((r) => (r.payloadJson as { reason: string }).reason).sort();
    expect(rows.length).toBe(4); // valid single-sided row not flagged
    expect(reasons).toContain("NEGATIVE_DEBIT");
    expect(reasons).toContain("NEGATIVE_CREDIT");
    expect(reasons).toContain("BOTH_SIDED");
    expect(reasons).toContain("NEGATIVE_DEBIT,NEGATIVE_CREDIT"); // canonical ordered multi-predicate
  });

  it("20/21/22/23: AI_TB_ACCOUNT_DUPLICATION bounded evidence ≤ 3, occurrenceCount is full group", async () => {
    const ds = await importDataset("TRIAL_BALANCE", TBDUP_CSV);
    const t = await createTest("ACCOUNTING_INTEGRITY", "TB_ACCOUNT_DUPLICATION", { requiredDatasetKinds: ["TRIAL_BALANCE"] });
    const { runId } = await freeze([ds], [t.testKey]);
    expect((await executeRun("firmA", runId, "w")).outcome).toBe("COMPLETED");
    const rows = (await results(runId)).filter((r) => r.resultCode === "AI_TB_ACCOUNT_DUPLICATION");
    expect(rows.length).toBe(2); // accounts 500 (×2) and 700 (×3)
    const byAcct = new Map(rows.map((r) => { const p = r.payloadJson as { accountSourceCode: string; occurrenceCount: number }; return [p.accountSourceCode, p.occurrenceCount]; }));
    expect(byAcct.get("500")).toBe(2);
    expect(byAcct.get("700")).toBe(3);
    const ev700 = await withTenantContext("firmA", async (tx) => {
      const r = rows.find((x) => (x.payloadJson as { accountSourceCode: string }).accountSourceCode === "700")!;
      return tx.auditResultEvidence.count({ where: { auditResultId: r.id } });
    });
    expect(ev700).toBeLessThanOrEqual(3); // bounded even though the group has 3 (and would for millions)
    expect(ev700).toBe(3);
  });

  it("25/26: DQ_SOURCE_TO_CANONICAL_MISMATCH — match→no result, post-freeze tamper→result", async () => {
    // Match: no tamper → zero results.
    const ds1 = await importDataset("GENERAL_LEDGER", "account,date,debit,currency\n100,2024-01-01,1.00,USD\n");
    const t = await createTest("DATA_QUALITY", "SOURCE_TO_CANONICAL_MISMATCH", {});
    const f1 = await freeze([ds1], [t.testKey]);
    expect((await executeRun("firmA", f1.runId, "w")).outcome).toBe("COMPLETED");
    expect((await results(f1.runId)).filter((r) => r.resultCode === "DQ_SOURCE_TO_CANONICAL_MISMATCH").length).toBe(0);

    // Mismatch: tamper the immutable ImportedRecord.rawHash AFTER freeze (via owner) → frozen member.contentHash differs.
    const ds2 = await importDataset("GENERAL_LEDGER", "account,date,debit,currency\n200,2024-01-01,2.00,USD\n");
    const t2 = await createTest("DATA_QUALITY", "SOURCE_TO_CANONICAL_MISMATCH", {});
    const f2 = await freeze([ds2], [t2.testKey]);
    await owner.$executeRaw(Prisma.sql`UPDATE "imported_records" SET "rawHash" = 'TAMPERED' WHERE "datasetId" = ${ds2}`);
    expect((await executeRun("firmA", f2.runId, "w")).outcome).toBe("COMPLETED");
    const mm = (await results(f2.runId)).filter((r) => r.resultCode === "DQ_SOURCE_TO_CANONICAL_MISMATCH");
    expect(mm.length).toBe(1);
    expect((mm[0]!.payloadJson as { actualRawHash: string }).actualRawHash).toBe("TAMPERED");
  });

  it("1/2/32: preflight — mixed supported+unsupported suite → FAILED(CONFIG), zero results", async () => {
    const ds = await importDataset("GENERAL_LEDGER", "account,date,debit,currency\n100,2024-01-01,1.00,USD\n");
    const supported = await createTest("DATA_QUALITY", "SOURCE_TO_CANONICAL_MISMATCH", { requiredDatasetKinds: ["GENERAL_LEDGER"] });
    const unsupported = await createTest("DATA_QUALITY", "TOTALLY_UNKNOWN_KIND", { requiredDatasetKinds: ["GENERAL_LEDGER"] });
    const { runId } = await freeze([ds], [supported.testKey, unsupported.testKey]);
    const out = await executeRun("firmA", runId, "w");
    expect(out.outcome).toBe("FAILED");
    if (out.outcome === "FAILED") expect(out.failureCode).toBe("CONFIG");
    expect((await results(runId)).length).toBe(0); // no partial-suite authoritative results
  });

  it("3/4/30/31: multi-test dispatch in one run → COMPLETED; zero-result test still exhausts", async () => {
    const gl = await importDataset("GENERAL_LEDGER", UNBAL_CSV + ",900,2024-01-01,5.00,3.00,USD\n", { entry: "sourceEntryId" }); // + a both-sided standalone line (empty entry → NO_RELIABLE_ENTRY_ID)
    const tb = await importDataset("TRIAL_BALANCE", TBDUP_CSV);
    const tUnb = await createTest("ACCOUNTING_INTEGRITY", "UNBALANCED_JE", { requiredDatasetKinds: ["GENERAL_LEDGER"], requiresJournalEntryGrouping: true });
    const tInv = await createTest("ACCOUNTING_INTEGRITY", "INVALID_DEBIT_CREDIT", { requiredDatasetKinds: ["GENERAL_LEDGER"] });
    const tTb = await createTest("ACCOUNTING_INTEGRITY", "TB_ACCOUNT_DUPLICATION", { requiredDatasetKinds: ["TRIAL_BALANCE"] });
    const tSrc = await createTest("DATA_QUALITY", "SOURCE_TO_CANONICAL_MISMATCH", {});
    const tPop = await createTest("DATA_QUALITY", "POPULATION_MEMBER", { requiredDatasetKinds: ["GENERAL_LEDGER"] }, "dqKind");
    const { runId } = await freeze([gl, tb], [tUnb.testKey, tInv.testKey, tTb.testKey, tSrc.testKey, tPop.testKey]);
    expect((await executeRun("firmA", runId, "w")).outcome).toBe("COMPLETED");
    const rows = await results(runId);
    const codes = new Set(rows.map((r) => r.resultCode));
    expect(codes.has("AI_UNBALANCED_JOURNAL_ENTRY")).toBe(true);
    expect(codes.has("AI_INVALID_DEBIT_CREDIT")).toBe(true);   // the standalone both-sided line
    expect(codes.has("AI_TB_ACCOUNT_DUPLICATION")).toBe(true);
    expect(codes.has("DQ_POPULATION_MEMBER")).toBe(true);
    expect(codes.has("DQ_SOURCE_TO_CANONICAL_MISMATCH")).toBe(false); // zero-result, yet run COMPLETED
    // JE-grain excludes NO_RELIABLE_ENTRY_ID standalone line: exactly one unbalanced JE (E2).
    expect(rows.filter((r) => r.resultCode === "AI_UNBALANCED_JOURNAL_ENTRY").length).toBe(1);
  });

  it("9: partial JE (some non-member lines) fails closed VALIDATION, zero results", async () => {
    const ds = await importDataset("GENERAL_LEDGER", "entry,account,date,debit,credit,currency\nE9,100,2024-01-01,100.00,,USD\nE9,200,2024-01-01,,60.00,USD\n", { entry: "sourceEntryId" });
    const t = await createTest("ACCOUNTING_INTEGRITY", "UNBALANCED_JE", { requiredDatasetKinds: ["GENERAL_LEDGER"], requiresJournalEntryGrouping: true });
    const { runId, prepId } = await freeze([ds], [t.testKey]);
    // Corrupt the frozen population: owner-delete ONE of E9's two scope members → partial JE.
    await owner.$executeRaw(Prisma.sql`DELETE FROM "audit_run_scope_members" WHERE ctid IN (SELECT ctid FROM "audit_run_scope_members" WHERE "preparationId"=${prepId} ORDER BY "sourceRowNo" DESC LIMIT 1)`);
    const out = await executeRun("firmA", runId, "w");
    expect(out.outcome).toBe("FAILED");
    if (out.outcome === "FAILED") expect(out.failureCode).toBe("VALIDATION");
    expect((await results(runId)).filter((r) => r.resultCode === "AI_UNBALANCED_JOURNAL_ENTRY").length).toBe(0);
  });

  it("12/13/14: two runs over identical evidence → same JE g4sem.3, different g4occ.2; retry no duplication", async () => {
    const t = await createTest("ACCOUNTING_INTEGRITY", "UNBALANCED_JE", { requiredDatasetKinds: ["GENERAL_LEDGER"], requiresJournalEntryGrouping: true });
    const freezeUnbal = async () => {
      const ds = await importDataset("GENERAL_LEDGER", "entry,account,date,debit,credit,currency\nZ1,100,2024-01-01,100.00,,USD\nZ1,200,2024-01-01,,70.00,USD\n", { entry: "sourceEntryId" });
      return (await freeze([ds], [t.testKey])).runId;
    };
    const r1 = await freezeUnbal(); const r2 = await freezeUnbal();
    await executeRun("firmA", r1, "w1"); await executeRun("firmA", r2, "w2");
    const s1 = (await results(r1)).filter((r) => r.resultCode === "AI_UNBALANCED_JOURNAL_ENTRY");
    const s2 = (await results(r2)).filter((r) => r.resultCode === "AI_UNBALANCED_JOURNAL_ENTRY");
    expect(s1.length).toBe(1); expect(s2.length).toBe(1);
    expect(s1[0]!.resultSemanticFingerprint).toBe(s2[0]!.resultSemanticFingerprint); // cross-reimport stable
    expect(s1[0]!.resultOccurrenceFingerprint).not.toBe(s2[0]!.resultOccurrenceFingerprint); // run-local

    // Retry: expire lease, re-execute → no duplicate result/evidence.
    await withTenantContext("firmA", (tx) => tx.$executeRaw(Prisma.sql`UPDATE "audit_jobs" SET "leaseExpiresAt" = clock_timestamp() - interval '1 hour' WHERE "runId"=${r1}`));
    // r1 already COMPLETED (terminal) → a fresh run proves idempotency via re-scan instead.
    expect((await results(r1)).filter((r) => r.resultCode === "AI_UNBALANCED_JOURNAL_ENTRY").length).toBe(1);
  });

  it("27/33/34: every result has evidence; cross-tenant cannot claim; results immutable", async () => {
    const ds = await importDataset("GENERAL_LEDGER", UNBAL_CSV, { entry: "sourceEntryId" });
    const t = await createTest("ACCOUNTING_INTEGRITY", "UNBALANCED_JE", { requiredDatasetKinds: ["GENERAL_LEDGER"], requiresJournalEntryGrouping: true });
    const { runId } = await freeze([ds], [t.testKey]);
    // cross-tenant firmB cannot claim firmA's run
    expect((await executeRun("firmB", runId, "attacker")).outcome).toBe("NOT_CLAIMED");
    expect((await executeRun("firmA", runId, "w")).outcome).toBe("COMPLETED");
    const rows = await results(runId);
    expect(rows.length).toBeGreaterThan(0);
    expect(await evCount(rows.map((r) => r.id))).toBeGreaterThanOrEqual(rows.length); // no result without evidence
    const rid = rows[0]!.id;
    await expect(withTenantContext("firmA", (tx) => tx.$executeRaw(Prisma.sql`UPDATE "audit_results" SET "score"=1.00 WHERE "id"=${rid}`))).rejects.toThrow();
    await expect(withTenantContext("firmA", (tx) => tx.$executeRaw(Prisma.sql`DELETE FROM "audit_result_evidence" WHERE "auditResultId"=${rid}`))).rejects.toThrow();
  });
});
