import { describe, it, expect } from "vitest";
import { matterCorrelationKey, membershipFingerprint, findingContentHash, type FindingContent } from "@/lib/g5/fingerprints";

const C = (o: Partial<FindingContent> = {}): FindingContent => ({
  category: "FS_MISSTATEMENT", condition: "c", criteria: "cr", cause: "ca", effect: "e",
  auditorConclusion: "concl", recommendation: null,
  observedAmount: null, observedCurrency: null, estimatedExposureAmount: null, estimatedExposureCurrency: null, ...o,
});

describe("G5 correlation key (unit)", () => {
  it("deterministic for same engagement+semantic", () => {
    expect(matterCorrelationKey({ engagementId: "E", resultSemanticFingerprint: "S" }))
      .toBe(matterCorrelationKey({ engagementId: "E", resultSemanticFingerprint: "S" }));
  });
  it("different engagement or semantic → different key", () => {
    const base = matterCorrelationKey({ engagementId: "E", resultSemanticFingerprint: "S" });
    expect(base).not.toBe(matterCorrelationKey({ engagementId: "E2", resultSemanticFingerprint: "S" }));
    expect(base).not.toBe(matterCorrelationKey({ engagementId: "E", resultSemanticFingerprint: "S2" }));
  });
});

describe("G5 membership fingerprint (unit)", () => {
  it("order-independent (multiset)", () => {
    expect(membershipFingerprint(["A", "B", "C"])).toBe(membershipFingerprint(["C", "A", "B"]));
  });
  it("changes when membership changes", () => {
    expect(membershipFingerprint(["A", "B"])).not.toBe(membershipFingerprint(["A", "B", "C"]));
  });
});

describe("G5 finding contentHash (unit)", () => {
  it("same content → same hash", () => { expect(findingContentHash(C())).toBe(findingContentHash(C())); });
  it("changed professional field → changed hash", () => {
    expect(findingContentHash(C())).not.toBe(findingContentHash(C({ auditorConclusion: "different" })));
    expect(findingContentHash(C())).not.toBe(findingContentHash(C({ category: "CONTROL_DEFICIENCY" })));
  });
  it("money normalized: 50 / 50.00 / 50.000000 hash identically", () => {
    const a = findingContentHash(C({ observedAmount: "50", observedCurrency: "SAR" }));
    const b = findingContentHash(C({ observedAmount: "50.00", observedCurrency: "SAR" }));
    const c = findingContentHash(C({ observedAmount: "50.000000", observedCurrency: "SAR" }));
    expect(a).toBe(b); expect(b).toBe(c);
  });
  it("different amount / currency → different hash; null distinct from zero", () => {
    expect(findingContentHash(C({ observedAmount: "50", observedCurrency: "SAR" })))
      .not.toBe(findingContentHash(C({ observedAmount: "51", observedCurrency: "SAR" })));
    expect(findingContentHash(C({ observedAmount: "50", observedCurrency: "SAR" })))
      .not.toBe(findingContentHash(C({ observedAmount: "50", observedCurrency: "USD" })));
    expect(findingContentHash(C())).not.toBe(findingContentHash(C({ observedAmount: "0", observedCurrency: "SAR" })));
  });
});
