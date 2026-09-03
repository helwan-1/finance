import { describe, it, expect } from "vitest";
import { parseRoundConfig, parseDuplicateConfig, gcd, validatePositiveCanonicalDecimal } from "@/lib/g4/execution/statistical/config";
import { statPopulationIdentity, statAmountGroupIdentity } from "@/lib/g4/semantic-identity";

const ROUND_OK = { amountBasis: "TRANSACTION", methodVersion: "st.round.1", roundingQuantum: "100.000000", minimumPopulation: 5, minimumRoundCount: 1, rateThresholdNum: 1, rateThresholdDenom: 5 };
const DUP_OK = { amountBasis: "TRANSACTION", methodVersion: "st.dupamt.1", minimumOccurrenceCount: 2 };

describe("C3 config — ROUND validation (unit)", () => {
  it("accepts a valid frozen config", () => { expect(parseRoundConfig(ROUND_OK).roundingQuantum).toBe("100.000000"); });

  it("rejects wrong amountBasis / methodVersion", () => {
    expect(() => parseRoundConfig({ ...ROUND_OK, amountBasis: "FUNCTIONAL" })).toThrow(/amountBasis/);
    expect(() => parseRoundConfig({ ...ROUND_OK, methodVersion: "st.round.2" })).toThrow(/methodVersion/);
  });

  it("15/16: rejects unreduced 20/100, accepts reduced 1/5", () => {
    expect(() => parseRoundConfig({ ...ROUND_OK, rateThresholdNum: 20, rateThresholdDenom: 100 })).toThrow(/reduced/);
    expect(parseRoundConfig({ ...ROUND_OK, rateThresholdNum: 1, rateThresholdDenom: 5 }).rateThresholdNum).toBe(1);
  });

  it("17: rejects Num > Denom (impossible rate)", () => {
    expect(() => parseRoundConfig({ ...ROUND_OK, rateThresholdNum: 6, rateThresholdDenom: 5 })).toThrow(/impossible/);
  });

  it("accepts Num == Denom (100%) when reduced (1/1)", () => {
    expect(parseRoundConfig({ ...ROUND_OK, rateThresholdNum: 1, rateThresholdDenom: 1 }).rateThresholdDenom).toBe(1);
  });

  it("rate numerator 0 must be expressed as 0/1", () => {
    expect(parseRoundConfig({ ...ROUND_OK, rateThresholdNum: 0, rateThresholdDenom: 1 }).rateThresholdNum).toBe(0);
    expect(() => parseRoundConfig({ ...ROUND_OK, rateThresholdNum: 0, rateThresholdDenom: 5 })).toThrow(/reduced/);
  });

  it("18: rejects quantum <= 0", () => {
    expect(() => parseRoundConfig({ ...ROUND_OK, roundingQuantum: "0" })).toThrow(/> 0/);
    expect(() => parseRoundConfig({ ...ROUND_OK, roundingQuantum: "0.000000" })).toThrow(/> 0/);
  });

  it("19: rejects exponent notation", () => {
    expect(() => parseRoundConfig({ ...ROUND_OK, roundingQuantum: "1e2" })).toThrow(/canonical/);
  });

  it("20: rejects over-scale quantum (> 6 dp)", () => {
    expect(() => parseRoundConfig({ ...ROUND_OK, roundingQuantum: "1.0000001" })).toThrow(/scale/);
  });

  it("rejects negative / NaN / Infinity / non-string quantum", () => {
    expect(() => parseRoundConfig({ ...ROUND_OK, roundingQuantum: "-100" })).toThrow(/canonical/);
    expect(() => parseRoundConfig({ ...ROUND_OK, roundingQuantum: "NaN" })).toThrow(/canonical/);
    expect(() => parseRoundConfig({ ...ROUND_OK, roundingQuantum: "Infinity" })).toThrow(/canonical/);
    expect(() => parseRoundConfig({ ...ROUND_OK, roundingQuantum: 100 })).toThrow(/canonical decimal string/);
  });

  it("rejects precision > 24", () => {
    expect(() => parseRoundConfig({ ...ROUND_OK, roundingQuantum: "1234567890123456789.000000" })).toThrow(/precision/);
  });

  it("rejects minimumPopulation < 1 and non-integer", () => {
    expect(() => parseRoundConfig({ ...ROUND_OK, minimumPopulation: 0 })).toThrow(/minimumPopulation must be >= 1/);
    expect(() => parseRoundConfig({ ...ROUND_OK, minimumPopulation: 1.5 })).toThrow(/integer/);
  });

  it("rejects minimumRoundCount < 1", () => {
    expect(() => parseRoundConfig({ ...ROUND_OK, minimumRoundCount: 0 })).toThrow(/minimumRoundCount must be >= 1/);
  });

  it("rejects denom <= 0 and non-integer num", () => {
    expect(() => parseRoundConfig({ ...ROUND_OK, rateThresholdDenom: 0 })).toThrow(/Denom must be > 0/);
    expect(() => parseRoundConfig({ ...ROUND_OK, rateThresholdNum: 1.2 })).toThrow(/integer/);
  });
});

