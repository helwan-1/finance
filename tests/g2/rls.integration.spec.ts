/**
 * G2 RLS / Firm A ↔ Firm B isolation (Phase L) on the 9 new tables, as the
 * non-owner audit_app role. Gated by G2_DB_TEST.
 */
import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { withTenantContext } from "@/lib/db/tenant";

const run = process.env.G2_DB_TEST ? describe : describe.skip;

const G2_MODELS = [
  "sourceFile", "importProfile", "importMapping", "importMappingVersion",
  "importBatch", "importAttempt", "dataset", "importedRecord", "importIssue",
] as const;

run("G2 RLS tenant isolation (audit_app)", () => {
  afterAll(async () => { await prisma.$disconnect(); });

  it("no tenant context → every G2 table returns zero rows (fail-closed)", async () => {
    for (const m of G2_MODELS) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const n = await (prisma as any)[m].count();
      expect(n).toBe(0);
    }
  });

  it("a SourceFile created under Firm A is invisible to Firm B", async () => {
    const created = await withTenantContext("firmA", (t) =>
      t.sourceFile.create({
        data: {
          auditFirmId: "firmA", originalFileName: "rls.bin", mimeType: "application/octet-stream",
          sizeBytes: BigInt(3), sha256: "ab".repeat(32), storageProvider: "OBJECT_STORE",
          storageBucket: "firm-firmA", storageObjectKey: "ab".repeat(32), custodyStatus: "RETAINED",
        },
        select: { id: true },
      }),
    );
    const seenByA = await withTenantContext("firmA", (t) => t.sourceFile.findUnique({ where: { id: created.id } }));
    const seenByB = await withTenantContext("firmB", (t) => t.sourceFile.findUnique({ where: { id: created.id } }));
    expect(seenByA?.id).toBe(created.id);
    expect(seenByB).toBeNull();
  });

  it("cross-tenant INSERT is rejected by WITH CHECK", async () => {
    await expect(
      withTenantContext("firmB", (t) =>
        t.sourceFile.create({
          data: {
            auditFirmId: "firmA", originalFileName: "evil.bin", mimeType: "application/octet-stream",
            sizeBytes: BigInt(1), storageProvider: "NONE", custodyStatus: "NOT_RETAINED",
          },
        }),
      ),
    ).rejects.toThrow();
  });

  it("cross-tenant UPDATE / DELETE affect zero rows", async () => {
    const a = await withTenantContext("firmA", (t) =>
      t.sourceFile.create({
        data: {
          auditFirmId: "firmA", originalFileName: "a2.bin", mimeType: "application/octet-stream",
          sizeBytes: BigInt(1), storageProvider: "NONE", custodyStatus: "METADATA_ONLY",
        },
        select: { id: true },
      }),
    );
    const upd = await withTenantContext("firmB", (t) =>
      t.sourceFile.updateMany({ where: { id: a.id }, data: { originalFileName: "hacked" } }),
    );
    const del = await withTenantContext("firmB", (t) =>
      t.sourceFile.deleteMany({ where: { id: a.id } }),
    );
    expect(upd.count).toBe(0);
    expect(del.count).toBe(0);
    const still = await withTenantContext("firmA", (t) => t.sourceFile.findUnique({ where: { id: a.id }, select: { originalFileName: true } }));
    expect(still?.originalFileName).toBe("a2.bin");
  });
});
