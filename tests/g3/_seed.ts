import { withTenantContext } from "@/lib/db/tenant";

/** Idempotent seed of firmA (+client+engagement) and firmB for G3 DB tests. */
export async function ensureSeed(): Promise<void> {
  await withTenantContext("firmA", async (t) => {
    await t.auditFirm.upsert({
      where: { id: "firmA" }, update: {},
      create: { id: "firmA", name: "Firm A", nameAr: "شركة أ", licenseNo: "LIC-A" },
    });
    await t.clientCompany.upsert({
      where: { id: "clientA" }, update: {},
      create: { id: "clientA", auditFirmId: "firmA", name: "Client A", nameAr: "عميل أ", vatNumber: "300000000000003" },
    });
    await t.auditEngagement.upsert({
      where: { id: "engA" }, update: {},
      create: {
        id: "engA", auditFirmId: "firmA", clientCompanyId: "clientA",
        title: "Eng A", titleAr: "ارتباط أ", fiscalYear: 2024,
        periodStart: new Date("2024-01-01"), periodEnd: new Date("2024-12-31"), currency: "SAR",
      },
    });
  });
  await withTenantContext("firmB", async (t) => {
    await t.auditFirm.upsert({
      where: { id: "firmB" }, update: {},
      create: { id: "firmB", name: "Firm B", nameAr: "شركة ب", licenseNo: "LIC-B" },
    });
  });
}
