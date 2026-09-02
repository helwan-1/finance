/**
 * G3 account master + versioned mapping integration. Gated by G3_DB_TEST.
 * Proves scope-partitioned master identity (test 10), immutable/atomic mapping
 * versions (test 11), and that master edits never rewrite the source snapshot
 * or the immutable JournalLine (test 12).
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { withTenantContext } from "@/lib/db/tenant";
import { startImport, confirmImport } from "@/lib/import/pipeline";
import { mapDatasetAccount } from "@/lib/accounting/mapping";
import { ensureSeed } from "./_seed";

const run = process.env.G3_DB_TEST ? describe : describe.skip;
const RUN = randomUUID();

run("G3 account master + versioned mapping", () => {
  beforeAll(async () => { await ensureSeed(); });
  afterAll(async () => { await prisma.$disconnect(); });

  it("AccountingScope partitions the master: same accountCode coexists across scopes (test 10)", async () => {
    const scopes = await withTenantContext("firmA", async (t) => {
      const a = await t.accountingScope.create({ data: { auditFirmId: "firmA", clientCompanyId: "clientA", key: `SAP:E1:GL-${RUN}` }, select: { id: true } });
      const b = await t.accountingScope.create({ data: { auditFirmId: "firmA", clientCompanyId: "clientA", key: `ODOO:E2:GL-${RUN}` }, select: { id: true } });
      const accA = await t.account.create({ data: { auditFirmId: "firmA", clientCompanyId: "clientA", accountingScopeId: a.id, accountCode: "110100", accountName: "Cash (SAP)" }, select: { id: true } });
      const accB = await t.account.create({ data: { auditFirmId: "firmA", clientCompanyId: "clientA", accountingScopeId: b.id, accountCode: "110100", accountName: "Cash (Odoo)" }, select: { id: true } });
      return { a, b, accA, accB };
    });
    expect(scopes.accA.id).not.toBe(scopes.accB.id); // same code, different scope → distinct masters
  });

  it("mapping versions are monotonic, prior version superseded atomically, history immutable (test 11); master rename does not rewrite the snapshot (test 12)", async () => {
    // Import a small GL to obtain a real DatasetAccount + JournalLine.
    const csv = "account,date,debit,currency\n700100,2024-06-01,9.00,USD\n";
    const start = await startImport({
      auditFirmId: "firmA", userId: null, engagementId: "engA",
      datasetKind: "GENERAL_LEDGER", fileName: "map.csv", mimeType: "text/csv",
      bytes: Buffer.from(csv, "utf8"), idempotencyKey: `g3-map-${RUN}`, acknowledgeDuplicate: true,
    });
    await confirmImport("firmA", null, start.batchId!);

    const setup = await withTenantContext("firmA", async (t) => {
      const da = await t.datasetAccount.findFirst({ where: { datasetId: start.datasetId!, sourceAccountCode: "700100" }, select: { id: true, sourceAccountName: true } });
      const scope = await t.accountingScope.create({ data: { auditFirmId: "firmA", clientCompanyId: "clientA", key: `SCOPE-${RUN}` }, select: { id: true } });
      const acc1 = await t.account.create({ data: { auditFirmId: "firmA", clientCompanyId: "clientA", accountingScopeId: scope.id, accountCode: "700100", accountName: "Sales" }, select: { id: true } });
      const acc2 = await t.account.create({ data: { auditFirmId: "firmA", clientCompanyId: "clientA", accountingScopeId: scope.id, accountCode: "700100-ALT", accountName: "Sales (reclassified)" }, select: { id: true } });
      const line = await t.journalLine.findFirst({ where: { datasetId: start.datasetId! }, select: { id: true, accountSnapshotId: true } });
      return { da, acc1, acc2, line };
    });

    // v1 then v2 (supersession).
    const v1 = await withTenantContext("firmA", (t) => mapDatasetAccount(t, { auditFirmId: "firmA", datasetAccountId: setup.da!.id, accountId: setup.acc1.id, basis: "AUDITOR_ASSERTED", mappedById: null }));
    const v2 = await withTenantContext("firmA", (t) => mapDatasetAccount(t, { auditFirmId: "firmA", datasetAccountId: setup.da!.id, accountId: setup.acc2.id, basis: "AUDITOR_ASSERTED", mappedById: null }));
    expect(v1.version).toBe(1);
    expect(v2.version).toBe(2);

    const state = await withTenantContext("firmA", async (t) => {
      const mapping = await t.accountMapping.findUnique({ where: { auditFirmId_datasetAccountId: { auditFirmId: "firmA", datasetAccountId: setup.da!.id } }, select: { currentVersionId: true } });
      const versions = await t.accountMappingVersion.findMany({ where: { accountMappingId: v1.accountMappingId }, orderBy: { version: "asc" } });
      const mappings = await t.accountMapping.count({ where: { datasetAccountId: setup.da!.id } });
      return { mapping, versions, mappings };
    });
    expect(state.mappings).toBe(1); // one mapping per DatasetAccount
    expect(state.mapping?.currentVersionId).toBe(v2.currentVersionId); // pointer flipped
    expect(state.versions).toHaveLength(2);
    expect(state.versions[0]).toMatchObject({ version: 1, accountId: setup.acc1.id }); // history immutable
    expect(state.versions[0]!.supersededAt).not.toBeNull(); // v1 superseded
    expect(state.versions[1]!.supersededAt).toBeNull(); // v2 current

    // Master rename must NOT rewrite the source snapshot or the immutable line (test 12).
    await withTenantContext("firmA", (t) => t.account.update({ where: { id: setup.acc1.id }, data: { accountName: "Sales RENAMED" } }));
    const after = await withTenantContext("firmA", async (t) => ({
      da: await t.datasetAccount.findUnique({ where: { auditFirmId_id: { auditFirmId: "firmA", id: setup.da!.id } }, select: { sourceAccountName: true, sourceAccountCode: true } }),
      line: await t.journalLine.findUnique({ where: { auditFirmId_id: { auditFirmId: "firmA", id: setup.line!.id } }, select: { accountSnapshotId: true } }),
    }));
    expect(after.da?.sourceAccountCode).toBe("700100"); // snapshot unchanged
    expect(after.line?.accountSnapshotId).toBe(setup.line!.accountSnapshotId); // line still points at snapshot, no accountId embedded
  });
});
