import { fingerprint, seq, fields, multiset, str, int } from "./framing";

/**
 * Config fingerprint (g4cfg.3 / ADR-G4-05, C9). Deterministic over SEMANTIC
 * identities only — never a runId, datasetId, version row PK, or timestamp — so
 * two runs over the same evidence + configuration share a fingerprint across
 * runs, deployments, and DB restores. PKs stay in FK columns, not here.
 */
export interface CfgTestPin {
  testKey: string;
  version: number;
  versionHash: string;
  ruleKey: string | null;
  ruleVersion: number | null;
  ruleVersionHash: string | null;
  effectiveParametersHash: string;
}
export interface CfgDatasetScope {
  datasetHash: string;
  datasetKind: string;
  lineageClass: string;
}
export interface CfgScopeResolution {
  testKey: string;
  datasetHash: string;
  eligibility: string;
  resolutionAlgorithmVersion: string;
  eligiblePopulationFingerprint: string | null;
}
export interface ConfigFingerprintInput {
  semanticScopeAnchor: string;
  datasetScope: CfgDatasetScope[];
  testPins: CfgTestPin[];
  scopeResolutions: CfgScopeResolution[];
  consumedMappingSemanticHashes: string[];
  engineBuildVersion: string;
  materialityVersionKey?: string | null; // reserved, NULL in G4
  riskModelVersionKey?: string | null;   // reserved, NULL in G4
}

const byDatasetHash = (a: CfgDatasetScope, b: CfgDatasetScope) => (a.datasetHash < b.datasetHash ? -1 : a.datasetHash > b.datasetHash ? 1 : 0);
const byTestKey = (a: CfgTestPin, b: CfgTestPin) => (a.testKey < b.testKey ? -1 : a.testKey > b.testKey ? 1 : 0);
const byResolution = (a: CfgScopeResolution, b: CfgScopeResolution) =>
  a.testKey < b.testKey ? -1 : a.testKey > b.testKey ? 1 : a.datasetHash < b.datasetHash ? -1 : a.datasetHash > b.datasetHash ? 1 : 0;

export function configFingerprint(inp: ConfigFingerprintInput): string {
  const datasets = seq([...inp.datasetScope].sort(byDatasetHash).map((d) =>
    fields([["datasetHash", str(d.datasetHash)], ["datasetKind", str(d.datasetKind)], ["lineageClass", str(d.lineageClass)]])));

  const tests = seq([...inp.testPins].sort(byTestKey).map((t) =>
    fields([
      ["testKey", str(t.testKey)], ["version", int(t.version)], ["versionHash", str(t.versionHash)],
      ["ruleKey", str(t.ruleKey)], ["ruleVersion", t.ruleVersion === null ? str(null) : int(t.ruleVersion)],
      ["ruleVersionHash", str(t.ruleVersionHash)], ["effectiveParametersHash", str(t.effectiveParametersHash)],
    ])));

  const resolutions = seq([...inp.scopeResolutions].sort(byResolution).map((r) =>
    fields([
      ["testKey", str(r.testKey)], ["datasetHash", str(r.datasetHash)], ["eligibility", str(r.eligibility)],
      ["resolutionAlgorithmVersion", str(r.resolutionAlgorithmVersion)],
      ["eligiblePopulationFingerprint", str(r.eligiblePopulationFingerprint)],
    ])));

  const mappings = multiset(inp.consumedMappingSemanticHashes.map((h) => str(h)));

  return fingerprint("g4cfg.3", fields([
    ["semanticScopeAnchor", str(inp.semanticScopeAnchor)],
    ["datasetScope", datasets],
    ["testPins", tests],
    ["scopeResolutions", resolutions],
    ["consumedMappings", mappings],
    ["engineBuildVersion", str(inp.engineBuildVersion)],
    ["materialityVersionKey", str(inp.materialityVersionKey ?? null)],
    ["riskModelVersionKey", str(inp.riskModelVersionKey ?? null)],
  ]));
}
