/**
 * G4-DEBT-011 — restored G2 composite tenant FKs (defense in depth).
 * Gated by G4_DB_TEST. Proves the restored FKs reject cross-tenant references
 * BOTH under RLS (audit_app) AND under an owner connection where RLS is bypassed
 * — the layer that was silently missing and that RLS previously masked.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withTenantContext } from "@/lib/db/tenant";
import { startImport, confirmImport } from "@/lib/import/pipeline";
import { ensureSeed } from "./_seed";

const run = process.env.G4_DB_TEST ? describe : describe.skip;

// Owner connection (table owner ⇒ RLS ENABLE not FORCE ⇒ RLS bypassed).
const owner = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_DATABASE_URL } } });

async function importDataset(firm: string, eng: string) {
  const n = randomUUID();
  // BANK kind: creates a Dataset + ImportedRecords (enough for the FK test) but
  // NO canonical journal lines, so it never pollutes firm-scoped journal counts.
  const start = await startImport({
    auditFirmId: firm, userId: null, engagementId: eng,
    datasetKind: "BANK", fileName: `d11-${n}.csv`, mimeType: "text/csv",
    bytes: Buffer.from(`transaction date,amount,currency\n2024-01-01,1.00,USD ${n}\n`, "utf8"),
    idempotencyKey: `d11-${firm}-${n}`, acknowledgeDuplicate: true,
  });
  await confirmImport(firm, null, start.batchId!);
  const batchId = await withTenantContext(firm, (t) => t.dataset.findUnique({ where: { id: start.datasetId! }, select: { importBatchId: true } }));
  return { datasetId: start.datasetId!, importBatchId: batchId!.importBatchId };
}

run("G4-DEBT-011 restored G2 tenant FKs", () => {
  beforeAll(async () => { await ensureSeed(); });
  afterAll(async () => { await prisma.$disconnect(); await owner.$disconnect(); });

  it("C: fresh deploy contains the named restored constraints", async () => {
    const rows = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*)::bigint AS n FROM pg_constraint
      WHERE conname IN ('ir_ds_tfkey','ir_sf_tfkey','ds_batch_tfkey','ib_sf_tfkey','tx_ds_tfkey','imv_mapping_tfkey')`;
    expect(Number(rows[0]!.n)).toBe(6);
  });

  it("A: under RLS (audit_app), a Firm A ImportedRecord cannot reference a Firm B Dataset", async () => {
    const a = await importDataset("firmA", "engA");
    const b = await importDataset("firmB", "engB");
    // firmA context: RLS WITH CHECK allows auditFirmId='firmA', but ir_ds_tfkey
    // (auditFirmId, datasetId) → datasets has no (firmA, <firmB dataset>) row.
    await expect(
      withTenantContext("firmA", (t) => t.$executeRaw`
        INSERT INTO "imported_records"("id","auditFirmId","datasetId","importBatchId","sourceRowNo","rawCells","rawHash","status")
        VALUES (${"ir_x_" + randomUUID()}, 'firmA', ${b.datasetId}, ${a.importBatchId}, 999, '[]'::jsonb, 'h', 'ACCEPTED')`),
    ).rejects.toThrow(/foreign key|violates/i);
  });

  it("B: under OWNER (RLS bypassed), the same cross-tenant reference is STILL rejected by the composite tenant FK", async () => {
    const a = await importDataset("firmA", "engA");
    const b = await importDataset("firmB", "engB");
    // Prove the owner connection actually bypasses RLS: it can see both firms' datasets.
    const seen = await owner.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM "datasets" WHERE "id" IN (${a.datasetId}, ${b.datasetId})`;
    expect(Number(seen[0]!.n)).toBe(2); // RLS bypassed → both visible
    // Yet the composite tenant FK still forbids the cross-tenant child (defense in depth).
    await expect(
      owner.$executeRaw`
        INSERT INTO "imported_records"("id","auditFirmId","datasetId","importBatchId","sourceRowNo","rawCells","rawHash","status")
        VALUES (${"ir_o_" + randomUUID()}, 'firmA', ${b.datasetId}, ${a.importBatchId}, 998, '[]'::jsonb, 'h', 'ACCEPTED')`,
    ).rejects.toThrow(/foreign key|violates/i);
  });
});
