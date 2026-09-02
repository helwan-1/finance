import { NextResponse } from "next/server";

/**
 * GET /api/rules/template — a ready-to-fill CSV template for rule import.
 * The `definition` column holds the JSON rule definition; category is derived
 * from its `type`.
 */
export async function GET(): Promise<NextResponse> {
  const rows = [
    ["code", "nameAr", "severity", "scope", "descriptionAr", "definition"],
    [
      "LIMIT-250K",
      "معاملات فوق 250 ألف",
      "HIGH",
      "FIRM",
      "مراجعة البنود الكبيرة",
      '{"type":"field_compare","field":"amount","op":"gte","value":250000}',
    ],
    [
      "DENY-VENDORS",
      "موردون محظورون",
      "CRITICAL",
      "FIRM",
      "قائمة موردين محظورين",
      '{"type":"value_list","field":"counterparty","mode":"deny","values":["شركة أ","شركة ب"]}',
    ],
    [
      "SPLIT-DAY",
      "مدفوعات مقسّمة يومياً",
      "HIGH",
      "FIRM",
      "مجموع طرف واحد فوق 30 ألف في اليوم",
      '{"type":"aggregate","groupBy":["counterparty"],"agg":"sum","op":"gte","value":30000,"windowDays":1}',
    ],
  ];

  // Quote every field and escape embedded quotes (RFC 4180).
  const csv = rows
    .map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(","))
    .join("\r\n");

  // Prepend a UTF-8 BOM so Excel opens Arabic correctly.
  const body = "﻿" + csv;
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="audit-rules-template.csv"',
    },
  });
}