describe("C3 config — DUPLICATE validation (unit)", () => {
  it("accepts valid config", () => { expect(parseDuplicateConfig(DUP_OK).minimumOccurrenceCount).toBe(2); });
  it("rejects wrong amountBasis / methodVersion", () => {
    expect(() => parseDuplicateConfig({ ...DUP_OK, amountBasis: "FUNCTIONAL" })).toThrow(/amountBasis/);
    expect(() => parseDuplicateConfig({ ...DUP_OK, methodVersion: "st.dupamt.2" })).toThrow(/methodVersion/);
  });
  it("rejects minimumOccurrenceCount < 2 and non-integer", () => {
    expect(() => parseDuplicateConfig({ ...DUP_OK, minimumOccurrenceCount: 1 })).toThrow(/>= 2/);
    expect(() => parseDuplicateConfig({ ...DUP_OK, minimumOccurrenceCount: 2.5 })).toThrow(/integer/);
  });
  it("ignores any stray minimumPopulation (never inferred/accepted as authoritative)", () => {
    const cfg = parseDuplicateConfig({ ...DUP_OK, minimumPopulation: 999 } as object);
    expect((cfg as unknown as { minimumPopulation?: number }).minimumPopulation).toBeUndefined();
  });
});

describe("C3 gcd (unit)", () => {
  it("computes gcd, with gcd(0,n)=n", () => {
    expect(gcd(20, 100)).toBe(20);
    expect(gcd(1, 5)).toBe(1);
    expect(gcd(0, 1)).toBe(1);
    expect(gcd(0, 7)).toBe(7);
    expect(gcd(6, 4)).toBe(2);
  });
});

describe("C3 canonical decimal (unit)", () => {
  it("returns the frozen string byte-identical when valid", () => {
    expect(validatePositiveCanonicalDecimal("50.500000", "q")).toBe("50.500000");
    expect(validatePositiveCanonicalDecimal("1", "q")).toBe("1");
  });
});

describe("C3 scope-aware identity (unit)", () => {
  const base = { datasetHash: "DH", currency: "SAR", amountBasis: "TRANSACTION", methodVersion: "st.round.1", eligiblePopulationFingerprint: "POP1" };

  it("statPopulationIdentity is deterministic", () => {
    expect(statPopulationIdentity(base)).toBe(statPopulationIdentity({ ...base }));
  });
  it("different currency → different identity (SAR vs sar distinct)", () => {
    expect(statPopulationIdentity(base)).not.toBe(statPopulationIdentity({ ...base, currency: "sar" }));
  });
  it("different frozen scope (population fingerprint) → different identity, same dataset+currency", () => {
    expect(statPopulationIdentity(base)).not.toBe(statPopulationIdentity({ ...base, eligiblePopulationFingerprint: "POP2" }));
  });
  it("different datasetHash → different identity", () => {
    expect(statPopulationIdentity(base)).not.toBe(statPopulationIdentity({ ...base, datasetHash: "DH2" }));
  });
  it("group identity distinguishes the scalar amount", () => {
    const g = { ...base, methodVersion: "st.dupamt.1", scalarAmount: "10.000000" };
    expect(statAmountGroupIdentity(g)).toBe(statAmountGroupIdentity({ ...g }));
    expect(statAmountGroupIdentity(g)).not.toBe(statAmountGroupIdentity({ ...g, scalarAmount: "20.000000" }));
  });
  it("population and group identities never collide (distinct format tags)", () => {
    expect(statPopulationIdentity(base)).not.toBe(
      statAmountGroupIdentity({ ...base, scalarAmount: "10.000000" }),
    );
  });
});
