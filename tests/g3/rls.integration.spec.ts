/**
 * G3 RLS / tenant isolation on canonical tables, as audit_app. Gated by
 * G3_DB_TEST (test 16). Requires prior imports to have created firmA canonical
 * rows (run alongside the canonical suite) — the no-context / firmB checks hold
 * regardless.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { withTenantContext } from "@/lib/db/tenant";
import { ensureSeed } from "./_seed";

const run = process.env.G3_DB_TEST ? describe : describe.skip;

const CANON_MODELS = [
  "accountingScope", "account", "fiscalPeriod", "sourceAccountingContext",
  "datasetAccount", "journalEntry", "journalLine", "trialBalance",
  "trialBalanceRow", "accountMapping", "accountMappingVersion",
] as const;

run("G3 RLS tenant isolation (audit_app)", () => {
  beforeAll(async () => { await ensureSeed(); });
  afterAll(async () => { await prisma.$disconnect(); });

  it("no tenant context → every canonical table returns zero rows (fail-closed)", async () => {
    for (const m of CANON_MODELS) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const n = await (prisma as any)[m].count();
      expect(n).toBe(0);
    }
  });

  it("Firm B cannot see Firm A journal lines", async () => {
    const seenByB = await withTenantContext("firmB", (t) => t.journalLine.count());
    expect(seenByB).toBe(0);
  });

  it("cross-tenant INSERT is rejected by WITH CHECK", async () => {
    await expect(
      withTenantContext("firmB", (t) =>
        t.accountingScope.create({ data: { auditFirmId: "firmA", clientCompanyId: "clientA", key: "evil" } }),
      ),
    ).rejects.toThrow();
  });
});
