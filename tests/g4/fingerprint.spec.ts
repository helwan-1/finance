import { describe, it, expect } from "vitest";
import { configFingerprint, type ConfigFingerprintInput } from "@/lib/g4/fingerprint";

const base: ConfigFingerprintInput = {
  semanticScopeAnchor: "ANCHOR",
  datasetScope: [{ datasetHash: "DH1", datasetKind: "GENERAL_LEDGER", lineageClass: "VERIFIED" }],
  testPins: [{ testKey: "T1", version: 3, versionHash: "VH", ruleKey: "R1", ruleVersion: 2, ruleVersionHash: "RVH", effectiveParametersHash: "PH" }],
  scopeResolutions: [{ testKey: "T1", datasetHash: "DH1", eligibility: "ELIGIBLE", resolutionAlgorithmVersion: "g4res.1", eligiblePopulationFingerprint: "POP" }],
  consumedMappingSemanticHashes: ["MH1"],
  engineBuildVersion: "sha:abc",
  materialityVersionKey: null, riskModelVersionKey: null,
};

describe("G4 configFingerprint g4cfg.3 (matrix O, P)", () => {
  it("O: two independent runs over identical SEMANTIC config → identical fingerprint", () => {
    // Deep clone with different array identity / member order (mappings are a multiset).
    const other: ConfigFingerprintInput = {
      ...base,
      datasetScope: [...base.datasetScope],
      testPins: [...base.testPins],
      scopeResolutions: [...base.scopeResolutions],
      consumedMappingSemanticHashes: [...base.consumedMappingSemanticHashes],
    };
    expect(configFingerprint(base)).toBe(configFingerprint(other));
  });

  it("P: changing exactly one semantic input changes the fingerprint", () => {
    const f0 = configFingerprint(base);
    expect(configFingerprint({ ...base, datasetScope: [{ datasetHash: "DH2", datasetKind: "GENERAL_LEDGER", lineageClass: "VERIFIED" }] })).not.toBe(f0);
    expect(configFingerprint({ ...base, testPins: [{ ...base.testPins[0]!, versionHash: "VH2" }] })).not.toBe(f0);
    expect(configFingerprint({ ...base, testPins: [{ ...base.testPins[0]!, effectiveParametersHash: "PH2" }] })).not.toBe(f0);
    expect(configFingerprint({ ...base, scopeResolutions: [{ ...base.scopeResolutions[0]!, eligiblePopulationFingerprint: "POP2" }] })).not.toBe(f0);
    expect(configFingerprint({ ...base, consumedMappingSemanticHashes: ["MH2"] })).not.toBe(f0);
    expect(configFingerprint({ ...base, engineBuildVersion: "sha:def" })).not.toBe(f0);
  });

  it("mapping multiset order is not semantic; count is", () => {
    expect(configFingerprint({ ...base, consumedMappingSemanticHashes: ["a", "b"] })).toBe(configFingerprint({ ...base, consumedMappingSemanticHashes: ["b", "a"] }));
    expect(configFingerprint({ ...base, consumedMappingSemanticHashes: ["a"] })).not.toBe(configFingerprint({ ...base, consumedMappingSemanticHashes: ["a", "a"] }));
  });
});
