/**
 * G3 canonical Trial Balance integration. Gated by G3_DB_TEST. TB is stored as
 * source evidence: balances preserved exactly, missing figures stay NULL (never
 * derived). No TB balancing / GL↔TB reconciliation in G3 (test 13).
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { withTenantContext } from "@/lib/db/tenant";
import { startImport, confirmImport } from "@/lib/import/pipeline";
import { ensureSeed } from "./_seed";

const run = process.env.G3_DB_TEST ? describe : describe.skip;
const RUN = randomUUID();

run("G3 canonical Trial Balance", () => {
  beforeAll(async () => { await ensureSeed(); });
  afterAll(async () => { await prisma.$disconnect(); });

  it("preserves supplied balances exactly and leaves absent balances NULL", async () => {
    const csv =
      "account,account name,opening debit,opening credit,closing debit,closing credit,currency\n" +
      "110100,Cash,1000.125,,1200.750,,USD\n" +
      "220200,Payables,,500.00,,600.00,USD\n";
    const start = await startImport({
      auditFirmId: "firmA", userId: null, engagementId: "engA",
      datasetKind: "TRIAL_BALANCE", fileName: "tb.csv", mimeType: "text/csv",
      bytes: Buffer.from(csv, "utf8"), idempotencyKey: `g3-tb-${RUN}`, acknowledgeDuplicate: true,
    });
    expect(start.status).toBe("READY");
    const conf = await confirmImport("firmA", null, start.batchId!);
    expect(conf.status).toBe("COMPLETED");
    expect(conf.canonical).toMatchObject({ trialBalances: 1, trialBalanceRows: 2, datasetAccounts: 2 });

    const q = await withTenantContext("firmA", async (t) => {
      const tb = await t.trialBalance.findUnique({ where: { auditFirmId_datasetId: { auditFirmId: "firmA", datasetId: start.datasetId! } }, select: { id: true, currency: true } });
      const rows = await t.trialBalanceRow.findMany({ where: { datasetId: start.datasetId! }, orderBy: { createdAt: "asc" } });
      const cash = rows.find((r) => Number(r.openingDebit) === 1000.125);
      return { tb, rows, cash };
    });
    expect(q.tb?.currency).toBe("USD");
    expect(q.rows).toHaveLength(2);
    // Exact fidelity incl. 3dp; period figures absent → NULL, never derived.
    expect(Number(q.cash?.openingDebit)).toBe(1000.125);
    expect(Number(q.cash?.closingDebit)).toBe(1200.75);
    expect(q.cash?.openingCredit).toBeNull();
    expect(q.cash?.periodDebit).toBeNull();
    expect(q.cash?.periodCredit).toBeNull();
    expect(q.cash?.closingCredit).toBeNull();
  });
});
