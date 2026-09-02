import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { Prisma, TransactionSource, TransactionType } from "@prisma/client";
import { requireSession } from "@/lib/auth/guard";
import { withTenantContext } from "@/lib/db/tenant";
import { readSpreadsheet } from "@/lib/tabular";
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
  const auth = await requireSession("documents:upload");
  if (!auth.ok) return auth.response;
  const session = auth.session;

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

  // RLS makes a cross-tenant / unknown engagement invisible → not found.
  const engagement = await withTenantContext(session.auditFirmId, (tx) =>
    tx.auditEngagement.findUnique({
      where: { id: engagementId },
      select: { currency: true },
    }),
  );
  if (!engagement) {
    return NextResponse.json({ error: "Engagement not found" }, { status: 404 });
  }

  let rows: Record<string, string>[];
  try {
    rows = await readSpreadsheet(file);
  } catch {
    return NextResponse.json(
      { error: "تعذّر قراءة الملف — تأكد أنه CSV أو Excel صالح." },
      { status: 400 },
    );
  }
  if (rows.length === 0) {
    return NextResponse.json({ error: "الملف فارغ أو لا يحتوي صفوفاً." }, { status: 400 });
  }

  // If no row yields a recognized amount, the headers are likely unmapped.
  const foundHeaders = Object.keys(rows[0] ?? {});
  const anyAmount = rows.some((r) => {
    const c = canonicalize(r);
    return normalizeAmount(c.amount ?? "") !== null;
  });
  if (!anyAmount) {
    return NextResponse.json(
      {
        error: `لم يُعثر على عمود «المبلغ». الأعمدة المقروءة: ${foundHeaders.join("، ") || "لا شيء"}. استخدم القالب أو سمِّ عمود المبلغ «amount» أو «المبلغ».`,
      },
      { status: 400 },
    );
  }

  const errors: string[] = [];
  const data: Prisma.TransactionCreateManyInput[] = [];
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
      auditFirmId: session.auditFirmId,
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
    const result = await withTenantContext(session.auditFirmId, (tx) =>
      tx.transaction.createMany({ data }),
    );
    await recordAuditLog({
      auditFirmId: session.auditFirmId,
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
