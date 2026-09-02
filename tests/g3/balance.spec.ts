import { describe, it, expect } from "vitest";
import { computeBalance } from "@/lib/accounting/canonical";

const L = (d: string | null, c: string | null, cur: string | null, fd: string | null = null, fc: string | null = null, fcur: string | null = null) => ({
  transactionDebit: d, transactionCredit: c, transactionCurrency: cur,
  functionalDebit: fd, functionalCredit: fc, functionalCurrency: fcur,
});

describe("G3 currency-safe balance capability (C6 / ADR-G3-03)", () => {
  it("single common transaction currency, balanced → AVAILABLE + BALANCED", () => {
    const b = computeBalance([L("100.500", null, "USD"), L(null, "100.500", "USD")]);
    expect(b.capability).toBe("AVAILABLE");
    expect(b.basis).toBe("TRANSACTION");
    expect(b.status).toBe("BALANCED");
    expect(b.currency).toBe("USD");
    expect(b.difference).toBe("0.000000");
  });

  it("single currency, unbalanced → AVAILABLE + UNBALANCED (retained, not rejected)", () => {
    const b = computeBalance([L("50.00", null, "USD"), L(null, "40.00", "USD")]);
    expect(b.capability).toBe("AVAILABLE");
    expect(b.status).toBe("UNBALANCED");
    expect(b.difference).toBe("10.000000");
  });

  it("mixed transaction currencies with no functional basis → PARTIAL, no totals (test 7)", () => {
    const b = computeBalance([L("100", null, "USD"), L(null, "80", "EUR")]);
    expect(b.capability).toBe("PARTIAL");
    expect(b.status).toBe("NOT_EVALUABLE");
    expect(b.debitTotal).toBeNull();
    expect(b.creditTotal).toBeNull();
    expect(b.currency).toBeNull();
  });

  it("mixed txn currency but complete common functional currency → AVAILABLE FUNCTIONAL (test 8)", () => {
    const b = computeBalance([
      L("100", null, "USD", "375", null, "SAR"),
      L(null, "80", "EUR", null, "375", "SAR"),
    ]);
    expect(b.capability).toBe("AVAILABLE");
    expect(b.basis).toBe("FUNCTIONAL");
    expect(b.currency).toBe("SAR");
    expect(b.status).toBe("BALANCED");
    expect(b.debitTotal).toBe("375.000000");
  });

  it("no currency information at all → NOT_AVAILABLE", () => {
    const b = computeBalance([L("100", null, null), L(null, "100", null)]);
    expect(b.capability).toBe("NOT_AVAILABLE");
    expect(b.status).toBe("NOT_EVALUABLE");
  });
});
