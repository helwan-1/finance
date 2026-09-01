import { describe, it, expect } from "vitest";
import { analyzeBenford, leadingDigit } from "../benford";
import { detectDuplicates } from "../duplicates";
import { detectOffHours, zonedParts } from "../offHours";
import { checkVat, detectVatDiscrepancies, expectedVatMinor } from "../vat";
import { toMinorUnits, minorUnitsToString } from "../money";
import { reconcile } from "../../reconciliation";
import type { AnalyzableTransaction } from "../types";
import type { ReconcilableTxn } from "../../reconciliation";

describe("money", () => {
  it("parses two-decimal values to minor units", () => {
    expect(toMinorUnits("1234.50")).toBe(123450);
    expect(toMinorUnits("100")).toBe(10000);
    expect(toMinorUnits("-0.05")).toBe(-5);
  });
  it("formats minor units back to a decimal string", () => {
    expect(minorUnitsToString(123450)).toBe("1234.50");
  });
  it("rejects more than two decimals", () => {
    expect(() => toMinorUnits("12.345")).toThrow();
  });
});

describe("benford", () => {
  it("extracts the leading digit", () => {
    expect(leadingDigit(123450)).toBe(1);
    expect(leadingDigit(9900)).toBe(9);
    expect(leadingDigit(0)).toBeNull();
  });
  it("does not reject a conforming population", () => {
    const amounts: string[] = [];
    const expectedCounts = [301, 176, 125, 97, 79, 67, 58, 51, 46];
    for (let d = 1; d <= 9; d += 1) {
      for (let i = 0; i < (expectedCounts[d - 1] ?? 0); i += 1) {
        amounts.push(`${d}00.00`);
      }
    }
    expect(analyzeBenford(amounts).rejectsBenford).toBe(false);
  });
  it("rejects a degenerate all-nines population", () => {
    const skewed = Array.from({ length: 200 }, () => "900.00");
    expect(analyzeBenford(skewed).rejectsBenford).toBe(true);
  });
});

describe("duplicates", () => {
  const txns: AnalyzableTransaction[] = [
    { id: "a", reference: "INV-1", description: "x", amount: "500.00", counterparty: "ACME", postedAt: "2025-07-01T09:00:00Z" },
    { id: "b", reference: "INV-1", description: "x", amount: "500.00", counterparty: "ACME", postedAt: "2025-07-01T09:00:00Z" },
    { id: "c", reference: "INV-2", description: "x", amount: "500.00", counterparty: "ACME", postedAt: "2025-07-02T09:00:00Z" },
  ];
  it("detects exact duplicates", () => {
    expect(detectDuplicates(txns).some((f) => f.ruleCode === "DUPLICATE_EXACT")).toBe(true);
  });
  it("detects near duplicates with a different reference in-window", () => {
    expect(detectDuplicates(txns).some((f) => f.ruleCode === "DUPLICATE_NEAR")).toBe(true);
  });
  it("ignores matches outside the time window", () => {
    const far: AnalyzableTransaction[] = [
      { id: "a", reference: "R1", description: "x", amount: "500.00", counterparty: "ACME", postedAt: "2025-07-01T09:00:00Z" },
      { id: "b", reference: "R2", description: "x", amount: "500.00", counterparty: "ACME", postedAt: "2025-07-30T09:00:00Z" },
    ];
    expect(detectDuplicates(far, { nearWindowHours: 72 })).toHaveLength(0);
  });
});

