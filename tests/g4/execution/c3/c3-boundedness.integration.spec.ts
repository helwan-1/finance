/**
 * G4 Phase C3 — FINAL VERIFICATION CLOSURE (real PostgreSQL EXPLAIN ANALYZE).
 * Verification-only. Proves the DATABASE-WORK bound of the C3 statistical
 * evidence retrieval, distinct from the RESULT/MEMORY bound:
 *  - a ~100k-row single duplicate group,
 *  - a multi-group page (one production $queryRaw, evidence ≤ pageSize×K),
 *  - the ROUND LATERAL plan on a meaningful population.
 * It runs the EXACT production query (captured via Prisma query logging) and
 * EXPLAINs it faithfully as the RLS-bound audit_app role. It NEVER modifies
 * production code, schema, or indexes.
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
import { fetchDuplicateAmountSignalPage, fetchRoundNumberSignalPage } from "@/lib/g4/execution/population";

const run = process.env.G4_DB_TEST ? describe : describe.skip;
const owner = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_DATABASE_URL } } });

// Client with query-event logging — used ONLY to capture the exact SQL text +
// params that the production population functions emit.
const logged = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } }, log: [{ emit: "event", level: "query" }] });
const captured: Array<{ query: string; params: string }> = [];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(logged as any).$on("query", (e: { query: string; params: string }) => { captured.push({ query: e.query, params: e.params }); });

/** Tenant context (RLS bound as audit_app) with a long transaction budget for EXPLAIN ANALYZE on large fixtures. */
function withLongTenant<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.audit_firm_id', ${"firmA"}, true)`;
    return fn(tx);
  }, { timeout: 120_000, maxWait: 15_000 });
}

async function captureProductionSql(marker: string, fn: (tx: Prisma.TransactionClient) => Promise<unknown>): Promise<{ sql: string; params: unknown[] }> {
  captured.length = 0;
  await logged.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.audit_firm_id', ${"firmA"}, true)`;
    await fn(tx);
  }, { timeout: 120_000, maxWait: 15_000 });
  const hit = [...captured].reverse().find((c) => c.query.includes(marker) && c.query.includes("LATERAL"));
  if (!hit) throw new Error(`could not capture production SQL for marker ${marker}`);
  return { sql: hit.query, params: JSON.parse(hit.params) as unknown[] };
}

interface PlanNode { "Node Type": string; "Actual Rows": number; "Actual Loops": number; "Sort Method"?: string; Plans?: PlanNode[]; [k: string]: unknown }
interface PlanRoot { Plan: PlanNode; "Planning Time": number; "Execution Time": number }

function walk(n: PlanNode, out: PlanNode[] = []): PlanNode[] { out.push(n); for (const c of n.Plans ?? []) walk(c, out); return out; }

