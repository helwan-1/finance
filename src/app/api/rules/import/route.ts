import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { Prisma, RuleCategory } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { parseCsv } from "@/lib/csv";

const SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"];

// Derive category from the rule definition type.
const TYPE_CATEGORY: Record<string, RuleCategory> = {
  field_compare: "NUMERIC",
  threshold_avoidance: "NUMERIC",
  round_amount: "NUMERIC",
  value_list: "PARTY",
  missing_field: "PARTY",
  time_window: "TIMING",
  aggregate: "AGGREGATE",
};

interface ImportResult {
  created: number;
  skipped: number;
  errors: string[];
}

/**
 * POST /api/rules/import — bulk-create rules from a CSV file.
 *
 * Columns: code, nameAr, severity, scope, definition
 * where `definition` is the JSON rule definition. `category` is derived from
 * definition.type. Requires rules:manage.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  if (!can(session.role, "rules:manage")) {
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
  const engagementId = (form.get("engagementId") as string | null)?.trim() || null;

  const text = await file.text();
  const rows = parseCsv(text);
  if (rows.length === 0) {
    return NextResponse.json({ error: "الملف فارغ أو غير صالح" }, { status: 400 });
  }

  const result: ImportResult = { created: 0, skipped: 0, errors: [] };

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]!;
    const lineNo = i + 2; // header is line 1
    const code = row.code?.trim();
    const nameAr = row.nameAr?.trim();
    if (!code || !nameAr || !row.definition) {
      result.skipped += 1;
      result.errors.push(`السطر ${lineNo}: code و nameAr و definition مطلوبة`);
      continue;
    }

    let definition: { type?: string };
    try {
      definition = JSON.parse(row.definition) as { type?: string };
    } catch {
      result.skipped += 1;
      result.errors.push(`السطر ${lineNo}: تعريف JSON غير صالح`);
      continue;
    }
    const category = definition.type ? TYPE_CATEGORY[definition.type] : undefined;
    if (!category) {
      result.skipped += 1;
      result.errors.push(`السطر ${lineNo}: نوع القاعدة غير معروف`);
      continue;
    }

    const severity = SEVERITIES.includes((row.severity ?? "").toUpperCase())
      ? (row.severity!.toUpperCase() as never)
      : ("MEDIUM" as never);
    const scope = (row.scope ?? "FIRM").toUpperCase();

    try {
      await prisma.auditRule.create({
        data: {
          auditFirmId: session.auditFirmId,
          engagementId: scope === "ENGAGEMENT" ? engagementId : null,
          code,
          name: code,
          nameAr,
          category,
          severity,
          descriptionAr: row.descriptionAr?.trim() || null,
          definition: definition as unknown as Prisma.InputJsonValue,
        },
      });
      result.created += 1;
    } catch {
      result.skipped += 1;
      result.errors.push(`السطر ${lineNo}: تعذّر الحفظ`);
    }
  }

  return NextResponse.json(result, { status: result.created > 0 ? 201 : 400 });
}
