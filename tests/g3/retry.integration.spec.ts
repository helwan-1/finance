/**
 * G3 canonical atomicity under fault + retry. Gated by G3_DB_TEST.
 * A failed attempt leaves ZERO consumable canonical facts (rolled back with the
 * bridge); retry produces exactly one canonical set on the new dataset (17, 18).
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { withTenantContext } from "@/lib/db/tenant";
import { startImport, confirmImport, retryImport } from "@/lib/import/pipeline";
import { ensureSeed } from "./_seed";

const run = process.env.G3_DB_TEST ? describe : describe.skip;
const RUN = randomUUID();

run("G3 canonical fault/retry atomicity", () => {
  beforeAll(async () => { await ensureSeed(); });
  afterAll(async () => { await prisma.$disconnect(); });

  it("failed attempt → zero canonical facts; retry → exactly one canonical set", async () => {
    const csv =
      "entry id,line id,account,date,debit,credit,currency\n" +
      "R1,1,110100,2024-07-01,20.00,,USD\n" +
      "R1,2,220200,2024-07-01,,20.00,USD\n";
    const start = await startImport({
      auditFirmId: "firmA", userId: null, engagementId: "engA",
      datasetKind: "GENERAL_LEDGER", fileName: "retry.csv", mimeType: "text/csv",
      bytes: Buffer.from(csv, "utf8"), idempotencyKey: `g3-retry-${RUN}`, acknowledgeDuplicate: true,
      // Frozen source-identity provenance is reused verbatim on retry (F2 test 5).
      sourceIdentityMap: { "entry id": "sourceEntryId", "line id": "sourceLineId" },
    });
    const ds1 = start.datasetId!;

    // Inject a fault AFTER canonical facts are constructed → full rollback.
    const failed = await confirmImport("firmA", null, start.batchId!, { faultAfterTransactions: true });
    expect(failed.status).toBe("FAILED");

    const afterFail = await withTenantContext("firmA", async (t) => ({
      lines: await t.journalLine.count({ where: { datasetId: ds1 } }),
      entries: await t.journalEntry.count({ where: { datasetId: ds1 } }),
      accounts: await t.datasetAccount.count({ where: { datasetId: ds1 } }),
      contexts: await t.sourceAccountingContext.count({ where: { datasetId: ds1 } }),
    }));
    expect(afterFail).toMatchObject({ lines: 0, entries: 0, accounts: 0, contexts: 0 }); // atomic rollback (test 17)

    // Retry → new dataset → success.
    const retry = await retryImport("firmA", null, start.batchId!);
    const ds2 = retry.datasetId!;
    expect(ds2).not.toBe(ds1);
    const ok = await confirmImport("firmA", null, start.batchId!);
    expect(ok.status).toBe("COMPLETED");
    expect(ok.canonical).toMatchObject({ journalEntries: 1, journalLines: 2 });

    const final = await withTenantContext("firmA", async (t) => ({
      d1lines: await t.journalLine.count({ where: { datasetId: ds1 } }),
      d2lines: await t.journalLine.count({ where: { datasetId: ds2 } }),
      d2entries: await t.journalEntry.count({ where: { datasetId: ds2 } }),
    }));
    expect(final.d1lines).toBe(0); // failed dataset never consumable
    expect(final.d2lines).toBe(2); // exactly one canonical set, no duplicates (test 18)
    expect(final.d2entries).toBe(1);
  });
});
