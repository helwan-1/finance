/**
 * G4 Phase C3 — statistical execution (real PostgreSQL). Gated by G4_DB_TEST.
 * Proves the two locked tests (ST_ROUND_NUMBER_FREQUENCY, ST_DUPLICATE_AMOUNT_
 * FREQUENCY): single-sided scalar eligibility, exact-string COLLATE "C" currency
 * partition (SAR≠sar, arbitrary Unicode), exact NUMERIC round/duplicate math,
 * frozen-member anchoring, scope-aware PK-free identity, bounded LATERAL evidence,
 * completion/idempotency, preflight-before-writes, RLS and immutability.
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
import { fetchRoundNumberSignalPage } from "@/lib/g4/execution/population";

const run = process.env.G4_DB_TEST ? describe : describe.skip;
const owner = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_DATABASE_URL } } });

async function importDataset(csv: string): Promise<string> {
  const n = randomUUID();
  const start = await startImport({
    auditFirmId: "firmA", userId: null, engagementId: "engA", datasetKind: "GENERAL_LEDGER",
    fileName: `c3-${n}.csv`, mimeType: "text/csv", bytes: Buffer.from(csv, "utf8"),
    idempotencyKey: `c3-${n}`, acknowledgeDuplicate: true,
  });
  await confirmImport("firmA", null, start.batchId!);
  return start.datasetId!;
}

async function createTest(kind: string): Promise<string> {
  const key = `T-${randomUUID()}`;
  return withTenantContext("firmA", async (t) => {
    const test = await t.auditTest.create({ data: { auditFirmId: "firmA", key, name: "n", nameAr: "ن", testType: "STATISTICAL" }, select: { id: true } });
    const tv = await t.auditTestVersion.create({ data: { auditFirmId: "firmA", auditTestId: test.id, version: 1, testType: "STATISTICAL", definitionJson: { kind }, requirementsJson: { requiredDatasetKinds: ["GENERAL_LEDGER"] }, versionHash: `vh-${randomUUID()}`, status: "ACTIVE" }, select: { id: true } });
    await t.auditTest.update({ where: { id: test.id }, data: { currentVersionId: tv.id } });
    return key;
  });
}

interface Sel { testKey: string; parameters: Record<string, unknown> }
async function freeze(datasetIds: string[], tests: Sel[]) {
  const { runId } = await createDraftRun("firmA", { engagementId: "engA" });
  const { prepId } = await beginPreparation("firmA", { runId, tests, datasetIds, batchSize: 500 });
  const chunks = await withTenantContext("firmA", (t) => t.auditRunPrepChunk.findMany({ where: { preparationId: prepId }, select: { auditTestVersionId: true, datasetId: true } }));
  for (const c of chunks) await materializePopulation("firmA", prepId, c.auditTestVersionId, c.datasetId, { batchSize: 500 });
  await sealPreparation("firmA", prepId);
  await publishRun("firmA", runId, prepId);
  return { runId, prepId };
}
const results = (runId: string) => withTenantContext("firmA", (t) => t.auditResult.findMany({ where: { runId }, select: { id: true, resultKind: true, resultCode: true, severity: true, payloadJson: true, resultOccurrenceFingerprint: true, resultSemanticFingerprint: true } }));
const evCount = (resultId: string) => withTenantContext("firmA", (t) => t.auditResultEvidence.count({ where: { auditResultId: resultId } }));

const ROUND = (o: Partial<Record<string, unknown>> = {}) => ({ amountBasis: "TRANSACTION", methodVersion: "st.round.1", roundingQuantum: "100.000000", minimumPopulation: 4, minimumRoundCount: 1, rateThresholdNum: 1, rateThresholdDenom: 2, ...o });
const DUP = (o: Partial<Record<string, unknown>> = {}) => ({ amountBasis: "TRANSACTION", methodVersion: "st.dupamt.1", minimumOccurrenceCount: 3, ...o });

// account,date,debit,credit,currency
const HDR = "account,date,debit,credit,currency\n";

run("G4 C3 statistical execution", () => {
  const PRIOR = process.env.AUDIT_ENGINE_BUILD;
  beforeAll(async () => { process.env.AUDIT_ENGINE_BUILD = "test-build-c3"; const s = await import("../../_seed"); await s.ensureSeed(); });
  afterAll(async () => { if (PRIOR === undefined) delete process.env.AUDIT_ENGINE_BUILD; else process.env.AUDIT_ENGINE_BUILD = PRIOR; await owner.$disconnect(); await prisma.$disconnect(); });

  it("ROUND 1-5/22/23: scalar eligibility + signal + bounded round evidence", async () => {
    const csv = HDR +
      "100,2024-01-01,100.00,,USD\n" +   // debit-only 100 → round
      "200,2024-01-01,200.00,,USD\n" +   // debit-only 200 → round
      "300,2024-01-01,,300.00,USD\n" +   // credit-only 300 → round
      "400,2024-01-01,150.00,,USD\n" +   // debit-only 150 → NOT round
      "500,2024-01-01,5.00,3.00,USD\n" + // both-sided → EXCLUDED
      "600,2024-01-01,-100.00,,USD\n" +  // negative debit → EXCLUDED
      "700,2024-01-01,0.00,,USD\n";      // zero → EXCLUDED
    const ds = await importDataset(csv);
    const t = await createTest("ROUND_NUMBER_FREQUENCY");
    const { runId } = await freeze([ds], [{ testKey: t, parameters: ROUND() }]);
    expect((await executeRun("firmA", runId, "w")).outcome).toBe("COMPLETED");
    const rows = (await results(runId)).filter((r) => r.resultCode === "ST_ROUND_NUMBER_RATE_EXCEEDED");
    expect(rows.length).toBe(1);
    const p = rows[0]!.payloadJson as { populationSize: number; roundCount: number; currency: string; roundingQuantum: string };
    expect(p.populationSize).toBe(4);       // both-sided/negative/zero excluded; one scalar per line
    expect(p.roundCount).toBe(3);           // 100,200,300 round; 150 not
    expect(p.currency).toBe("USD");
    expect(p.roundingQuantum).toBe("100.000000");
    expect(rows[0]!.resultKind).toBe("STATISTICAL");
    expect(await evCount(rows[0]!.id)).toBe(3); // ≤ K=3 (three round lines)
  });

  it("ROUND 9: quantum exactness at 6dp (100.000001 is NOT round for quantum 100)", async () => {
    const csv = HDR +
      "1,2024-01-01,100.000000,,USD\n2,2024-01-01,200.000000,,USD\n3,2024-01-01,300.000000,,USD\n" +
      "4,2024-01-01,100.000001,,USD\n"; // off by one micro → not round
    const ds = await importDataset(csv);
    const t = await createTest("ROUND_NUMBER_FREQUENCY");
    const { runId } = await freeze([ds], [{ testKey: t, parameters: ROUND({ minimumPopulation: 4 }) }]);
    expect((await executeRun("firmA", runId, "w")).outcome).toBe("COMPLETED");
    const p = (await results(runId)).find((r) => r.resultCode === "ST_ROUND_NUMBER_RATE_EXCEEDED")!.payloadJson as { populationSize: number; roundCount: number };
    expect(p.populationSize).toBe(4);
    expect(p.roundCount).toBe(3); // the 100.000001 line is excluded from round count
  });

  it("ROUND 10/11/12/24: below population / round-count / rate → no signal, run COMPLETED", async () => {
    const csv = HDR + "1,2024-01-01,100.00,,USD\n2,2024-01-01,150.00,,USD\n3,2024-01-01,170.00,,USD\n4,2024-01-01,190.00,,USD\n"; // 1 round of 4
    const ds = await importDataset(csv);
    const zero = async (params: Record<string, unknown>) => {
      const t = await createTest("ROUND_NUMBER_FREQUENCY");
      const { runId } = await freeze([ds], [{ testKey: t, parameters: params }]);
      expect((await executeRun("firmA", runId, "w")).outcome).toBe("COMPLETED");
      return (await results(runId)).filter((r) => r.resultCode === "ST_ROUND_NUMBER_RATE_EXCEEDED").length;
    };
    expect(await zero(ROUND({ minimumPopulation: 10 }))).toBe(0);           // below population
    expect(await zero(ROUND({ minimumRoundCount: 2 }))).toBe(0);            // 1 round < 2
    expect(await zero(ROUND({ rateThresholdNum: 9, rateThresholdDenom: 10 }))).toBe(0); // 1/4=25% < 90%
  });

  it("ROUND 13/14: fires at exact rate boundary (>=) and above", async () => {
    // 2 round of 4 = 50%. threshold 1/2 → 2*2=4 >= 1*4=4 → boundary fires.
    const csv = HDR + "1,2024-01-01,100.00,,USD\n2,2024-01-01,200.00,,USD\n3,2024-01-01,150.00,,USD\n4,2024-01-01,170.00,,USD\n";
    const ds = await importDataset(csv);
    const t = await createTest("ROUND_NUMBER_FREQUENCY");
    const { runId } = await freeze([ds], [{ testKey: t, parameters: ROUND({ minimumPopulation: 4, rateThresholdNum: 1, rateThresholdDenom: 2 }) }]);
    expect((await executeRun("firmA", runId, "w")).outcome).toBe("COMPLETED");
    expect((await results(runId)).filter((r) => r.resultCode === "ST_ROUND_NUMBER_RATE_EXCEEDED").length).toBe(1);
  });

  it("ROUND 6: NULL transactionCurrency excluded (no currency column) → no signal, COMPLETED", async () => {
    const ds = await importDataset("account,date,debit\n1,2024-01-01,100.00\n2,2024-01-01,200.00\n3,2024-01-01,300.00\n4,2024-01-01,400.00\n");
    const t = await createTest("ROUND_NUMBER_FREQUENCY");
    const { runId } = await freeze([ds], [{ testKey: t, parameters: ROUND({ minimumPopulation: 1, rateThresholdNum: 0, rateThresholdDenom: 1 }) }]);
    expect((await executeRun("firmA", runId, "w")).outcome).toBe("COMPLETED");
    expect((await results(runId)).filter((r) => r.resultCode === "ST_ROUND_NUMBER_RATE_EXCEEDED").length).toBe(0);
  });

  it("ROUND 7/8/30/31/52: SAR≠sar and arbitrary Unicode are distinct exact-string populations (COLLATE C)", async () => {
    const cur = ["SAR", "sar", "€u🌍"];
    let csv = HDR;
    let acc = 0;
    for (const c of cur) for (const amt of ["100.00", "200.00", "300.00", "400.00"]) csv += `${++acc},2024-01-01,${amt},,${c}\n`;
    const ds = await importDataset(csv);
    const t = await createTest("ROUND_NUMBER_FREQUENCY");
    const { runId } = await freeze([ds], [{ testKey: t, parameters: ROUND({ minimumPopulation: 4, rateThresholdNum: 1, rateThresholdDenom: 1 }) }]);
    expect((await executeRun("firmA", runId, "w")).outcome).toBe("COMPLETED");
    const rows = (await results(runId)).filter((r) => r.resultCode === "ST_ROUND_NUMBER_RATE_EXCEEDED");
    const currencies = rows.map((r) => (r.payloadJson as { currency: string }).currency).sort();
    expect(currencies).toEqual(["SAR", "sar", "€u🌍"].sort()); // three separate populations
    expect(new Set(rows.map((r) => r.resultSemanticFingerprint)).size).toBe(3); // distinct scope-aware identities
  });

  it("ROUND 21/34: aggregate uses ONLY frozen members (owner-deleted member drops from population)", async () => {
    const csv = HDR + "1,2024-01-01,100.00,,USD\n2,2024-01-01,200.00,,USD\n3,2024-01-01,300.00,,USD\n4,2024-01-01,400.00,,USD\n";
    const ds = await importDataset(csv);
    const t = await createTest("ROUND_NUMBER_FREQUENCY");
    const { runId, prepId } = await freeze([ds], [{ testKey: t, parameters: ROUND({ minimumPopulation: 1, rateThresholdNum: 1, rateThresholdDenom: 1 }) }]);
    // Remove ONE frozen member (sourceRowNo max) → population = 3, not the 4 dataset lines.
    await owner.$executeRaw(Prisma.sql`DELETE FROM "audit_run_scope_members" WHERE ctid IN (SELECT ctid FROM "audit_run_scope_members" WHERE "preparationId"=${prepId} ORDER BY "sourceRowNo" DESC LIMIT 1)`);
    expect((await executeRun("firmA", runId, "w")).outcome).toBe("COMPLETED");
    const p = (await results(runId)).find((r) => r.resultCode === "ST_ROUND_NUMBER_RATE_EXCEEDED")!.payloadJson as { populationSize: number };
    expect(p.populationSize).toBe(3); // frozen-member anchored, not all dataset rows
  });

  it("ROUND 49: cross-reimport → same g4sem.3, different g4occ.2", async () => {
    const csv = HDR + "1,2024-01-01,100.00,,USD\n2,2024-01-01,200.00,,USD\n3,2024-01-01,300.00,,USD\n4,2024-01-01,400.00,,USD\n";
    const t = await createTest("ROUND_NUMBER_FREQUENCY"); // one frozen test version, re-used across two re-imports
    const mk = async () => {
      const ds = await importDataset(csv); // identical content → same datasetHash → same eligiblePopulationFingerprint
      const { runId } = await freeze([ds], [{ testKey: t, parameters: ROUND({ minimumPopulation: 4, rateThresholdNum: 1, rateThresholdDenom: 1 }) }]);
      await executeRun("firmA", runId, "w");
      return (await results(runId)).find((r) => r.resultCode === "ST_ROUND_NUMBER_RATE_EXCEEDED")!;
    };
    const a = await mk(); const b = await mk();
    expect(a.resultSemanticFingerprint).toBe(b.resultSemanticFingerprint); // reproducible scope+content
    expect(a.resultOccurrenceFingerprint).not.toBe(b.resultOccurrenceFingerprint); // run-local
  });

  it("ROUND 50/51: different frozen scope AND different config → different g4sem.3", async () => {
    const csvA = HDR + "1,2024-01-01,100.00,,USD\n2,2024-01-01,200.00,,USD\n3,2024-01-01,300.00,,USD\n";
    const csvB = HDR + "1,2024-01-01,100.00,,USD\n2,2024-01-01,200.00,,USD\n3,2024-01-01,300.00,,USD\n4,2024-01-01,400.00,,USD\n"; // different content → different scope
    const t = await createTest("ROUND_NUMBER_FREQUENCY"); // shared test version: isolates scope (#50) and config (#51) as the only variables
    const sig = async (csv: string, quantum: string) => {
      const ds = await importDataset(csv);
      const { runId } = await freeze([ds], [{ testKey: t, parameters: ROUND({ roundingQuantum: quantum, minimumPopulation: 1, rateThresholdNum: 1, rateThresholdDenom: 1 }) }]);
      await executeRun("firmA", runId, "w");
      return (await results(runId)).find((r) => r.resultCode === "ST_ROUND_NUMBER_RATE_EXCEEDED")!.resultSemanticFingerprint;
    };
    const scopeA = await sig(csvA, "100.000000");
    const scopeB = await sig(csvB, "100.000000");
    expect(scopeA).not.toBe(scopeB); // #50 different frozen scope
    const cfg1 = await sig(csvA, "100.000000");
    const cfg2 = await sig(csvA, "50.000000");
    expect(cfg1).not.toBe(cfg2);     // #51 different authoritative config
  });

  it("ROUND 54/55: bounded LATERAL page — keyset paginates groups, evidence ≤ pageSize×K, no OFFSET", async () => {
    // 3 currencies each firing; batchSize=2 forces two pages, K=3.
    const cur = ["AAA", "BBB", "CCC"];
    let csv = HDR; let acc = 0;
    for (const c of cur) for (const amt of ["100.00", "200.00", "300.00", "400.00"]) csv += `${++acc},2024-01-01,${amt},,${c}\n`;
    const ds = await importDataset(csv);
    const t = await createTest("ROUND_NUMBER_FREQUENCY");
    const { runId, prepId } = await freeze([ds], [{ testKey: t, parameters: ROUND({ minimumPopulation: 4, rateThresholdNum: 1, rateThresholdDenom: 1 }) }]);
    const tvId = await withTenantContext("firmA", async (tx) => (await tx.auditRunTestVersion.findFirst({ where: { preparationId: prepId }, select: { auditTestVersionId: true } }))!.auditTestVersionId);
    const page1 = await withTenantContext("firmA", (tx) => fetchRoundNumberSignalPage(tx, prepId, tvId, [ds], "100.000000", 4, 1, 1, 1, null, 2, 3));
    const g1 = new Set(page1.map((r) => r.currency));
    expect(g1.size).toBe(2);                    // one page = batchSize groups
    expect(page1.length).toBeLessThanOrEqual(2 * 3); // ≤ pageSize×K rows materialized
    const last = [...page1].pop()!;
    const page2 = await withTenantContext("firmA", (tx) => fetchRoundNumberSignalPage(tx, prepId, tvId, [ds], "100.000000", 4, 1, 1, 1, { datasetId: last.datasetId, currency: last.currency }, 2, 3));
    const g2 = new Set(page2.map((r) => r.currency));
    expect(g2.size).toBe(1);                    // remaining group
    expect([...g1, ...g2].sort()).toEqual(["AAA", "BBB", "CCC"]); // deterministic COLLATE "C" keyset order, no overlap
  });

  it("DUP 25/26/27/28/40: T-1 no signal, T and T+1 fire; no minimumPopulation gate; occurrenceCount full", async () => {
    const csv = HDR +
      "1,2024-01-01,,10.00,USD\n2,2024-01-01,,10.00,USD\n" +               // amount 10 ×2 (T-1)
      "3,2024-01-01,,20.00,USD\n4,2024-01-01,,20.00,USD\n5,2024-01-01,,20.00,USD\n" + // 20 ×3 (==T)
      "6,2024-01-01,,30.00,USD\n7,2024-01-01,,30.00,USD\n8,2024-01-01,,30.00,USD\n9,2024-01-01,,30.00,USD\n"; // 30 ×4 (>T)
    const ds = await importDataset(csv);
    const t = await createTest("DUPLICATE_AMOUNT_FREQUENCY");
    const { runId } = await freeze([ds], [{ testKey: t, parameters: DUP({ minimumOccurrenceCount: 3 }) }]);
    expect((await executeRun("firmA", runId, "w")).outcome).toBe("COMPLETED");
    const rows = (await results(runId)).filter((r) => r.resultCode === "ST_DUPLICATE_AMOUNT_DETECTED");
    const byAmt = new Map(rows.map((r) => { const p = r.payloadJson as { scalarAmount: string; occurrenceCount: number }; return [p.scalarAmount, p.occurrenceCount]; }));
    expect(byAmt.has("10.000000")).toBe(false); // below T
    expect(byAmt.get("20.000000")).toBe(3);     // == T
    expect(byAmt.get("30.000000")).toBe(4);     // > T
    expect(rows.length).toBe(2);
  });

  it("DUP 28: tiny population (2 lines) still fires with minOccurrence=2 (no population gate)", async () => {
    const ds = await importDataset(HDR + "1,2024-01-01,,50.00,USD\n2,2024-01-01,,50.00,USD\n");
    const t = await createTest("DUPLICATE_AMOUNT_FREQUENCY");
    const { runId } = await freeze([ds], [{ testKey: t, parameters: DUP({ minimumOccurrenceCount: 2 }) }]);
    expect((await executeRun("firmA", runId, "w")).outcome).toBe("COMPLETED");
    expect((await results(runId)).filter((r) => r.resultCode === "ST_DUPLICATE_AMOUNT_DETECTED").length).toBe(1);
  });

  it("DUP 29/30/31: same amount in different currencies (incl SAR≠sar, Unicode) are separate groups", async () => {
    const csv = HDR +
      "1,2024-01-01,,50.00,SAR\n2,2024-01-01,,50.00,SAR\n3,2024-01-01,,50.00,SAR\n" +
      "4,2024-01-01,,50.00,sar\n5,2024-01-01,,50.00,sar\n6,2024-01-01,,50.00,sar\n" +
      "7,2024-01-01,,50.00,€🌍\n8,2024-01-01,,50.00,€🌍\n9,2024-01-01,,50.00,€🌍\n";
    const ds = await importDataset(csv);
    const t = await createTest("DUPLICATE_AMOUNT_FREQUENCY");
    const { runId } = await freeze([ds], [{ testKey: t, parameters: DUP({ minimumOccurrenceCount: 3 }) }]);
    expect((await executeRun("firmA", runId, "w")).outcome).toBe("COMPLETED");
    const rows = (await results(runId)).filter((r) => r.resultCode === "ST_DUPLICATE_AMOUNT_DETECTED");
    expect(rows.length).toBe(3);
    expect(new Set(rows.map((r) => (r.payloadJson as { currency: string }).currency))).toEqual(new Set(["SAR", "sar", "€🌍"]));
  });

  it("DUP 32/33: exact NUMERIC scalar equality groups 50/50.00/50.000000; both-sided/negative/zero excluded", async () => {
    const csv = HDR +
      "1,2024-01-01,,50,USD\n2,2024-01-01,,50.00,USD\n3,2024-01-01,,50.000000,USD\n" + // one group of 3 (exact numeric equality)
      "4,2024-01-01,,50.000001,USD\n" +   // distinct scalar
      "5,2024-01-01,50.00,50.00,USD\n" +  // both-sided → excluded
      "6,2024-01-01,,-50.00,USD\n" +      // negative → excluded
      "7,2024-01-01,,0.00,USD\n";         // zero → excluded
    const ds = await importDataset(csv);
    const t = await createTest("DUPLICATE_AMOUNT_FREQUENCY");
    const { runId } = await freeze([ds], [{ testKey: t, parameters: DUP({ minimumOccurrenceCount: 3 }) }]);
    expect((await executeRun("firmA", runId, "w")).outcome).toBe("COMPLETED");
    const rows = (await results(runId)).filter((r) => r.resultCode === "ST_DUPLICATE_AMOUNT_DETECTED");
    expect(rows.length).toBe(1);
    const p = rows[0]!.payloadJson as { scalarAmount: string; occurrenceCount: number };
    expect(p.scalarAmount).toBe("50.000000");
    expect(p.occurrenceCount).toBe(3); // 50 / 50.00 / 50.000000 are the SAME scalar; excluded rows don't count
  });

  it("DUP 35/36/37: evidence ≤ 3, first-K by sourceRowNo, exact group membership", async () => {
    const ds = await importDataset(HDR + "1,2024-01-01,,70.00,USD\n2,2024-01-01,,70.00,USD\n3,2024-01-01,,70.00,USD\n4,2024-01-01,,70.00,USD\n5,2024-01-01,,70.00,USD\n");
    const t = await createTest("DUPLICATE_AMOUNT_FREQUENCY");
    const { runId } = await freeze([ds], [{ testKey: t, parameters: DUP({ minimumOccurrenceCount: 3 }) }]);
    expect((await executeRun("firmA", runId, "w")).outcome).toBe("COMPLETED");
    const r = (await results(runId)).find((x) => x.resultCode === "ST_DUPLICATE_AMOUNT_DETECTED")!;
    expect((r.payloadJson as { occurrenceCount: number }).occurrenceCount).toBe(5); // full count
    const ev = await withTenantContext("firmA", (tx) => tx.auditResultEvidence.findMany({ where: { auditResultId: r.id }, select: { sourceRowNo: true, evidenceType: true } }));
    expect(ev.length).toBe(3); // bounded
    expect(ev.every((e) => e.evidenceType === "JOURNAL_LINE")).toBe(true);
    expect(ev.map((e) => e.sourceRowNo).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([1, 2, 3]); // first-K by sourceRowNo
  });

  it("DUP 38/39/41: large duplicate group (>=1000) — occurrenceCount full, evidence bounded to 3 (no full-group materialization)", async () => {
    const N = 1200;
    let csv = HDR;
    for (let i = 1; i <= N; i++) csv += `${i},2024-01-01,,99.00,USD\n`;
    const ds = await importDataset(csv);
    const t = await createTest("DUPLICATE_AMOUNT_FREQUENCY");
    const { runId } = await freeze([ds], [{ testKey: t, parameters: DUP({ minimumOccurrenceCount: 3 }) }]);
    expect((await executeRun("firmA", runId, "w")).outcome).toBe("COMPLETED");
    const r = (await results(runId)).find((x) => x.resultCode === "ST_DUPLICATE_AMOUNT_DETECTED")!;
    expect((r.payloadJson as { occurrenceCount: number }).occurrenceCount).toBe(N); // full DB-side count
    expect(await evCount(r.id)).toBe(3); // only K rows cross into materialization
  }, 60_000);

  it("PREFLIGHT 42/43: mixed valid + invalid C3 config → FAILED(CONFIG), zero results", async () => {
    const ds = await importDataset(HDR + "1,2024-01-01,100.00,,USD\n");
    const good = await createTest("ROUND_NUMBER_FREQUENCY");
    const bad = await createTest("ROUND_NUMBER_FREQUENCY");
    const { runId } = await freeze([ds], [
      { testKey: good, parameters: ROUND({ minimumPopulation: 1, rateThresholdNum: 1, rateThresholdDenom: 1 }) },
      { testKey: bad, parameters: ROUND({ roundingQuantum: "0" }) }, // invalid → CONFIG
    ]);
    const out = await executeRun("firmA", runId, "w");
    expect(out.outcome).toBe("FAILED");
    if (out.outcome === "FAILED") expect(out.failureCode).toBe("CONFIG");
    expect((await results(runId)).length).toBe(0); // no partial-suite results before preflight completes
  });

  it("PREFLIGHT: unreduced rate fraction (20/100) fails CONFIG before any write", async () => {
    const ds = await importDataset(HDR + "1,2024-01-01,100.00,,USD\n");
    const t = await createTest("ROUND_NUMBER_FREQUENCY");
    const { runId } = await freeze([ds], [{ testKey: t, parameters: ROUND({ rateThresholdNum: 20, rateThresholdDenom: 100 }) }]);
    const out = await executeRun("firmA", runId, "w");
    expect(out.outcome).toBe("FAILED");
    if (out.outcome === "FAILED") expect(out.failureCode).toBe("CONFIG");
    expect((await results(runId)).length).toBe(0);
  });

  it("46/47/48: RLS cross-tenant cannot claim; results have evidence; results/evidence immutable", async () => {
    const ds = await importDataset(HDR + "1,2024-01-01,100.00,,USD\n2,2024-01-01,200.00,,USD\n3,2024-01-01,300.00,,USD\n4,2024-01-01,400.00,,USD\n");
    const t = await createTest("ROUND_NUMBER_FREQUENCY");
    const { runId } = await freeze([ds], [{ testKey: t, parameters: ROUND({ minimumPopulation: 4, rateThresholdNum: 1, rateThresholdDenom: 1 }) }]);
    expect((await executeRun("firmB", runId, "attacker")).outcome).toBe("NOT_CLAIMED"); // RLS: cross-tenant
    expect((await executeRun("firmA", runId, "w")).outcome).toBe("COMPLETED");
    const rows = (await results(runId)).filter((r) => r.resultCode === "ST_ROUND_NUMBER_RATE_EXCEEDED");
    expect(rows.length).toBe(1);
    expect(await evCount(rows[0]!.id)).toBeGreaterThan(0); // no result without evidence
    const rid = rows[0]!.id;
    await expect(withTenantContext("firmA", (tx) => tx.$executeRaw(Prisma.sql`UPDATE "audit_results" SET "score"=1.00 WHERE "id"=${rid}`))).rejects.toThrow();
    await expect(withTenantContext("firmA", (tx) => tx.$executeRaw(Prisma.sql`DELETE FROM "audit_result_evidence" WHERE "auditResultId"=${rid}`))).rejects.toThrow();
  });

  it("44: two tests in one run dispatch + a zero-signal test still reaches COMPLETED", async () => {
    const csv = HDR + "1,2024-01-01,,50.00,USD\n2,2024-01-01,,50.00,USD\n3,2024-01-01,,50.00,USD\n4,2024-01-01,150.00,,USD\n";
    const ds = await importDataset(csv);
    const tRound = await createTest("ROUND_NUMBER_FREQUENCY"); // 50,50,50 round(×3)+150 not → 3/4 round
    const tDup = await createTest("DUPLICATE_AMOUNT_FREQUENCY"); // 50 ×3
    const { runId } = await freeze([ds], [
      { testKey: tRound, parameters: ROUND({ minimumPopulation: 4, rateThresholdNum: 1, rateThresholdDenom: 1 }) }, // needs 100% round → 3/4 fails → zero
      { testKey: tDup, parameters: DUP({ minimumOccurrenceCount: 3 }) },
    ]);
    expect((await executeRun("firmA", runId, "w")).outcome).toBe("COMPLETED");
    const codes = new Set((await results(runId)).map((r) => r.resultCode));
    expect(codes.has("ST_DUPLICATE_AMOUNT_DETECTED")).toBe(true);
    expect(codes.has("ST_ROUND_NUMBER_RATE_EXCEEDED")).toBe(false); // zero-signal test still completed the run
  });
});
