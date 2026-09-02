/**
 * G3 amount-only debit/credit direction (F1). Gated by G3_DB_TEST.
 * Direction is derived from a single signed amount ONLY under an explicit,
 * frozen sign convention; with no convention the direction is never fabricated
 * and the raw amount stays recoverable via lineage.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { withTenantContext } from "@/lib/db/tenant";
import { startImport, confirmImport } from "@/lib/import/pipeline";
import { ensureSeed } from "./_seed";

const run = process.env.G3_DB_TEST ? describe : describe.skip;
const RUN = randomUUID();

type Conv = "POSITIVE_DEBIT_NEGATIVE_CREDIT" | "POSITIVE_CREDIT_NEGATIVE_DEBIT" | undefined;

async function imp(csv: string, key: string, amountSignConvention?: Conv) {
  const start = await startImport({
    auditFirmId: "firmA", userId: null, engagementId: "engA",
    datasetKind: "GENERAL_LEDGER", fileName: `${key}.csv`, mimeType: "text/csv",
    bytes: Buffer.from(csv, "utf8"), idempotencyKey: `g3-amt-${key}-${RUN}`, acknowledgeDuplicate: true,
    amountSignConvention,
  });
  await confirmImport("firmA", null, start.batchId!);
  return start.datasetId!;
}

const lineFor = (datasetId: string) =>
  withTenantContext("firmA", (t) => t.journalLine.findFirst({
    where: { datasetId },
    select: { transactionDebit: true, transactionCredit: true, importedRecordId: true },
    orderBy: { lineNo: "asc" },
  }));

run("G3 amount-only direction (F1)", () => {
  beforeAll(async () => { await ensureSeed(); });
  afterAll(async () => { await prisma.$disconnect(); });

  it("explicit source debit column → debit preserved (test 1)", async () => {
    const ds = await imp("account,date,debit,credit,currency\n110100,2024-01-01,30.00,,USD\n", "expd");
    const l = await lineFor(ds);
    expect(Number(l?.transactionDebit)).toBe(30);
    expect(l?.transactionCredit).toBeNull();
  });

  it("explicit source credit column → credit preserved (test 2)", async () => {
    const ds = await imp("account,date,debit,credit,currency\n220200,2024-01-01,,45.00,USD\n", "expc");
    const l = await lineFor(ds);
    expect(l?.transactionDebit).toBeNull();
    expect(Number(l?.transactionCredit)).toBe(45);
  });

  it("amount-only + POSITIVE_DEBIT_NEGATIVE_CREDIT → correct side (test 3)", async () => {
    const ds = await imp("account,date,amount,currency\n110100,2024-01-01,70.00,USD\n110100,2024-01-02,-25.00,USD\n", "pdnc", "POSITIVE_DEBIT_NEGATIVE_CREDIT");
    const rows = await withTenantContext("firmA", (t) => t.journalLine.findMany({ where: { datasetId: ds }, orderBy: { lineNo: "asc" }, select: { transactionDebit: true, transactionCredit: true } }));
    expect(Number(rows[0]?.transactionDebit)).toBe(70);
    expect(rows[0]?.transactionCredit).toBeNull();
    expect(rows[1]?.transactionDebit).toBeNull();
    expect(Number(rows[1]?.transactionCredit)).toBe(25);
  });

  it("amount-only + POSITIVE_CREDIT_NEGATIVE_DEBIT → inverse side (test 4)", async () => {
    const ds = await imp("account,date,amount,currency\n110100,2024-01-01,70.00,USD\n110100,2024-01-02,-25.00,USD\n", "pcnd", "POSITIVE_CREDIT_NEGATIVE_DEBIT");
    const rows = await withTenantContext("firmA", (t) => t.journalLine.findMany({ where: { datasetId: ds }, orderBy: { lineNo: "asc" }, select: { transactionDebit: true, transactionCredit: true } }));
    expect(rows[0]?.transactionDebit).toBeNull();
    expect(Number(rows[0]?.transactionCredit)).toBe(70);
    expect(Number(rows[1]?.transactionDebit)).toBe(25);
    expect(rows[1]?.transactionCredit).toBeNull();
  });

  it("amount-only + NO convention → no fabricated direction; raw amount still recoverable (tests 5, 6)", async () => {
    const ds = await imp("account,date,amount,currency\n110100,2024-01-01,88.250,USD\n", "noconv");
    const l = await withTenantContext("firmA", (t) => t.journalLine.findFirst({ where: { datasetId: ds }, select: { transactionDebit: true, transactionCredit: true, importedRecordId: true } }));
    expect(l?.transactionDebit).toBeNull();  // direction NOT fabricated
    expect(l?.transactionCredit).toBeNull();
    // Raw source amount recoverable exactly via lineage (G2 rawCells).
    const rec = await withTenantContext("firmA", (t) => t.importedRecord.findUnique({ where: { id: l!.importedRecordId }, select: { rawCells: true } }));
    const cells = rec!.rawCells as Array<{ i: number; h: string | null; v: string | null }>;
    expect(cells.find((c) => c.h === "amount")?.v).toBe("88.250");
  });
});
