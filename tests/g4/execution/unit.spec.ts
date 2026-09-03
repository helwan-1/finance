import { describe, it, expect } from "vitest";
import { canonicalize, dec, toFrame, toJson } from "@/lib/g4/execution/canonical";
import { resultOccurrenceFingerprint, resultSemanticFingerprint } from "@/lib/g4/execution/result-fingerprint";
import { MAX_UNIT_TX_TIME_MS } from "@/lib/g4/execution/unit-tx";
import { LEASE_TTL_MS, HEARTBEAT_INTERVAL_MS } from "@/lib/g4/execution/job";
import { hashHex } from "@/lib/g4/framing";

const H = (b: Buffer) => hashHex(b);

describe("C1 canonical result payload (matrix 20, 21)", () => {
  it("object key order is not semantic (frame + json stable)", () => {
    const a = canonicalize({ b: 2, a: 1 });
    const b = canonicalize({ a: 1, b: 2 });
    expect(H(toFrame(a))).toBe(H(toFrame(b)));
    expect(JSON.stringify(toJson(a))).toBe(JSON.stringify(toJson(b)));
  });
  it("distinct semantic types never collide", () => {
    const frames = [
      toFrame(canonicalize(null)), toFrame(canonicalize(true)), toFrame(canonicalize(1)),
      toFrame(dec("1")), toFrame(canonicalize("1")), toFrame(canonicalize([1])),
    ].map(H);
    expect(new Set(frames).size).toBe(frames.length);
  });
  it("raw non-integer / NaN / Infinity rejected; decimals require dec()", () => {
    expect(() => canonicalize(1.5)).toThrow(/non-integer/);
    expect(() => canonicalize(Number.NaN)).toThrow();
    expect(() => canonicalize(Number.POSITIVE_INFINITY)).toThrow();
    expect(() => dec("1.2.3")).toThrow();
    expect(toJson(dec("12.00"))).toBe("12.00"); // preserved as string, never a float
  });
  it("null != empty string in payload frame", () => {
    expect(H(toFrame(canonicalize(null)))).not.toBe(H(toFrame(canonicalize(""))));
  });
});

describe("C1 g4occ.2 (matrix 17, 18)", () => {
  const base = { runId: "R1", auditRunTestVersionId: "ARTV1", resultCode: "DQ_POPULATION_MEMBER", evidenceEOIsOrdered: ["eoiA"] };
  it("same inputs → same (retry stability)", () => {
    expect(resultOccurrenceFingerprint(base)).toBe(resultOccurrenceFingerprint({ ...base }));
  });
  it("different evidence EOI (distinct sourceRowNo) → different occurrence", () => {
    expect(resultOccurrenceFingerprint({ ...base, evidenceEOIsOrdered: ["eoiA"] }))
      .not.toBe(resultOccurrenceFingerprint({ ...base, evidenceEOIsOrdered: ["eoiB"] }));
  });
  it("evidence order and multiplicity are semantic", () => {
    expect(resultOccurrenceFingerprint({ ...base, evidenceEOIsOrdered: ["a", "b"] }))
      .not.toBe(resultOccurrenceFingerprint({ ...base, evidenceEOIsOrdered: ["b", "a"] }));
    expect(resultOccurrenceFingerprint({ ...base, evidenceEOIsOrdered: ["a"] }))
      .not.toBe(resultOccurrenceFingerprint({ ...base, evidenceEOIsOrdered: ["a", "a"] }));
  });
  it("different run → different occurrence (run-local)", () => {
    expect(resultOccurrenceFingerprint(base)).not.toBe(resultOccurrenceFingerprint({ ...base, runId: "R2" }));
  });
});

describe("C1 g4sem.3 (matrix 13, 19)", () => {
  const base = {
    semanticScopeAnchor: "ANCHOR", testKey: "T1", testVersion: 1, testVersionHash: "VH",
    ruleVersionHash: null as string | null, effectiveParametersHash: "PH",
    consumedMappingSemanticHashes: [] as string[], resultCode: "DQ_POPULATION_MEMBER",
    evidenceEOIsOrdered: ["eoiA"], payload: canonicalize({ sourceRowNo: 10, contentHash: "H" }),
  };
  it("cross-run/re-import: same semantic inputs → same (no runId inside)", () => {
    expect(resultSemanticFingerprint(base)).toBe(resultSemanticFingerprint({ ...base }));
  });
  it("distinct occurrence (different EOI) → different semantic fingerprint", () => {
    expect(resultSemanticFingerprint(base)).not.toBe(resultSemanticFingerprint({ ...base, evidenceEOIsOrdered: ["eoiB"] }));
  });
  it("changing any semantic input changes it", () => {
    const f0 = resultSemanticFingerprint(base);
    expect(resultSemanticFingerprint({ ...base, semanticScopeAnchor: "X" })).not.toBe(f0);
    expect(resultSemanticFingerprint({ ...base, testVersionHash: "VH2" })).not.toBe(f0);
    expect(resultSemanticFingerprint({ ...base, effectiveParametersHash: "PH2" })).not.toBe(f0);
    expect(resultSemanticFingerprint({ ...base, resultCode: "OTHER" })).not.toBe(f0);
    expect(resultSemanticFingerprint({ ...base, payload: canonicalize({ sourceRowNo: 11, contentHash: "H" }) })).not.toBe(f0);
    expect(resultSemanticFingerprint({ ...base, consumedMappingSemanticHashes: ["m"] })).not.toBe(f0);
  });
});

describe("C1 lease/timeout config invariant (matrix D1-T6)", () => {
  it("MAX_UNIT_TX_TIME < HEARTBEAT_INTERVAL < LEASE_TTL", () => {
    expect(MAX_UNIT_TX_TIME_MS).toBeLessThan(HEARTBEAT_INTERVAL_MS);
    expect(HEARTBEAT_INTERVAL_MS).toBeLessThan(LEASE_TTL_MS);
  });
});
