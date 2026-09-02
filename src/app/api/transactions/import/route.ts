import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { TransactionSource, TransactionType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { parseCsv } from "@/lib/csv";
import { recordAuditLog } from "@/lib/audit-log";
import { publishAuditEvent } from "@/lib/events";

/** Map many header spellings (English/Arabic) to a canonical field. */
const HEADER_ALIASES: Record<string, string> = {
  reference: "reference", "المرجع": "reference", ref: "reference",
  description: "description", "الوصف": "description", "البيان": "description",
  amount: "amount", "المبلغ": "amount", "القيمة": "amount",
  vatamount: "vatAmount", vat: "vatAmount", "الضريبة": "vatAmount", "ضريبة": "vatAmount",
  counterparty: "counterparty", "الطرف": "counterparty", "الطرف المقابل": "counterparty", vendor: "counterparty",
  account: "account", "الحساب": "account",
  type: "type", "النوع": "type",
  source: "source", "المصدر": "source",
  postedat: "postedAt", date: "postedAt", "التاريخ": "postedAt", "تاريخ القيد": "postedAt",
  valuedate: "valueDate", "تاريخ القيمة": "valueDate",
};

/** Normalize an amount cell: Arabic-Indic digits → ASCII, strip separators. */
function normalizeAmount(raw: string): string | null {
  if (!raw) return null;
  const arabicDigits = "٠١٢٣٤٥٦٧٨٩";
  let s = raw.trim();
  s = s.replace(/[٠-٩]/g, (d) => String(arabicDigits.indexOf(d)));
  s = s.replace(/[,\s٬]/g, ""); // thousands separators (incl. Arabic ٬)
  s = s.replace(/[^0-9.-]/g, ""); // drop currency symbols (ر.س etc.)
  const m = /^-?\d+(\.\d+)?$/.exec(s);
  if (!m) return null;
  const n = Number.parseFloat(s);
  if (!Number.isFinite(n)) return null;
  return n.toFixed(2); // Decimal(15,2)
}

function mapType(raw: string): TransactionType {
  const v = raw.trim().toLowerCase();
  if (v === "credit" || v === "دائن") return "CREDIT";
  return "DEBIT";
}

function mapSource(raw: string): TransactionSource {
  const v = raw.trim().toUpperCase();
  if (v === "BANK" || v === "INVOICE" || v === "MANUAL") return v;
  return "LEDGER";
}

function parseDate(raw: string): Date {
  const d = raw ? new Date(raw.trim()) : new Date();
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

/** Rename row keys to canonical field names using the alias table. */
function canonicalize(row: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(row)) {
    const canonical = HEADER_ALIASES[key.trim().toLowerCase()] ?? HEADER_ALIASES[key.trim()];
    if (canonical) out[canonical] = value;
  }
  return out;
}

/**
 * POST /api/transactions/import — bulk-create transactions from a CSV file into
 * the given engagement. Amounts stay as entered (no OCR guessing). Requires the
 * documents:upload permission.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  if (!can(session.role, "documents:upload")) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }
  const engagementId = (form.get("engagementId") as string | null)?.trim();
  if (!engagementId) {
    return NextResponse.json({ error: "engagementId is required" }, { status: 400 });
  }

  const engagement = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: { auditFirmId: true, currency: true },
  });
  if (!engagement) {
    return NextResponse.json({ error: "Engagement not found" }, { status: 404 });
  }
  if (engagement.auditFirmId !== session.auditFirmId) {
    return NextResponse.json({ error: "Cross-tenant access denied" }, { status: 403 });
  }

  const rows = parseCsv(await file.text());
  if (rows.length === 0) {
    return NextResponse.json({ error: "الملف فارغ أو غير صالح" }, { status: 400 });
  }

  const errors: string[] = [];
  const data = [];
  for (let i = 0; i < rows.length; i += 1) {
    const r = canonicalize(rows[i]!);
    const lineNo = i + 2;
    const amount = normalizeAmount(r.amount ?? "");
    if (!amount) {
      errors.push(`السطر ${lineNo}: المبلغ مفقود أو غير صالح`);
      continue;
    }
    const postedAt = parseDate(r.postedAt ?? "");
    data.push({
      auditFirmId: engagement.auditFirmId,
      engagementId,
      reference: (r.reference ?? "").trim() || `TXN-${i + 1}`,
      description: (r.description ?? "").trim() || "—",
      amount,
      vatAmount: normalizeAmount(r.vatAmount ?? ""),
      currency: engagement.currency,
      type: mapType(r.type ?? ""),
      source: mapSource(r.source ?? ""),
      counterparty: (r.counterparty ?? "").trim() || null,
      account: (r.account ?? "").trim() || null,
      postedAt,
      valueDate: r.valueDate ? parseDate(r.valueDate) : postedAt,
    });
  }

  if (data.length === 0) {
    return NextResponse.json({ created: 0, skipped: rows.length, errors }, { status: 400 });
  }

  try {
    const result = await prisma.transaction.createMany({ data });
    await recordAuditLog({
      auditFirmId: engagement.auditFirmId,
      engagementId,
      userId: session.userId,
      action: "RUN_ANALYSIS",
      entityType: "Transaction",
      metadata: { imported: result.count, skipped: errors.length },
    });
    publishAuditEvent({ type: "document.created", engagementId, payload: { imported: result.count } });
    return NextResponse.json({ created: result.count, skipped: errors.length, errors }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "تعذّر استيراد المعاملات" }, { status: 503 });
  }
}