describe("off-hours", () => {
  const txns: AnalyzableTransaction[] = [
    { id: "night", reference: "N1", description: "x", amount: "100.00", counterparty: null, postedAt: "2025-09-02T00:00:00Z" },
    { id: "friday", reference: "F1", description: "x", amount: "100.00", counterparty: null, postedAt: "2025-09-05T09:00:00Z" },
    { id: "normal", reference: "D1", description: "x", amount: "100.00", counterparty: null, postedAt: "2025-09-03T09:00:00Z" },
  ];
  const findings = detectOffHours(txns);
  it("flags a 03:00 weekday entry", () => {
    expect(findings.some((f) => f.ruleCode === "OFF_HOURS_ENTRY" && f.transactionIds[0] === "night")).toBe(true);
  });
  it("flags a Friday entry as weekend", () => {
    expect(findings.some((f) => f.ruleCode === "WEEKEND_ENTRY" && f.transactionIds[0] === "friday")).toBe(true);
  });
  it("does not flag a normal business-hours weekday entry", () => {
    expect(findings.some((f) => f.transactionIds[0] === "normal")).toBe(false);
  });
  it("resolves zoned parts for Riyadh", () => {
    const p = zonedParts("2025-09-03T09:00:00Z", "Asia/Riyadh");
    expect(p.hour).toBe(12);
    expect(p.weekday).toBe(3);
  });
});

describe("vat", () => {
  it("computes expected VAT with half-up rounding", () => {
    expect(expectedVatMinor(10000, 0.15)).toBe(1500);
    expect(expectedVatMinor(3333, 0.15)).toBe(500);
  });
  it("accepts correct VAT and rounding tolerance", () => {
    expect(checkVat(10000, 1500).isDiscrepancy).toBe(false);
    expect(checkVat(10000, 1501, { toleranceMinor: 1 }).isDiscrepancy).toBe(false);
  });
  it("flags a mis-declared VAT amount", () => {
    expect(checkVat(10000, 1000).isDiscrepancy).toBe(true);
  });
  it("flags only the transactions whose VAT is wrong", () => {
    const txns: AnalyzableTransaction[] = [
      { id: "ok", reference: "V-OK", description: "x", amount: "1000.00", vatAmount: "150.00", counterparty: null, postedAt: "2025-09-01T09:00:00Z" },
      { id: "bad", reference: "V-BAD", description: "x", amount: "1000.00", vatAmount: "100.00", counterparty: null, postedAt: "2025-09-01T09:00:00Z" },
      { id: "none", reference: "V-NONE", description: "x", amount: "1000.00", vatAmount: null, counterparty: null, postedAt: "2025-09-01T09:00:00Z" },
    ];
    const findings = detectVatDiscrepancies(txns);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.transactionIds[0]).toBe("bad");
  });
});

describe("reconciliation", () => {
  const bank: ReconcilableTxn[] = [
    { id: "b1", reference: "BANK-1", amount: "500.00", counterparty: "ACME", valueDate: "2025-07-02T00:00:00Z" },
    { id: "b2", reference: "BANK-2", amount: "300.50", counterparty: "ACME", valueDate: "2025-07-03T00:00:00Z" },
    { id: "b3", reference: "BANK-3", amount: "999.00", counterparty: "OTHER", valueDate: "2025-07-10T00:00:00Z" },
  ];
  const ledger: ReconcilableTxn[] = [
    { id: "l1", reference: "JV-1", amount: "500.00", counterparty: "ACME", valueDate: "2025-07-01T00:00:00Z" },
    { id: "l2", reference: "JV-2", amount: "300.00", counterparty: "ACME", valueDate: "2025-07-02T00:00:00Z" },
  ];
  it("matches exact, partial, and leaves the rest unmatched", () => {
    const r = reconcile(bank, ledger, { amountToleranceMinor: 100 });
    expect(r.matchedCount).toBe(1);
    expect(r.partialCount).toBe(1);
    expect(r.unmatchedSourceIds).toEqual(["b3"]);
    expect(r.matches.find((m) => m.status === "PARTIAL")?.amountDeltaMinor).toBe(50);
  });
  it("rejects the partial in exact-only mode", () => {
    const r = reconcile(bank, ledger, { amountToleranceMinor: 0 });
    expect(r.matchedCount).toBe(1);
    expect(r.partialCount).toBe(0);
  });
});
