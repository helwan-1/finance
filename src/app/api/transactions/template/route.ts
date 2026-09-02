import { NextResponse } from "next/server";

/**
 * GET /api/transactions/template — a ready-to-fill CSV for the ledger import.
 * Arabic header row (the importer also accepts English headers).
 */
export async function GET(): Promise<NextResponse> {
  const rows = [
    ["المرجع", "الوصف", "المبلغ", "الضريبة", "الطرف المقابل", "الحساب", "النوع", "المصدر", "التاريخ", "تاريخ القيمة"],
    ["JV-1001", "سداد فاتورة مورد", "48250.00", "7237.50", "شركة الأفق للتجارة", "2100", "DEBIT", "LEDGER", "2026-01-15", "2026-01-15"],
    ["JV-1002", "مبيعات نقدية", "19900.00", "2985.00", "عملاء متنوعون", "4100", "CREDIT", "LEDGER", "2026-01-16", "2026-01-16"],
    ["BNK-2201", "حركة بنكية", "275000.00", "", "بنك الرياض", "1010", "DEBIT", "BANK", "2026-01-17", "2026-01-17"],
  ];
  const csv = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\r\n");
  return new NextResponse("﻿" + csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="transactions-template.csv"',
    },
  });
}
