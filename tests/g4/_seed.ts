import { randomUUID } from "node:crypto";
import { withTenantContext } from "@/lib/db/tenant";
import { startImport, confirmImport } from "@/lib/import/pipeline";
import { ensureSeed as ensureG3Seed } from "../g3/_seed";

/** Ensure firmA/firmB/engA/clientA exist (reuses the G3 seed) + firmB client/engagement. */
export async function ensureSeed(): Promise<void> {
  await ensureG3Seed();
  await withTenantContext("firmB", async (t) => {
    await t.clientCompany.upsert({
      where: { id: "clientB" }, update: {},
      create: { id: "clientB", auditFirmId: "firmB", name: "Client B", nameAr: "عميل ب" },
    });
    await t.auditEngagement.upsert({
      where: { id: "engB" }, update: {},
      create: {
        id: "engB", auditFirmId: "firmB", clientCompanyId: "clientB",
        title: "Eng B", titleAr: "ب", fiscalYear: 2024,
        periodStart: new Date("2024-01-01"), periodEnd: new Date("2024-12-31"), currency: "SAR",
      },
    });
  });
}

/** Import a tiny GL so a real Dataset + JournalLine + ImportedRecord exist in firmA. */
export async function seedDataset(): Promise<{ datasetId: string; journalLineId: string; importedRecordId: string }> {
  const nonce = randomUUID();
  const csv = "account,date,debit,currency\n" + `900900,2024-10-01,12.00,USD ${nonce}\n`;
  const start = await startImport({
    auditFirmId: "firmA", userId: null, engagementId: "engA",
    datasetKind: "GENERAL_LEDGER", fileName: `g4-${nonce}.csv`, mimeType: "text/csv",
    bytes: Buffer.from(csv, "utf8"), idempotencyKey: `g4-seed-${nonce}`, acknowledgeDuplicate: true,
  });
  await confirmImport("firmA", null, start.batchId!);
  const ids = await withTenantContext("firmA", async (t) => {
    const jl = await t.journalLine.findFirst({ where: { datasetId: start.datasetId! }, select: { id: true, importedRecordId: true } });
    return { journalLineId: jl!.id, importedRecordId: jl!.importedRecordId };
  });
  return { datasetId: start.datasetId!, ...ids };
}

/** Minimal run graph in `firm`: Test → TestVersion(STATISTICAL) → Run(DRAFT) → Preparation(gen1) → RunTestVersion → Result. */
export async function seedRunGraph(firm: string) {
  const n = randomUUID();
  return withTenantContext(firm, async (t) => {
    const test = await t.auditTest.create({ data: { auditFirmId: firm, key: `T-${n}`, name: "t", nameAr: "ت", testType: "STATISTICAL" }, select: { id: true } });
    const tv = await t.auditTestVersion.create({ data: { auditFirmId: firm, auditTestId: test.id, version: 1, testType: "STATISTICAL", definitionJson: {}, requirementsJson: {}, versionHash: `vh-${n}` }, select: { id: true } });
    const run = await t.auditRun.create({ data: { auditFirmId: firm, engagementId: firm === "firmA" ? "engA" : "engB", status: "DRAFT" }, select: { id: true } });
    const prep = await t.auditRunPreparation.create({ data: { auditFirmId: firm, runId: run.id, generationNo: 1, status: "PREPARING" }, select: { id: true } });
    const rtv = await t.auditRunTestVersion.create({ data: { auditFirmId: firm, preparationId: prep.id, runId: run.id, auditTestVersionId: tv.id, testType: "STATISTICAL", effectiveParametersJson: {}, effectiveParametersHash: `ph-${n}`, orderIndex: 0 }, select: { id: true } });
    const result = await t.auditResult.create({ data: { auditFirmId: firm, runId: run.id, auditRunTestVersionId: rtv.id, resultKind: "ANOMALY", resultCode: "TEST", severity: "MEDIUM", score: "50.00", payloadJson: {}, resultOccurrenceFingerprint: `occ-${n}`, resultSemanticFingerprint: `sem-${n}` }, select: { id: true } });
    return { testId: test.id, testVersionId: tv.id, runId: run.id, prepId: prep.id, runTestVersionId: rtv.id, resultId: result.id, nonce: n };
  });
}
