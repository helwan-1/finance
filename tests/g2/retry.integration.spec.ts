/**
 * G2 mid-attempt crash / retry (CHECK 1) against a real DB as audit_app.
 * Gated by G2_DB_TEST. Proves the C3 attempt model: attempt #1 fails and is
 * retained forensically (non-consumable), attempt #2 retries and succeeds, and
 * only the successful Dataset yields consumable transactions with no duplicates.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { withTenantContext } from "@/lib/db/tenant";
import { startImport, confirmImport, retryImport } from "@/lib/import/pipeline";

const run = process.env.G2_DB_TEST ? describe : describe.skip;

const RUN = randomUUID();
const CSV =
  "الحساب,التاريخ,مدين,الوصف\n" +
  `1010,2024-01-15,500.00,alpha ${RUN}\n` +
  "1020,2024-01-16,300.00,beta\n";

run("G2 attempt/retry recovery (CHECK 1)", () => {
  afterAll(async () => { await prisma.$disconnect(); });

  it("attempt #1 fails and is retained; attempt #2 retries and succeeds", async () => {
    const bytes = Buffer.from(CSV, "utf8");
    const start = await startImport({
      auditFirmId: "firmA", userId: "userA", engagementId: "engA",
      datasetKind: "GENERAL_LEDGER", fileName: "retry-gl.csv", mimeType: "text/csv",
      bytes, idempotencyKey: `rt-${RUN}`,
    });
    expect(start.status).toBe("READY");
    expect(start.rowsAccepted).toBe(2);
    const batchId = start.batchId!;
    const ds1 = start.datasetId!;

    // Inject a fault during confirmation → attempt #1 FAILED.
    const failed = await confirmImport("firmA", "userA", batchId, { faultAfterTransactions: true });
    expect(failed.status).toBe("FAILED");

    const afterFail = await withTenantContext("firmA", async (t) => ({
      attempts: await t.importAttempt.count({ where: { importBatchId: batchId } }),
      a1: await t.importAttempt.findFirst({ where: { importBatchId: batchId, attemptNo: 1 }, select: { status: true } }),
      d1: await t.dataset.findUnique({ where: { id: ds1 }, select: { status: true } }),
      txOnD1: await t.transaction.count({ where: { datasetId: ds1 } }),
      batch: await t.importBatch.findUnique({ where: { id: batchId }, select: { status: true, resultDatasetId: true } }),
    }));
    expect(afterFail.attempts).toBe(1);
    expect(afterFail.a1?.status).toBe("FAILED");
    expect(afterFail.d1?.status).toBe("FAILED"); // forensic, retained
    expect(afterFail.txOnD1).toBe(0); // rolled back — not consumable
    expect(afterFail.batch?.resultDatasetId).toBeNull();

    // Retry → attempt #2.
    const retry = await retryImport("firmA", "userA", batchId);
    expect(retry.status).toBe("READY");
    const ds2 = retry.datasetId!;
    expect(ds2).not.toBe(ds1);

    const twoAttempts = await withTenantContext("firmA", (t) =>
      t.importAttempt.findMany({ where: { importBatchId: batchId }, orderBy: { attemptNo: "asc" }, select: { attemptNo: true, status: true } }),
    );
    expect(twoAttempts).toHaveLength(2);
    expect(twoAttempts[0]).toMatchObject({ attemptNo: 1, status: "FAILED" });
    expect(twoAttempts[1]).toMatchObject({ attemptNo: 2, status: "RUNNING" });

    // Confirm attempt #2 → success.
    const ok = await confirmImport("firmA", "userA", batchId);
    expect(ok.status).toBe("COMPLETED");
    expect(ok.transactionsCreated).toBe(2);

    const final = await withTenantContext("firmA", async (t) => ({
      batch: await t.importBatch.findUnique({ where: { id: batchId }, select: { resultDatasetId: true, status: true } }),
      succeeded: await t.importAttempt.count({ where: { importBatchId: batchId, status: "SUCCEEDED" } }),
      completedDatasets: await t.dataset.count({ where: { importBatchId: batchId, status: { in: ["COMPLETED", "COMPLETED_WITH_ISSUES"] } } }),
      d1: await t.dataset.findUnique({ where: { id: ds1 }, select: { status: true } }),
      d2: await t.dataset.findUnique({ where: { id: ds2 }, select: { status: true } }),
      txOnD1: await t.transaction.count({ where: { datasetId: ds1 } }),
      txOnD2: await t.transaction.count({ where: { datasetId: ds2 } }),
    }));
    expect(final.batch?.resultDatasetId).toBe(ds2); // only successful dataset
    expect(final.succeeded).toBe(1); // exactly one successful attempt
    expect(final.completedDatasets).toBe(1); // no duplicate successful dataset
    expect(final.d1?.status).toBe("FAILED"); // failed attempt's dataset still retained
    expect(final.d2?.status).toBe("COMPLETED");
    expect(final.txOnD1).toBe(0); // failed dataset never consumable
    expect(final.txOnD2).toBe(2); // consumable transactions only from the success — no duplicates
  });
});