async function explain(sql: string, params: unknown[]): Promise<{ text: string; json: PlanRoot }> {
  const text = await withLongTenant(async (tx) => {
    const rows = await tx.$queryRawUnsafe<Array<Record<string, string>>>(`EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${sql}`, ...params);
    return rows.map((r) => r["QUERY PLAN"]).join("\n");
  });
  const json = await withLongTenant(async (tx) => {
    const rows = await tx.$queryRawUnsafe<Array<{ "QUERY PLAN": PlanRoot[] }>>(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`, ...params);
    return rows[0]!["QUERY PLAN"][0]!;
  });
  return { text, json };
}
/** Collect every Sort node whose sort key references sourceRowNo — the evidence (top-K) sorts. */
function evidenceSorts(nodes: PlanNode[]): PlanNode[] {
  return nodes.filter((n) => /Sort/.test(n["Node Type"]) && JSON.stringify(n["Sort Key"] ?? "").includes("sourceRowNo"));
}

// ── fixture builders (test-only; base graph via the real import, bulk via owner) ──
async function importBase(csv: string): Promise<string> {
  const n = randomUUID();
  const start = await startImport({
    auditFirmId: "firmA", userId: null, engagementId: "engA", datasetKind: "GENERAL_LEDGER",
    fileName: `c3b-${n}.csv`, mimeType: "text/csv", bytes: Buffer.from(csv, "utf8"), idempotencyKey: `c3b-${n}`, acknowledgeDuplicate: true,
  });
  await confirmImport("firmA", null, start.batchId!);
  return start.datasetId!;
}
async function createDupTest(kind: string): Promise<string> {
  const key = `T-${randomUUID()}`;
  return withTenantContext("firmA", async (t) => {
    const test = await t.auditTest.create({ data: { auditFirmId: "firmA", key, name: "n", nameAr: "ن", testType: "STATISTICAL" }, select: { id: true } });
    const tv = await t.auditTestVersion.create({ data: { auditFirmId: "firmA", auditTestId: test.id, version: 1, testType: "STATISTICAL", definitionJson: { kind }, requirementsJson: { requiredDatasetKinds: ["GENERAL_LEDGER"] }, versionHash: `vh-${randomUUID()}`, status: "ACTIVE" }, select: { id: true } });
    await t.auditTest.update({ where: { id: test.id }, data: { currentVersionId: tv.id } });
    return key;
  });
}
async function freeze(datasetId: string, testKey: string, parameters: Record<string, unknown>) {
  const { runId } = await createDraftRun("firmA", { engagementId: "engA" });
  const { prepId } = await beginPreparation("firmA", { runId, tests: [{ testKey, parameters }], datasetIds: [datasetId], batchSize: 500 });
  const chunks = await withTenantContext("firmA", (t) => t.auditRunPrepChunk.findMany({ where: { preparationId: prepId }, select: { auditTestVersionId: true, datasetId: true } }));
  for (const c of chunks) await materializePopulation("firmA", prepId, c.auditTestVersionId, c.datasetId, { batchSize: 500 });
  await sealPreparation("firmA", prepId);
  await publishRun("firmA", runId, prepId);
  const tvId = (await withTenantContext("firmA", (t) => t.auditRunTestVersion.findFirst({ where: { preparationId: prepId }, select: { auditTestVersionId: true } })))!.auditTestVersionId;
  return { runId, prepId, tvId };
}
/** Bulk-add `count` single-sided credit lines of (amount, USD) as frozen members, from sourceRowNo start. */
async function bulkGroup(datasetId: string, prepId: string, tvId: string, amount: string, count: number, startRow: number) {
  const base = (await owner.$queryRaw<Array<{ acct: string }>>(Prisma.sql`SELECT "accountSnapshotId" AS "acct" FROM "journal_lines" WHERE "datasetId"=${datasetId} LIMIT 1`))[0]!;
  const batch = (await owner.$queryRaw<Array<{ b: string }>>(Prisma.sql`SELECT "importBatchId" AS "b" FROM "imported_records" WHERE "datasetId"=${datasetId} LIMIT 1`))[0]!;
  const tag = `${startRow}-${randomUUID().slice(0, 8)}-`; // globally-unique id prefix (ids are not per-dataset)
  await owner.$executeRaw(Prisma.sql`
    INSERT INTO "imported_records" ("id","auditFirmId","datasetId","importBatchId","sourceRowNo","rawCells","rawHash","status")
    SELECT ${"ir" + tag}||g, 'firmA', ${datasetId}, ${batch.b}, ${startRow}+g, '{}'::jsonb, ${"rh" + tag}||g, 'ACCEPTED'::"ImportedRecordStatus"
    FROM generate_series(1, ${count}) g`);
  await owner.$executeRaw(Prisma.sql`
    INSERT INTO "journal_lines" ("id","auditFirmId","datasetId","lineNo","accountSnapshotId","groupingCapability","importedRecordId","transactionCredit","transactionCurrency")
    SELECT ${"jl" + tag}||g, 'firmA', ${datasetId}, 1, ${base.acct}, 'NO_RELIABLE_ENTRY_ID'::"JournalGroupingCapability", ${"ir" + tag}||g, ${amount}::numeric(24,6), 'USD'
    FROM generate_series(1, ${count}) g`);
  await owner.$executeRaw(Prisma.sql`
    INSERT INTO "audit_run_scope_members" ("id","auditFirmId","preparationId","auditTestVersionId","datasetId","sourceRowNo","evidenceType","eoiFrameHash","contentHash")
    SELECT ${"m" + tag}||g, 'firmA', ${prepId}, ${tvId}, ${datasetId}, ${startRow}+g, 'IMPORTED_RECORD'::"AuditEvidenceType", ${"eoi" + tag}||g, ${"rh" + tag}||g
    FROM generate_series(1, ${count}) g`);
}

const BIG = Number(process.env.C3_BIG ?? 100_000); // large single-group size

run("G4 C3 boundedness (EXPLAIN ANALYZE)", () => {
  const PRIOR = process.env.AUDIT_ENGINE_BUILD;
  const st: { dupDs?: string; dupPrep?: string; dupTv?: string; rndDs?: string; rndPrep?: string; rndTv?: string } = {};
  beforeAll(async () => {
    process.env.AUDIT_ENGINE_BUILD = "test-build-c3b";
    const s = await import("../../_seed"); await s.ensureSeed();

    // Duplicate fixture: base 2 rows (99.00 USD) + BIG-row group (99.00) + 5 small groups (91..95, ×100).
    st.dupDs = await importBase("account,date,debit,credit,currency\n1,2024-01-01,,99.00,USD\n2,2024-01-01,,99.00,USD\n");
    const dupKey = await createDupTest("DUPLICATE_AMOUNT_FREQUENCY");
    const df = await freeze(st.dupDs, dupKey, { amountBasis: "TRANSACTION", methodVersion: "st.dupamt.1", minimumOccurrenceCount: 3 });
    st.dupPrep = df.prepId; st.dupTv = df.tvId;
    await bulkGroup(st.dupDs, st.dupPrep, st.dupTv, "99.00", BIG, 1_000);
    let row = 1_000 + BIG + 10;
    for (const amt of ["91.00", "92.00", "93.00", "94.00", "95.00"]) { await bulkGroup(st.dupDs, st.dupPrep, st.dupTv, amt, 100, row); row += 200; }

    // Round fixture: 20000 round (100.00) + 20000 non-round (150.00), all USD.
    st.rndDs = await importBase("account,date,debit,credit,currency\n1,2024-01-01,,100.00,USD\n2,2024-01-01,,100.00,USD\n");
    const rndKey = await createDupTest("ROUND_NUMBER_FREQUENCY");
    const rf = await freeze(st.rndDs, rndKey, { amountBasis: "TRANSACTION", methodVersion: "st.round.1", roundingQuantum: "100.000000", minimumPopulation: 1, minimumRoundCount: 1, rateThresholdNum: 1, rateThresholdDenom: 2 });
    st.rndPrep = rf.prepId; st.rndTv = rf.tvId;
    await bulkGroup(st.rndDs, st.rndPrep, st.rndTv, "100.00", 20_000, 1_000);
    await bulkGroup(st.rndDs, st.rndPrep, st.rndTv, "150.00", 20_000, 100_000);

    // Give the planner real statistics (production tables are ANALYZEd by autovacuum);
    // without this the planner mis-estimates the fresh fixture as 1 row.
    for (const t of ["imported_records", "journal_lines", "audit_run_scope_members", "audit_run_scope_resolutions", "audit_run_datasets"]) {
      await owner.$executeRawUnsafe(`ANALYZE "${t}"`);
    }
  }, 180_000);
  afterAll(async () => { if (PRIOR === undefined) delete process.env.AUDIT_ENGINE_BUILD; else process.env.AUDIT_ENGINE_BUILD = PRIOR; await owner.$disconnect(); await logged.$disconnect(); await prisma.$disconnect(); });

  it(`DUP: ${BIG}-row single group — occurrenceCount full, evidence 3, memory bound`, async () => {
    const groups = await withLongTenant((tx) => fetchDuplicateAmountSignalPage(tx, st.dupPrep!, st.dupTv!, [st.dupDs!], 3, null, 500, 3));
    const g99 = groups.filter((r) => r.scalar === "99.000000");
    const distinct = new Set(g99.map((r) => r.evEoi));
    expect(Number(g99[0]!.occurrenceCount)).toBe(BIG + 2);       // full DB-side count (base 2 + BIG)
    expect(distinct.size).toBeLessThanOrEqual(3);                // ≤ K evidence rows materialized
    expect(g99.length).toBeLessThanOrEqual(3);                   // JS never sees the whole group
  }, 120_000);

  it("DUP: EXPLAIN ANALYZE — one aggregate, LATERAL once per group, no N+1, no temp spill", async () => {
    const { sql, params } = await captureProductionSql("HAVING", (tx) => fetchDuplicateAmountSignalPage(tx, st.dupPrep!, st.dupTv!, [st.dupDs!], 3, null, 500, 3));
    const { text, json } = await explain(sql, params);
    console.log("\n===== DUPLICATE PLAN (100k group + 5 small groups) =====\n" + text +
      `\nPlanning Time: ${json["Planning Time"]} ms  Execution Time: ${json["Execution Time"]} ms\n`);
    const nodes = walk(json.Plan);
    const top = json.Plan;
    const GROUPS = 6; // 99 (big) + 91..95
    // (A) RESULT/MEMORY bound: the whole page returns ≤ groups × K rows.
    expect(top["Actual Rows"]).toBeLessThanOrEqual(GROUPS * 3);
    // (B) ONE grouping aggregate drives the whole page (≤2 nodes allows a parallel partial+finalize),
    //     i.e. NOT one aggregate per group.
    const aggs = nodes.filter((n) => /Aggregate/.test(n["Node Type"]));
    expect(aggs.length).toBeGreaterThanOrEqual(1);
    expect(aggs.length).toBeLessThanOrEqual(2);
    // (C) evidence (top-K) retrieval: runs once PER GROUP (loops ≤ #groups), never once per population
    //     row → no application N+1, no O(N×groups); and its sort is memory-bounded (no temp spill).
    const evSorts = evidenceSorts(nodes);
    expect(evSorts.length).toBeGreaterThanOrEqual(1);
    for (const s of evSorts) {
      expect(s["Actual Loops"]).toBeLessThanOrEqual(GROUPS);
      expect(s["Sort Method"] ?? "").not.toContain("external");
    }
    expect(json["Execution Time"]).toBeLessThan(60_000);
  }, 120_000);

  it("DUP: multi-group page in a SINGLE query — evidence ≤ 3 per group, ≤ pageSize×K total", async () => {
    const groups = await withLongTenant((tx) => fetchDuplicateAmountSignalPage(tx, st.dupPrep!, st.dupTv!, [st.dupDs!], 3, null, 500, 3));
    // reassemble evidence per (scalar) group
    const byScalar = new Map<string, Set<string>>();
    for (const r of groups) { if (!byScalar.has(r.scalar)) byScalar.set(r.scalar, new Set()); if (r.evEoi) byScalar.get(r.scalar)!.add(r.evEoi); }
    expect(byScalar.size).toBe(6); // 99 + 91..95
    for (const [, ev] of byScalar) expect(ev.size).toBeLessThanOrEqual(3);
    expect(groups.length).toBeLessThanOrEqual(500 * 3);
  }, 120_000);

  it("ROUND: EXPLAIN ANALYZE on a 40k population — one aggregate + bounded LATERAL, no N+1, no spill", async () => {
    const { sql, params } = await captureProductionSql("FILTER", (tx) => fetchRoundNumberSignalPage(tx, st.rndPrep!, st.rndTv!, [st.rndDs!], "100.000000", 1, 1, 1, 2, null, 500, 3));
    const { text, json } = await explain(sql, params);
    console.log("\n===== ROUND PLAN (40k population, 20k round) =====\n" + text +
      `\nPlanning Time: ${json["Planning Time"]} ms  Execution Time: ${json["Execution Time"]} ms\n`);
    const nodes = walk(json.Plan);
    expect(json.Plan["Actual Rows"]).toBeLessThanOrEqual(1 * 3); // one currency population → ≤3 evidence
    expect(nodes.some((n) => n["Node Type"] === "Nested Loop")).toBe(true);
    // Evidence (top-K) sort runs once for the single breached population and stays memory-bounded.
    const evSorts = evidenceSorts(nodes);
    expect(evSorts.length).toBeGreaterThanOrEqual(1);
    for (const s of evSorts) { expect(s["Actual Loops"]).toBeLessThanOrEqual(1); expect(s["Sort Method"] ?? "").not.toContain("external"); }
    // functional result check
    const groups = await withLongTenant((tx) => fetchRoundNumberSignalPage(tx, st.rndPrep!, st.rndTv!, [st.rndDs!], "100.000000", 1, 1, 1, 2, null, 500, 3));
    expect(Number(groups[0]!.eligibleCount)).toBe(40_002);
    expect(Number(groups[0]!.roundCount)).toBe(20_002);
    expect(groups.length).toBeLessThanOrEqual(3);
  }, 120_000);
});
