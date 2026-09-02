import { withTenantContext } from "@/lib/db/tenant";
import { getAttestableEngineBuildVersion } from "./engine-build";
import { resolveClientSemanticKey } from "./run";
import { semanticScopeAnchor } from "./semantic-identity";
import { configFingerprint, type CfgTestPin, type CfgDatasetScope, type CfgScopeResolution } from "./fingerprint";

const FREEZE_FORMAT_VERSION = "g4.1";

/**
 * Stage B — short ATOMIC publish/freeze. Does NOT rescan the population: it
 * reads only the bounded generation-scoped facts (datasets, test pins, scope
 * resolutions with their sealed population fingerprints, mapping pins). Policy B:
 * the versions the generation pinned remain authoritative regardless of any
 * currentVersion pointer movement. All-or-nothing; the run becomes QUEUED and
 * the generation authoritative + PUBLISHED. No AuditJob is started.
 */
export async function publishRun(auditFirmId: string, runId: string, prepId: string): Promise<{ configFingerprint: string; engineBuildVersion: string }> {
  // B1: an attestable, build-specific identity is required to freeze a QUEUED
  // reproducible run — in every environment. Fail-closed before touching state.
  const engineBuildVersion = getAttestableEngineBuildVersion();

  return withTenantContext(auditFirmId, async (tx) => {
    // 1. Lock the run row (serialize concurrent publish attempts).
    await tx.$queryRaw`SELECT "id" FROM "audit_runs" WHERE "id" = ${runId} FOR UPDATE`;

    // 2. Run must be DRAFT/PREPARING.
    const run = await tx.auditRun.findUnique({ where: { id: runId }, select: { id: true, status: true, engagementId: true, clientCompanyId: true, freezeGeneration: true } });
    if (!run) throw new Error("run not found in tenant");
    if (run.status !== "DRAFT" && run.status !== "PREPARING") throw new Error(`run not publishable (status=${run.status})`);
    if (run.freezeGeneration) throw new Error("run already has an authoritative generation");

    // 3/4. Exactly one COMPLETE generation, belonging to this run/tenant.
    const prep = await tx.auditRunPreparation.findUnique({ where: { id: prepId }, select: { id: true, runId: true, status: true, preparationManifestHash: true, engineBuildVersionCandidate: true } });
    if (!prep) throw new Error("preparation not found in tenant");
    if (prep.runId !== runId) throw new Error("preparation belongs to a different run");
    if (prep.status !== "COMPLETE") throw new Error(`preparation not publishable (status=${prep.status})`);
    // 5. Sealed manifest present.
    if (!prep.preparationManifestHash) throw new Error("preparation not sealed (no manifest)");
    if (prep.engineBuildVersionCandidate && prep.engineBuildVersionCandidate !== engineBuildVersion) {
      throw new Error("engine build changed since preparation seal");
    }

    // Assemble SEMANTIC config inputs from the bounded generation facts.
    const eng = await tx.auditEngagement.findUnique({ where: { id: run.engagementId }, select: { fiscalYear: true, clientCompanyId: true } });
    const firm = await tx.auditFirm.findUnique({ where: { id: auditFirmId }, select: { licenseNo: true } });
    const clientKey = run.clientCompanyId ? await resolveClientSemanticKey(tx, auditFirmId, run.clientCompanyId) : "g4ck:none";
    const anchor = semanticScopeAnchor({ firmLicenseNo: firm!.licenseNo, clientSemanticKey: clientKey, fiscalYear: eng!.fiscalYear });

    const runDatasets = await tx.auditRunDataset.findMany({ where: { preparationId: prepId }, select: { datasetId: true, datasetHash: true, datasetKind: true, lineageClass: true } });
    const datasetScope: CfgDatasetScope[] = runDatasets.map((d) => ({ datasetHash: d.datasetHash ?? "", datasetKind: d.datasetKind, lineageClass: d.lineageClass }));
    const dsHashById = new Map(runDatasets.map((d) => [d.datasetId, d.datasetHash ?? ""]));

    const runTVs = await tx.auditRunTestVersion.findMany({ where: { preparationId: prepId }, select: { auditTestVersionId: true, auditRuleVersionId: true, effectiveParametersHash: true } });
    const testPins: CfgTestPin[] = [];
    const testKeyByTV = new Map<string, string>();
    for (const rtv of runTVs) {
      const tv = await tx.auditTestVersion.findUnique({ where: { id: rtv.auditTestVersionId }, select: { version: true, versionHash: true, auditTestId: true } });
      const test = await tx.auditTest.findUnique({ where: { id: tv!.auditTestId }, select: { key: true } });
      let ruleKey: string | null = null, ruleVersion: number | null = null, ruleVersionHash: string | null = null;
      if (rtv.auditRuleVersionId) {
        const rv = await tx.auditRuleVersion.findUnique({ where: { id: rtv.auditRuleVersionId }, select: { version: true, ruleVersionHash: true, auditRuleId: true } });
        const rule = await tx.auditRule.findUnique({ where: { id: rv!.auditRuleId }, select: { key: true } });
        ruleKey = rule?.key ?? null; ruleVersion = rv!.version; ruleVersionHash = rv!.ruleVersionHash;
      }
      testKeyByTV.set(rtv.auditTestVersionId, test!.key);
      testPins.push({ testKey: test!.key, version: tv!.version, versionHash: tv!.versionHash, ruleKey, ruleVersion, ruleVersionHash, effectiveParametersHash: rtv.effectiveParametersHash });
    }

    const runRes = await tx.auditRunScopeResolution.findMany({ where: { preparationId: prepId }, select: { auditTestVersionId: true, datasetId: true, eligibility: true, resolutionAlgorithmVersion: true, eligiblePopulationFingerprint: true } });
    const scopeResolutions: CfgScopeResolution[] = runRes.map((r) => ({
      testKey: testKeyByTV.get(r.auditTestVersionId) ?? r.auditTestVersionId,
      datasetHash: dsHashById.get(r.datasetId) ?? "",
      eligibility: r.eligibility, resolutionAlgorithmVersion: r.resolutionAlgorithmVersion, eligiblePopulationFingerprint: r.eligiblePopulationFingerprint,
    }));

    const mappingPins = await tx.auditRunAccountMappingPin.findMany({ where: { preparationId: prepId }, select: { mappingSemanticHash: true } });

    // 7. Compute the semantic config fingerprint.
    const cfg = configFingerprint({
      semanticScopeAnchor: anchor, datasetScope, testPins, scopeResolutions,
      consumedMappingSemanticHashes: mappingPins.map((m) => m.mappingSemanticHash),
      engineBuildVersion, materialityVersionKey: null, riskModelVersionKey: null,
    });

    // 8/9/10. Atomically freeze + publish + QUEUE.
    await tx.auditRunPreparation.update({ where: { id: prepId }, data: { status: "PUBLISHED" } });
    await tx.auditRun.update({
      where: { id: runId },
      data: { freezeGeneration: prepId, engineBuildVersion, configFingerprint: cfg, freezeFormatVersion: FREEZE_FORMAT_VERSION, frozenAt: new Date(), status: "QUEUED" },
    });
    return { configFingerprint: cfg, engineBuildVersion };
  });
}
