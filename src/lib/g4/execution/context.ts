import type { TenantTx } from "@/lib/db/tenant";
import { semanticScopeAnchor } from "@/lib/g4/semantic-identity";
import { resolveClientSemanticKey } from "@/lib/g4/run";
import { ConfigError } from "./errors";

export interface TestPin {
  auditRunTestVersionId: string; // relational join id (per-run pin)
  auditTestVersionId: string;
  testType: string;
  testKey: string; // semantic
  testVersion: number; // semantic
  testVersionHash: string; // semantic
  ruleVersionHash: string | null; // semantic (NULL unless RULE)
  definitionJson: unknown; // frozen immutable version definition
  effectiveParametersJson: unknown;
  effectiveParametersHash: string; // semantic
}

export interface DatasetPin {
  datasetId: string; // relational join id
  datasetHash: string; // semantic
  datasetKind: string;
}

export interface ExecutionContext {
  auditFirmId: string;
  runId: string;
  engagementId: string;
  clientCompanyId: string | null;
  preparationId: string; // AuditRun.freezeGeneration — the authoritative generation
  engineBuildVersion: string; // frozen on the run
  semanticScopeAnchor: string; // fingerprint input
  testPins: TestPin[];
  datasetPins: DatasetPin[];
}

/**
 * Frozen ExecutionContext (ADR: §14). Loaded EXCLUSIVELY from AuditRun and its
 * freezeGeneration authoritative rows. Never reads AuditTest.currentVersionId,
 * AccountMapping.currentVersion, `enabled`, or the legacy Transaction table.
 * Relational ids are exposed only for joins/locks; semantic identities feed the
 * fingerprints.
 */
export async function loadExecutionContext(tx: TenantTx, auditFirmId: string, runId: string): Promise<ExecutionContext> {
  const run = await tx.auditRun.findUnique({
    where: { id: runId },
    select: { id: true, engagementId: true, clientCompanyId: true, engineBuildVersion: true, freezeGeneration: true },
  });
  if (!run) throw new ConfigError("run not found in tenant");
  if (!run.freezeGeneration) throw new ConfigError("run has no authoritative frozen generation (freezeGeneration)");
  if (!run.engineBuildVersion) throw new ConfigError("run has no frozen engineBuildVersion");
  const preparationId = run.freezeGeneration;

  const firm = await tx.auditFirm.findUnique({ where: { id: auditFirmId }, select: { licenseNo: true } });
  const eng = await tx.auditEngagement.findUnique({ where: { id: run.engagementId }, select: { fiscalYear: true } });
  if (!firm || !eng) throw new ConfigError("firm/engagement not resolvable under tenant");
  const clientKey = run.clientCompanyId ? await resolveClientSemanticKey(tx, auditFirmId, run.clientCompanyId) : "g4ck:none";
  const anchor = semanticScopeAnchor({ firmLicenseNo: firm.licenseNo, clientSemanticKey: clientKey, fiscalYear: eng.fiscalYear });

  const artvs = await tx.auditRunTestVersion.findMany({
    where: { preparationId },
    orderBy: { orderIndex: "asc" },
    select: { id: true, auditTestVersionId: true, testType: true, auditRuleVersionId: true, effectiveParametersJson: true, effectiveParametersHash: true },
  });
  const testPins: TestPin[] = [];
  for (const a of artvs) {
    const tv = await tx.auditTestVersion.findUnique({
      where: { id: a.auditTestVersionId },
      select: { version: true, versionHash: true, definitionJson: true, auditTestId: true },
    });
    if (!tv) throw new ConfigError(`pinned test version missing: ${a.auditTestVersionId}`);
    const test = await tx.auditTest.findUnique({ where: { id: tv.auditTestId }, select: { key: true } });
    if (!test) throw new ConfigError("pinned test master missing");
    let ruleVersionHash: string | null = null;
    if (a.auditRuleVersionId) {
      const rv = await tx.auditRuleVersion.findUnique({ where: { id: a.auditRuleVersionId }, select: { ruleVersionHash: true } });
      ruleVersionHash = rv?.ruleVersionHash ?? null;
    }
    testPins.push({
      auditRunTestVersionId: a.id,
      auditTestVersionId: a.auditTestVersionId,
      testType: a.testType,
      testKey: test.key,
      testVersion: tv.version,
      testVersionHash: tv.versionHash,
      ruleVersionHash,
      definitionJson: tv.definitionJson,
      effectiveParametersJson: a.effectiveParametersJson,
      effectiveParametersHash: a.effectiveParametersHash,
    });
  }

  const datasets = await tx.auditRunDataset.findMany({
    where: { preparationId },
    orderBy: { orderIndex: "asc" },
    select: { datasetId: true, datasetHash: true, datasetKind: true },
  });
  const datasetPins: DatasetPin[] = datasets.map((d) => ({ datasetId: d.datasetId, datasetHash: d.datasetHash ?? "", datasetKind: d.datasetKind }));

  return {
    auditFirmId,
    runId: run.id,
    engagementId: run.engagementId,
    clientCompanyId: run.clientCompanyId,
    preparationId,
    engineBuildVersion: run.engineBuildVersion,
    semanticScopeAnchor: anchor,
    testPins,
    datasetPins,
  };
}
