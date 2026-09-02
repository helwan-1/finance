import { describe, it, expect } from "vitest";
import { parseCanonicalDecimal, decimalToMicros, microsToDecimalString } from "@/lib/accounting/decimal";

describe("G3 canonical decimal fidelity (ADR-G3-01)", () => {
  it("preserves >2dp precision (no bridge rounding)", () => {
    expect(parseCanonicalDecimal("100.500")).toBe("100.500");
    expect(parseCanonicalDecimal("100.123456")).toBe("100.123456");
    expect(parseCanonicalDecimal("1.005")).toBe("1.005"); // would round to 1.00/1.01 as float(2)
  });

  it("normalizes separators, Arabic digits, currency symbols; never uses float", () => {
    expect(parseCanonicalDecimal("1,234.56")).toBe("1234.56");
    expect(parseCanonicalDecimal("—")).toBe(null); // no digits after cleaning → null
    expect(parseCanonicalDecimal("abc")).toBe(null);
    expect(parseCanonicalDecimal("SAR 2,000.75")).toBe("2000.75");
    expect(parseCanonicalDecimal("٥٠٠")).toBe("500");
    expect(parseCanonicalDecimal("-0")).toBe("0");
    expect(parseCanonicalDecimal("")).toBe(null);
    expect(parseCanonicalDecimal(null)).toBe(null);
  });

  it("micro-unit round trip is exact at 6dp with half-up rounding", () => {
    expect(microsToDecimalString(decimalToMicros("100.500"))).toBe("100.500000");
    expect(decimalToMicros("1.0000005")).toBe(1000001n); // half-up at 6th dp
    expect(decimalToMicros("-2.5")).toBe(-2500000n);
    expect(microsToDecimalString(decimalToMicros("100") + decimalToMicros("0.000001"))).toBe("100.000001");
  });
});
