import { describe, it, expect } from "vitest";
import { parseCsv } from "@/lib/csv";
import { detectDelimiter } from "@/lib/tabular";

describe("csv parsing", () => {
  it("parses comma-delimited with a BOM and quoted fields", () => {
    const text = '﻿"code","nameAr","amount"\r\n"A","بند ,مع فاصلة","1,000"\r\n';
    const rows = parseCsv(text, ",");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.code).toBe("A");
    expect(rows[0]?.nameAr).toBe("بند ,مع فاصلة");
    expect(rows[0]?.amount).toBe("1,000");
  });

  it("parses semicolon-delimited files (locale Excel)", () => {
    const text = "reference;amount;counterparty\r\nJV-1;500.00;شركة النور\r\n";
    const rows = parseCsv(text, ";");
    expect(rows[0]?.reference).toBe("JV-1");
    expect(rows[0]?.amount).toBe("500.00");
    expect(rows[0]?.counterparty).toBe("شركة النور");
  });
});

describe("delimiter detection", () => {
  it("detects semicolon", () => {
    expect(detectDelimiter("a;b;c\n1;2;3")).toBe(";");
  });
  it("detects comma", () => {
    expect(detectDelimiter("a,b,c\n1,2,3")).toBe(",");
  });
  it("detects tab", () => {
    expect(detectDelimiter("a\tb\tc\n1\t2\t3")).toBe("\t");
  });
});
