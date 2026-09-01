import { describe, it, expect } from "vitest";
import { evaluateRule } from "../engine";
import type { AuditRuleSpec, RuleDefinition, RuleRecord } from "../types";

function rule(definition: RuleDefinition): AuditRuleSpec {
  return {
    id: "r1",
    code: "R1",
    nameAr: "قاعدة",
    category: "NUMERIC",
    severity: "HIGH",
    definition,
  };
}

const rec = (over: Partial<RuleRecord> & { id: string }): RuleRecord => ({
  reference: over.id,
  description: "x",
  amount: "100.00",
  postedAt: "2025-09-03T09:00:00Z", // 12:00 Riyadh, Wednesday
  ...over,
});

describe("field_compare", () => {
  it("flags amounts at/above a threshold", () => {
    const records = [rec({ id: "a", amount: "150000.00" }), rec({ id: "b", amount: "500.00" })];
    const f = evaluateRule(rule({ type: "field_compare", field: "amount", op: "gte", value: 100000 }), records);
    expect(f.map((x) => x.transactionIds[0])).toEqual(["a"]);
  });
  it("flags a low VAT ratio", () => {
    const records = [
      rec({ id: "ok", amount: "1000.00", vatAmount: "150.00" }),
      rec({ id: "low", amount: "1000.00", vatAmount: "50.00" }),
    ];
    const f = evaluateRule(rule({ type: "field_compare", field: "vatRatioPct", op: "lt", value: 14.5 }), records);
    expect(f).toHaveLength(1);
    expect(f[0]?.transactionIds[0]).toBe("low");
  });
});

describe("threshold_avoidance", () => {
  it("flags amounts just below the limit", () => {
    const records = [
      rec({ id: "just", amount: "9800.00" }), // within 5% below 10000
      rec({ id: "over", amount: "10000.00" }),
      rec({ id: "far", amount: "5000.00" }),
    ];
    const f = evaluateRule(rule({ type: "threshold_avoidance", limit: 10000, marginPct: 5 }), records);
    expect(f.map((x) => x.transactionIds[0])).toEqual(["just"]);
  });
});

describe("round_amount", () => {
  it("flags multiples of 1000", () => {
    const records = [rec({ id: "round", amount: "5000.00" }), rec({ id: "notround", amount: "5123.45" })];
    const f = evaluateRule(rule({ type: "round_amount", minTrailingZeros: 3 }), records);
    expect(f.map((x) => x.transactionIds[0])).toEqual(["round"]);
  });
});

describe("value_list", () => {
  it("deny list flags a listed counterparty", () => {
    const records = [rec({ id: "bad", counterparty: "شركة محظورة" }), rec({ id: "ok", counterparty: "شركة عادية" })];
    const f = evaluateRule(rule({ type: "value_list", field: "counterparty", mode: "deny", values: ["شركة محظورة"] }), records);
    expect(f.map((x) => x.transactionIds[0])).toEqual(["bad"]);
  });
  it("allow list flags a non-approved counterparty", () => {
    const records = [rec({ id: "unknown", counterparty: "طرف جديد" }), rec({ id: "ok", counterparty: "معتمد" })];
    const f = evaluateRule(rule({ type: "value_list", field: "counterparty", mode: "allow", values: ["معتمد"] }), records);
    expect(f.map((x) => x.transactionIds[0])).toEqual(["unknown"]);
  });
});

describe("missing_field", () => {
  it("flags records without a linked document", () => {
    const records = [rec({ id: "nodoc", hasDocument: false }), rec({ id: "hasdoc", hasDocument: true })];
    const f = evaluateRule(rule({ type: "missing_field", field: "document" }), records);
    expect(f.map((x) => x.transactionIds[0])).toEqual(["nodoc"]);
  });
});

describe("time_window", () => {
  it("flags off-hours postings", () => {
    const records = [
      rec({ id: "night", postedAt: "2025-09-02T00:00:00Z" }), // 03:00 Riyadh
      rec({ id: "day", postedAt: "2025-09-03T09:00:00Z" }), // 12:00 Riyadh
    ];
    const f = evaluateRule(rule({ type: "time_window", kind: "off_hours" }), records);
    expect(f.map((x) => x.transactionIds[0])).toEqual(["night"]);
  });
});

describe("aggregate", () => {
  it("count: flags duplicate amount+party groups", () => {
    const records = [
      rec({ id: "a", amount: "500.00", counterparty: "ACME" }),
      rec({ id: "b", amount: "500.00", counterparty: "ACME" }),
      rec({ id: "c", amount: "500.00", counterparty: "OTHER" }),
    ];
    const f = evaluateRule(rule({ type: "aggregate", groupBy: ["amount", "counterparty"], agg: "count", op: "gte", value: 2 }), records);
    expect(f).toHaveLength(1);
    expect(new Set(f[0]?.transactionIds)).toEqual(new Set(["a", "b"]));
  });
  it("sum with window: flags split payments to one party in a day", () => {
    const records = [
      rec({ id: "x", amount: "30000.00", counterparty: "ACME", postedAt: "2025-09-03T08:00:00Z" }),
      rec({ id: "y", amount: "25000.00", counterparty: "ACME", postedAt: "2025-09-03T10:00:00Z" }),
    ];
    const f = evaluateRule(rule({ type: "aggregate", groupBy: ["counterparty"], agg: "sum", op: "gte", value: 50000, windowDays: 1 }), records);
    expect(f).toHaveLength(1);
    expect(f[0]?.transactionIds.length).toBe(2);
  });
});
