/**
 * G4 Phase A — RLS tenant isolation + cross-tenant FK rejection (matrix F, G).
 * Gated by G4_DB_TEST. Runs as the non-owner audit_app role.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { withTenantContext } from "@/lib/db/tenant";
import { ensureSeed, seedDataset, seedRunGraph } from "./_seed";

const run = process.env.G4_DB_TEST ? describe : describe.skip;

const G4_MODELS = [
  "auditClientSemanticKey", "auditTest", "auditTestVersion", "auditRuleVersion",
  "auditRun", "auditRunPreparation", "auditRunPrepChunk", "auditRunDataset",
  "auditRunTestVersion", "auditRunAccountMappingPin", "auditRunScopeResolution",
  "auditRunScopeMember", "auditJob", "auditResult", "auditResultEvidence", "auditResultReview",
] as const;

run("G4 RLS tenant isolation (audit_app)", () => {
  beforeAll(async () => { await ensureSeed(); });
  afterAll(async () => { await prisma.$disconnect(); });

  it("no tenant context → every G4 table returns zero rows (fail-closed)", async () => {
    for (const m of G4_MODELS) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const n = await (prisma as any)[m].count();
      expect(n).toBe(0);
    }
  });

  it("an AuditRun created under Firm A is invisible to Firm B", async () => {
    const g = await seedRunGraph("firmA");
    const seenByA = await withTenantContext("firmA", (t) => t.auditRun.findUnique({ where: { id: g.runId } }));
    const seenByB = await withTenantContext("firmB", (t) => t.auditRun.findUnique({ where: { id: g.runId } }));
    expect(seenByA?.id).toBe(g.runId);
    expect(seenByB).toBeNull();
  });

  it("cross-tenant INSERT is rejected by WITH CHECK", async () => {
    await expect(
      withTenantContext("firmB", (t) =>
        t.auditTest.create({ data: { auditFirmId: "firmA", key: `evil-${Date.now()}`, name: "x", nameAr: "x", testType: "STATISTICAL" } }),
      ),
    ).rejects.toThrow();
  });

  it("cross-tenant FK rejection: Firm B run cannot pin Firm A's Dataset (test G)", async () => {
    const ds = await seedDataset(); // firmA dataset
    const gB = await seedRunGraph("firmB");
    await expect(
      withTenantContext("firmB", (t) =>
        t.auditRunDataset.create({
          data: {
            auditFirmId: "firmB", preparationId: gB.prepId, runId: gB.runId,
            datasetId: ds.datasetId, // belongs to firmA → composite tenant FK has no (firmB, datasetId) match
            datasetKind: "GENERAL_LEDGER", lineageClass: "VERIFIED", orderIndex: 0,
          },
        }),
      ),
    ).rejects.toThrow();
  });
});
