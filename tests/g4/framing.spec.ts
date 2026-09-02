import { describe, it, expect, afterEach, vi } from "vitest";
import { hashHex, str, int, seq, multiset, fields, foldMember, sealFold, FOLD_SEED } from "@/lib/g4/framing";
import { getEngineBuildVersion, getAttestableEngineBuildVersion } from "@/lib/g4/engine-build";

const H = (b: Buffer) => hashHex(b);

describe("G4 framing — injection-safe, adversarial (matrix A)", () => {
  it("['ab','c'] != ['a','bc'] (length-prefixed boundaries)", () => {
    expect(H(seq([str("ab"), str("c")]))).not.toBe(H(seq([str("a"), str("bc")])));
  });
  it("NULL != empty string", () => {
    expect(H(str(null))).not.toBe(H(str("")));
  });
  it("ordered sequence: [A,B] != [B,A]", () => {
    expect(H(seq([str("A"), str("B")]))).not.toBe(H(seq([str("B"), str("A")])));
  });
  it("multiset: order NON-semantic → [A,B] == [B,A]", () => {
    expect(H(multiset([str("A"), str("B")]))).toBe(H(multiset([str("B"), str("A")])));
  });
  it("multiplicity preserved: [A] != [A,A] (seq and multiset)", () => {
    expect(H(seq([str("A")]))).not.toBe(H(seq([str("A"), str("A")])));
    expect(H(multiset([str("A")]))).not.toBe(H(multiset([str("A"), str("A")])));
  });
  it("fields: key order NOT semantic", () => {
    expect(H(fields([["a", str("1")], ["b", str("2")]]))).toBe(H(fields([["b", str("2")], ["a", str("1")]])));
  });
  it("fold chain is order-sensitive and multiplicity-preserving", () => {
    const A = Buffer.from("aa", "hex"), B = Buffer.from("bb", "hex");
    const ab = sealFold("t", foldMember(foldMember(FOLD_SEED, A), B), 2);
    const ba = sealFold("t", foldMember(foldMember(FOLD_SEED, B), A), 2);
    const a1 = sealFold("t", foldMember(FOLD_SEED, A), 1);
    const aa = sealFold("t", foldMember(foldMember(FOLD_SEED, A), A), 2);
    expect(ab).not.toBe(ba);
    expect(a1).not.toBe(aa);
  });
  it("int is a framed decimal string", () => {
    expect(H(int(10))).toBe(H(str("10")));
  });
});

describe("G4 engine build identity — fail-closed (matrix B)", () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it("production + missing build id → throws (fail-closed)", () => {
    vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("AUDIT_ENGINE_BUILD", "");
    expect(() => getEngineBuildVersion()).toThrow(/AUDIT_ENGINE_BUILD/);
  });
  it("production + placeholder → throws", () => {
    vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("AUDIT_ENGINE_BUILD", "0.1.0");
    expect(() => getEngineBuildVersion()).toThrow();
  });
  it("production + dev: prefix → throws (not trustworthy)", () => {
    vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("AUDIT_ENGINE_BUILD", "dev:abc");
    expect(() => getEngineBuildVersion()).toThrow();
  });
  it("production + real SHA → returned verbatim", () => {
    vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("AUDIT_ENGINE_BUILD", "sha:deadbeef");
    expect(getEngineBuildVersion()).toBe("sha:deadbeef");
  });
  it("non-production without a value → explicit dev id (never blocks)", () => {
    vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("AUDIT_ENGINE_BUILD", "");
    expect(getEngineBuildVersion()).toBe("dev:non-production");
  });
});

describe("G4 attestable engine build identity — strict, every environment (matrix B1)", () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it("non-production + missing → throws (dev fallback is NOT attestable)", () => {
    vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("AUDIT_ENGINE_BUILD", "");
    expect(() => getAttestableEngineBuildVersion()).toThrow(/AUDIT_ENGINE_BUILD/);
  });
  it("non-production + dev:non-production fallback value → throws", () => {
    vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("AUDIT_ENGINE_BUILD", "dev:non-production");
    expect(() => getAttestableEngineBuildVersion()).toThrow();
  });
  it("non-production + any dev:* → throws", () => {
    vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("AUDIT_ENGINE_BUILD", "dev:abc");
    expect(() => getAttestableEngineBuildVersion()).toThrow();
  });
  it("non-production + placeholder → throws", () => {
    vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("AUDIT_ENGINE_BUILD", "changeme");
    expect(() => getAttestableEngineBuildVersion()).toThrow();
  });
  it("explicit test build identity → returned verbatim (tests configure it server-side)", () => {
    vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("AUDIT_ENGINE_BUILD", "test-build-xyz");
    expect(getAttestableEngineBuildVersion()).toBe("test-build-xyz");
  });
  it("production + missing → throws (same fail-closed as loose)", () => {
    vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("AUDIT_ENGINE_BUILD", "");
    expect(() => getAttestableEngineBuildVersion()).toThrow();
  });
});
