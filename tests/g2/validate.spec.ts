import { describe, it, expect } from "vitest";
import { validateRow, parseDateStrict, parseDecimalStrict } from "@/lib/import/validate";

const iso = { dateInterpretation: "ISO" as const };

describe("G2 strict parsers (Phase F — no fabrication)", () => {
  it("parseDateStrict returns null for invalid dates (never now())", () => {
    expect(parseDateStrict("not-a-date", "ISO")).toBeNull();
    expect(parseDateStrict("2024-02-31", "ISO")).toBeNull(); // impossible day
    expect(parseDateStrict("2024-01-15", "ISO")).toBe("2024-01-15");
    expect(parseDateStrict("15/01/2024", "DMY")).toBe("2024-01-15");
    expect(parseDateStrict("01/15/2024", "MDY")).toBe("2024-01-15");
  });
  it("parseDecimalStrict rejects non-numeric, accepts Arabic digits/separators", () => {
    expect(parseDecimalStrict("abc")).toBeNull();
    expect(parseDecimalStrict("1,234.50")).toBe("1234.50");
    expect(parseDecimalStrict("٢٥٠٠")).toBe("2500.00");
  });
});

describe("G2 row validation (Phase F, C9)", () => {
  it("accepts a valid GENERAL_LEDGER row", () => {
    const r = validateRow("GENERAL_LEDGER",
      { accountCode: "1010", postingDate: "2024-01-15", debit: "500.00", description: "x" }, iso);
    expect(r.status).toBe("ACCEPTED");
    expect(r.normalized?.postingDate).toBe("2024-01-15");
    expect(r.normalized?.debit).toBe("500.00");
  });

  it("REJECTS an invalid required date without creating a value", () => {
    const r = validateRow("GENERAL_LEDGER",
      { accountCode: "1010", postingDate: "31/31/2024", amount: "100" }, iso);
    expect(r.status).toBe("REJECTED");
    expect(r.normalized).toBeNull();
    expect(r.issues.some((i) => i.code === "INVALID_DATE" && i.blocking)).toBe(true);
  });

  it("REJECTS a non-numeric amount (unknown debit/credit value ≠ silent default)", () => {
    const r = validateRow("GENERAL_LEDGER",
      { accountCode: "1010", postingDate: "2024-01-15", debit: "abc" }, iso);
    expect(r.status).toBe("REJECTED");
    expect(r.issues.some((i) => i.code === "INVALID_AMOUNT")).toBe(true);
  });

  it("REJECTS a missing required field", () => {
    const r = validateRow("GENERAL_LEDGER", { postingDate: "2024-01-15", amount: "100" }, iso);
    expect(r.status).toBe("REJECTED");
    expect(r.issues.some((i) => i.code === "MISSING_REQUIRED" && i.field === "accountCode")).toBe(true);
  });

  it("REJECTS a GL row with no debit/credit/amount", () => {
    const r = validateRow("GENERAL_LEDGER", { accountCode: "1010", postingDate: "2024-01-15" }, iso);
    expect(r.status).toBe("REJECTED");
    expect(r.issues.some((i) => i.code === "MISSING_VALUE_GROUP")).toBe(true);
  });

  it("TRIAL_BALANCE requires accountCode + at least one balance figure", () => {
    expect(validateRow("TRIAL_BALANCE", { accountCode: "1010", closingDebit: "900" }, iso).status).toBe("ACCEPTED");
    expect(validateRow("TRIAL_BALANCE", { accountCode: "1010" }, iso).status).toBe("REJECTED");
  });

  it("BANK requires transactionDate + amount", () => {
    expect(validateRow("BANK", { transactionDate: "2024-03-01", amount: "-50" }, iso).status).toBe("ACCEPTED");
    expect(validateRow("BANK", { amount: "-50" }, iso).status).toBe("REJECTED");
  });

  it("OTHER has no accounting-required fields", () => {
    expect(validateRow("OTHER", { anything: "x" }, iso).status).toBe("ACCEPTED");
  });
});
