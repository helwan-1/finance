/**
 * Live RLS tenant-isolation test (G1.11) against a real PostgreSQL database,
 * connecting as the NON-owner runtime role `audit_app`. Runs only when
 * G1_DB_TEST is set (so DB-less CI skips it). Requires the two-tenant seed
 * (firmA: anomA, anomA2 ; firmB: anomB) and DATABASE_URL → audit_app.
 */
import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { withTenantContext } from "@/lib/db/tenant";

const run = process.env.G1_DB_TEST ? describe : describe.skip;

run("RLS tenant isolation (runtime role audit_app)", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("fails closed: no tenant context → zero rows", async () => {
    const rows = await prisma.anomalyFlag.findMany();
    expect(rows).toHaveLength(0);
  });

  it("Firm A context sees only Firm A rows", async () => {
    const rows = await withTenantContext("firmA", (tx) =>
      tx.anomalyFlag.findMany(),
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.auditFirmId === "firmA")).toBe(true);
  });

  it("Firm B context sees only Firm B rows", async () => {
    const rows = await withTenantContext("firmB", (tx) =>
      tx.anomalyFlag.findMany(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.auditFirmId).toBe("firmB");
  });

  it("cross-tenant read by id is invisible (null)", async () => {
    const row = await withTenantContext("firmA", (tx) =>
      tx.anomalyFlag.findUnique({ where: { id: "anomB" } }),
    );
    expect(row).toBeNull();
  });

  it("cross-tenant UPDATE affects zero rows", async () => {
    const res = await withTenantContext("firmA", (tx) =>
      tx.anomalyFlag.updateMany({
        where: { id: "anomB" },
        data: { status: "DISMISSED" },
      }),
    );
    expect(res.count).toBe(0);
  });

  it("cross-tenant DELETE affects zero rows", async () => {
    const res = await withTenantContext("firmA", (tx) =>
      tx.anomalyFlag.deleteMany({ where: { id: "anomB" } }),
    );
    expect(res.count).toBe(0);
  });

  it("cross-tenant INSERT is rejected by WITH CHECK", async () => {
    await expect(
      withTenantContext("firmA", (tx) =>
        tx.anomalyFlag.create({
          data: {
            auditFirmId: "firmB",
            engagementId: "engB",
            ruleCode: "ROUND_AMOUNT",
            severity: "LOW",
            status: "OPEN",
            title: "x",
            titleAr: "x",
            description: "x",
            descriptionAr: "x",
            score: "10.00",
          },
        }),
      ),
    ).rejects.toThrow();
  });

  it("pooled-connection reuse: context does not leak after a prior tenant tx", async () => {
    await withTenantContext("firmA", (tx) => tx.anomalyFlag.findMany());
    // Same client/connection pool, no context now → must be zero again.
    const rows = await prisma.anomalyFlag.findMany();
    expect(rows).toHaveLength(0);
  });

  it("Firm B data survived the cross-tenant write attempts", async () => {
    const rows = await withTenantContext("firmB", (tx) =>
      tx.anomalyFlag.findMany(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("OPEN");
  });
});
