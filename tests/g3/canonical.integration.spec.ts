/**
 * G3 canonical GL integration (Phase D) against a real DB as audit_app.
 * Gated by G3_DB_TEST. Proves: source-asserted grouping, no-entry-id → NULL
 * parent, documentNumber never creates an entry, decimal fidelity, currency-safe
 * balance, multi-context account identity, VERIFIED lineage, immutability, and
 * the cross-dataset lineage-consistency constraint.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { withTenantContext } from "@/lib/db/tenant";
import { startImport, confirmImport } from "@/lib/import/pipeline";
import { ensureSeed } from "./_seed";

const run = process.env.G3_DB_TEST ? describe : describe.skip;
const RUN = randomUUID();

async function importGL(
  csv: string, key: string,
  opts: { sourceIdentityMap?: Record<string, string>; fileName?: string } = {},
) {
  const start = await startImport({
    auditFirmId: "firmA", userId: null, engagementId: "engA",
    datasetKind: "GENERAL_LEDGER", fileName: opts.fileName ?? `gl-${key}.csv`, mimeType: "text/csv",
    bytes: Buffer.from(csv, "utf8"), idempotencyKey: `g3-${key}-${RUN}`, acknowledgeDuplicate: true,
    sourceIdentityMap: opts.sourceIdentityMap,
  });
  expect(start.status).toBe("READY");
  const conf = await confirmImport("firmA", null, start.batchId!);
  return { datasetId: start.datasetId!, conf };
}

const ENTRY_MAP = { "entry id": "sourceEntryId", "line id": "sourceLineId" };

run("G3 canonical GL", () => {
  beforeAll(async () => { await ensureSeed(); });
  afterAll(async () => { await prisma.$disconnect(); });

  it("source-asserted entry id groups lines; balance is currency-safe; 3dp fidelity survives", async () => {
    const csv =
      "entry id,line id,account,date,debit,credit,currency,description\n" +
      "E1,1,110100,2024-03-01,100.125,,USD,a\n" +
      "E1,2,220200,2024-03-01,,100.125,USD,b\n" +
      "E2,1,110100,2024-03-02,50,,USD,x\n" +
      "E2,2,220200,2024-03-02,,40,USD,y\n";
    const { datasetId, conf } = await importGL(csv, "grp", { sourceIdentityMap: ENTRY_MAP });
    expect(conf.status).toBe("COMPLETED");
    expect(conf.canonical).toMatchObject({ contexts: 1, datasetAccounts: 2, journalEntries: 2, journalLines: 4 });

    const data = await withTenantContext("firmA", async (t) => {
      const e1 = await t.journalEntry.findUnique({
        where: { auditFirmId_datasetId_sourceEntryId: { auditFirmId: "firmA", datasetId, sourceEntryId: "E1" } },
      });
      const e2 = await t.journalEntry.findUnique({
        where: { auditFirmId_datasetId_sourceEntryId: { auditFirmId: "firmA", datasetId, sourceEntryId: "E2" } },
      });
      const l1 = await t.journalLine.findFirst({ where: { datasetId, journalEntryId: e1!.id }, orderBy: { lineNo: "asc" } });
      return { e1, e2, l1 };
    });

    // Grouping + balance (test 1, 2, 6).
    expect(data.e1?.groupingBasis).toBe("SOURCE_ASSERTED_ENTRY_LINE");
    expect(data.e1?.balanceCapability).toBe("AVAILABLE");
    expect(data.e1?.monetaryBasis).toBe("TRANSACTION");
    expect(data.e1?.balanceCurrency).toBe("USD");
    expect(data.e1?.balanceStatus).toBe("BALANCED");
    expect(Number(data.e1?.difference)).toBe(0);
    expect(data.e2?.balanceStatus).toBe("UNBALANCED"); // unbalanced retained, not rejected
    expect(Number(data.e2?.difference)).toBe(10);

    // Decimal fidelity: 100.125 survived (bridge would have rounded to 2dp) (test 5).
    expect(Number(data.l1?.transactionDebit)).toBe(100.125);
    expect(data.l1?.groupingCapability).toBe("EXPLICIT_ENTRY_AND_LINE_ID");
    expect(data.l1?.sourceLineId).toBe("1");
    expect(data.l1?.transactionCurrency).toBe("USD");
  });

  it("no source entry id → JournalLines persist with journalEntryId NULL; documentNumber never creates an entry (tests 3, 4)", async () => {
    const csv =
      "voucher,account,date,debit,credit,currency\n" +
      "V100,110100,2024-04-01,10.00,,USD\n" +
      "V100,220200,2024-04-01,,10.00,USD\n";
    const { datasetId, conf } = await importGL(csv, "noent");
    expect(conf.canonical).toMatchObject({ journalEntries: 0, journalLines: 2 });

    const q = await withTenantContext("firmA", async (t) => ({
      entries: await t.journalEntry.count({ where: { datasetId } }),
      lines: await t.journalLine.findMany({ where: { datasetId }, select: { journalEntryId: true, groupingCapability: true, documentNumber: true } }),
    }));
    expect(q.entries).toBe(0);
    expect(q.lines.every((l) => l.journalEntryId === null)).toBe(true);
    expect(q.lines.every((l) => l.groupingCapability === "NO_RELIABLE_ENTRY_ID")).toBe(true);
    expect(q.lines.some((l) => l.documentNumber === "V100")).toBe(true); // kept as line metadata only
  });

  it("F2: an 'entry id' header that is NOT in the frozen map (and an entry-like filename) never creates a SOURCE_ASSERTED entry", async () => {
    const csv =
      "entry id,account,date,debit,credit,currency\n" +
      "E9,110100,2024-09-01,10.00,,USD\n" +
      "E9,220200,2024-09-01,,10.00,USD\n";
    // No sourceIdentityMap → detection alone must not be trusted; filename hints ignored.
    const { datasetId, conf } = await importGL(csv, "f2unmapped", { fileName: "journal-entry-E9-export.csv" });
    expect(conf.canonical).toMatchObject({ journalEntries: 0, journalLines: 2 });
    const q = await withTenantContext("firmA", (t) => t.journalLine.findMany({ where: { datasetId }, select: { journalEntryId: true, groupingCapability: true } }));
    expect(q.every((l) => l.journalEntryId === null && l.groupingCapability === "NO_RELIABLE_ENTRY_ID")).toBe(true);
  });

  it("same accountCode under different source entities → distinct DatasetAccounts (test 9)", async () => {
    const csv =
      "entity,account,date,debit,currency\n" +
      "ENT1,500100,2024-05-01,5.00,USD\n" +
      "ENT2,500100,2024-05-02,7.00,USD\n";
    const { datasetId, conf } = await importGL(csv, "ctx", { sourceIdentityMap: { entity: "sourceEntity" } });
    expect(conf.canonical).toMatchObject({ contexts: 2, datasetAccounts: 2 });

    const q = await withTenantContext("firmA", async (t) => ({
      ctx: await t.sourceAccountingContext.count({ where: { datasetId } }),
      da: await t.datasetAccount.findMany({ where: { datasetId, sourceAccountCode: "500100" }, select: { sourceAccountingContextId: true } }),
    }));
    expect(q.ctx).toBe(2);
    expect(q.da).toHaveLength(2);
    expect(new Set(q.da.map((d) => d.sourceAccountingContextId)).size).toBe(2); // not collapsed
  });

  it("GL detail dropped by the bridge is preserved on the canonical line (G3-DEBT-007)", async () => {
    const csv =
      "account,date,debit,currency,cost center,profit center,user,source,counterparty,description,reference\n" +
      "900100,2024-08-01,12.00,USD,CC1,PC1,U1,ERP,ACME,desc x,REF9\n";
    const { datasetId } = await importGL(csv, "detail");
    const line = await withTenantContext("firmA", (t) =>
      t.journalLine.findFirst({ where: { datasetId }, select: {
        costCenter: true, profitCenter: true, postedByUserId: true, sourceType: true,
        counterparty: true, description: true, reference: true,
      } }));
    expect(line).toMatchObject({
      costCenter: "CC1", profitCenter: "PC1", postedByUserId: "U1", sourceType: "ERP",
      counterparty: "ACME", description: "desc x", reference: "REF9",
    });
  });

  it("VERIFIED line traces ImportedRecord → Dataset → SourceFile (test 10, 14)", async () => {
    const chain = await withTenantContext("firmA", async (t) => {
      const line = await t.journalLine.findFirst({ where: { transactionDebit: { not: null } }, select: { importedRecordId: true, datasetId: true, lineageClass: true } });
      const rec = await t.importedRecord.findUnique({ where: { id: line!.importedRecordId }, select: { datasetId: true } });
      const ds = await t.dataset.findUnique({ where: { id: rec!.datasetId }, select: { sourceFileId: true, lineageClass: true } });
      const sf = await t.sourceFile.findUnique({ where: { id: ds!.sourceFileId! }, select: { custodyStatus: true, sha256: true } });
      return { line, rec, ds, sf };
    });
    expect(chain.line?.lineageClass).toBe("VERIFIED");
    expect(chain.rec?.datasetId).toBe(chain.line?.datasetId); // denormalized key consistent
    expect(chain.ds?.lineageClass).toBe("VERIFIED");
    expect(chain.sf?.custodyStatus).toBe("RETAINED");
    expect(chain.sf?.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("source facts are immutable: audit_app UPDATE on journal_lines is refused (Section M)", async () => {
    await expect(
      withTenantContext("firmA", (t) =>
        t.$executeRaw`UPDATE "journal_lines" SET "transactionDebit" = 0 WHERE "auditFirmId" = 'firmA'`,
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it("cross-dataset lineage mismatch is rejected structurally (test 15)", async () => {
    const ids = await withTenantContext("firmA", async (t) => {
      const line = await t.journalLine.findFirst({ select: { accountSnapshotId: true, importedRecordId: true, datasetId: true } });
      // a DIFFERENT dataset's id
      const other = await t.dataset.findFirst({ where: { id: { not: line!.datasetId } }, select: { id: true } });
      return { line, otherDatasetId: other?.id };
    });
    // Insert a journal_line whose datasetId does not match its ImportedRecord's dataset.
    await expect(
      withTenantContext("firmA", (t) =>
        t.$executeRaw`
          INSERT INTO "journal_lines"
            ("id","auditFirmId","datasetId","lineNo","accountSnapshotId","groupingCapability","importedRecordId")
          VALUES (${"jl_" + randomUUID()}, 'firmA', ${ids.otherDatasetId!}, 99,
                  ${ids.line!.accountSnapshotId}, 'NO_RELIABLE_ENTRY_ID', ${ids.line!.importedRecordId})`,
      ),
    ).rejects.toThrow(/foreign key|violates/i);
  });
});
