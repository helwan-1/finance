/**
 * G2 pipeline integration (Phase L) against a real DB as the audit_app role.
 * Gated by G2_DB_TEST. Requires DATABASE_URL → audit_app on the migrated DB
 * seeded with firmA/engA. Proves lineage, rejected-row integrity, duplicate
 * headers, hash determinism, and idempotency.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { withTenantContext } from "@/lib/db/tenant";
import { startImport, confirmImport } from "@/lib/import/pipeline";

const run = process.env.G2_DB_TEST ? describe : describe.skip;

// Per-run nonce keeps content + idempotency keys unique so the suite is re-runnable.
const RUN = randomUUID();
const K1 = `pl-${RUN}`;
// GL fixture: valid row, invalid-date row, and a DUPLICATE "مدين" header column.
const CSV =
  "المرجع,الحساب,التاريخ,مدين,دائن,الوصف,مدين\n" +
  `JV1,1010,2024-01-15,500.00,,قيد سليم ${RUN},999\n` +
  "JV2,1020,31/31/2024,300.00,,تاريخ خاطئ,111\n";

run("G2 import pipeline lineage", () => {
  afterAll(async () => { await prisma.$disconnect(); });

  it("start halts at READY with no transactions; confirm creates them", async () => {
    const bytes = Buffer.from(CSV, "utf8");
    const start = await startImport({
      auditFirmId: "firmA", userId: "userA", engagementId: "engA",
      datasetKind: "GENERAL_LEDGER", fileName: "gl.csv", mimeType: "text/csv",
      bytes, idempotencyKey: K1,
    });
    expect(start.status).toBe("READY");
    expect(start.rowsTotal).toBe(2);
    expect(start.rowsAccepted).toBe(1);
    expect(start.rowsRejected).toBe(1);

    // READY ⇒ dataset PENDING, zero transactions yet.
    const pre = await withTenantContext("firmA", async (t) => ({
      txns: await t.transaction.count({ where: { datasetId: start.datasetId! } }),
      ds: await t.dataset.findUnique({ where: { id: start.datasetId! }, select: { status: true } }),
    }));
    expect(pre.txns).toBe(0);
    expect(pre.ds?.status).toBe("PENDING");

    const conf = await confirmImport("firmA", "userA", start.batchId!);
    expect(conf.status).toBe("COMPLETED_WITH_ISSUES"); // 1 rejected row
    expect(conf.transactionsCreated).toBe(1);
    expect(conf.datasetHash).toMatch(/^[0-9a-f]{64}$/);

    // Full lineage traversal: transaction → record → dataset → attempt → batch → source file.
    const chain = await withTenantContext("firmA", async (t) => {
      const txn = await t.transaction.findFirst({
        where: { datasetId: start.datasetId! },
        select: { importedRecordId: true, amount: true },
      });
      const rec = await t.importedRecord.findUnique({
        where: { id: txn!.importedRecordId! },
        select: { sourceRowNo: true, rawCells: true, rawHash: true, datasetId: true, status: true },
      });
      const ds = await t.dataset.findUnique({
        where: { id: rec!.datasetId },
        select: { importAttemptId: true, datasetHash: true, lineageClass: true },
      });
      const att = await t.importAttempt.findUnique({
        where: { id: ds!.importAttemptId },
        select: { status: true, importBatchId: true },
      });
      const batch = await t.importBatch.findUnique({
        where: { id: att!.importBatchId },
        select: { sourceFileId: true, importMappingVersionId: true, effectiveProfileHash: true },
      });
      const sf = await t.sourceFile.findUnique({
        where: { id: batch!.sourceFileId! },
        select: { originalFileName: true, sha256: true, custodyStatus: true },
      });
      return { txn, rec, ds, att, batch, sf };
    });

    expect(chain.sf?.originalFileName).toBe("gl.csv");
    expect(chain.sf?.custodyStatus).toBe("RETAINED");
    expect(chain.sf?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(chain.rec?.sourceRowNo).toBe(1); // the accepted (first) row
    expect(chain.att?.status).toBe("SUCCEEDED");
    expect(chain.ds?.lineageClass).toBe("VERIFIED");
    expect(chain.batch?.importMappingVersionId).toBeTruthy();
    expect(chain.batch?.effectiveProfileHash).toMatch(/^[0-9a-f]{64}$/);

    // C5: duplicate "مدين" header survived as two positional cells.
    const cells = chain.rec!.rawCells as Array<{ i: number; h: string | null; v: string | null }>;
    expect(cells.filter((c) => c.h === "مدين").length).toBe(2);
  });

  it("rejected row is traceable and creates no transaction", async () => {
    const rej = await withTenantContext("firmA", async (t) => {
      const rec = await t.importedRecord.findFirst({
        where: { status: "REJECTED", sourceRowNo: 2 },
        select: { id: true },
      });
      const issue = await t.importIssue.findFirst({
        where: { importedRecordId: rec!.id, severity: "ERROR" },
        select: { code: true, blocking: true },
      });
      const txn = await t.transaction.findFirst({ where: { importedRecordId: rec!.id } });
      return { issue, txn };
    });
    expect(rej.issue?.code).toBe("INVALID_DATE");
    expect(rej.issue?.blocking).toBe(true);
    expect(rej.txn).toBeNull();
  });

  it("re-import of identical bytes reproduces the same datasetHash", async () => {
    const bytes = Buffer.from(CSV, "utf8");
    const s2 = await startImport({
      auditFirmId: "firmA", userId: "userA", engagementId: "engA",
      datasetKind: "GENERAL_LEDGER", fileName: "gl.csv", mimeType: "text/csv",
      bytes, idempotencyKey: `pl2-${RUN}`, acknowledgeDuplicate: true, // content dup override
    });
    expect(s2.status).toBe("READY");
    const c2 = await confirmImport("firmA", "userA", s2.batchId!);
    const first = await withTenantContext("firmA", (t) =>
      t.importBatch.findUnique({ where: { auditFirmId_idempotencyKey: { auditFirmId: "firmA", idempotencyKey: K1 } }, select: { resultDatasetId: true } }),
    );
    const firstHash = await withTenantContext("firmA", (t) =>
      t.dataset.findUnique({ where: { id: first!.resultDatasetId! }, select: { datasetHash: true } }),
    );
    expect(c2.datasetHash).toBe(firstHash!.datasetHash);
  });

  it("idempotency: same key returns the existing batch; confirm twice is idempotent", async () => {
    const bytes = Buffer.from(CSV, "utf8");
    const again = await startImport({
      auditFirmId: "firmA", userId: "userA", engagementId: "engA",
      datasetKind: "GENERAL_LEDGER", fileName: "gl.csv", mimeType: "text/csv",
      bytes, idempotencyKey: K1, acknowledgeDuplicate: true,
    });
    expect(again.status).toBe("DEDUPED_EXISTING");

    const batch = await withTenantContext("firmA", (t) =>
      t.importBatch.findUnique({ where: { auditFirmId_idempotencyKey: { auditFirmId: "firmA", idempotencyKey: K1 } }, select: { id: true } }),
    );
    const c = await confirmImport("firmA", "userA", batch!.id);
    expect(c.status).toBe("ALREADY_COMPLETED");
  });
});
