import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { DEMO_ANOMALIES } from "@/lib/demo-data";
import { filterAnomalies, parseFilters } from "@/lib/filter-anomalies";
import { authorize } from "@/lib/auth/guard";
import { withTenantContext } from "@/lib/db/tenant";
import { recordAuditLog } from "@/lib/audit-log";
import {
  RULE_LABELS_AR,
  SEVERITY_LABELS_AR,
  STATUS_LABELS_AR,
} from "@/lib/labels";
import { formatDateTime } from "@/lib/format";
import type { AnomalyDTO } from "@/lib/ui-types";

/** Load anomalies for the engagement within the caller's tenant context. */
async function loadAnomalies(
  auditFirmId: string,
  engagementId: string | null,
): Promise<AnomalyDTO[]> {
  if (!engagementId) return [];
  const rows = await withTenantContext(auditFirmId, (tx) =>
    tx.anomalyFlag.findMany({
      where: { engagementId },
      orderBy: [{ score: "desc" }, { detectedAt: "desc" }],
      include: {
        transaction: {
          select: { reference: true, amount: true, counterparty: true },
        },
      },
    }),
  );
  return rows.map((r) => ({
      id: r.id,
      ruleCode: r.ruleCode,
      severity: r.severity,
      status: r.status,
      title: r.title,
      titleAr: r.titleAr,
      description: r.description,
      descriptionAr: r.descriptionAr,
      score: r.score.toString(),
      detectedAt: r.detectedAt.toISOString(),
      reference: r.transaction?.reference ?? null,
      amount: r.transaction?.amount.toString() ?? null,
      counterparty: r.transaction?.counterparty ?? null,
    }));
}

/**
 * GET /api/anomalies/export?engagementId=...&<filters> — export the (filtered)
 * anomalies feed as a real .xlsx workbook. Requires the data:export permission
 * and records an immutable EXPORT_DATA audit-log entry.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const engagementId = searchParams.get("engagementId");
  const filters = parseFilters(searchParams);

  const authz = await authorize("data:export");
  if (!authz.ok) return authz.response;

  // Non-production demo export uses the in-memory feed; authenticated exports
  // load the caller's tenant data via RLS.
  const source = authz.session
    ? await loadAnomalies(authz.session.auditFirmId, engagementId)
    : DEMO_ANOMALIES;
  const anomalies = filterAnomalies(source, filters);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Financial Audit Dashboard";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("الحالات الشاذة", {
    views: [{ rightToLeft: true, state: "frozen", ySplit: 1 }],
  });

  sheet.columns = [
    { header: "الخطورة", key: "severity", width: 12 },
    { header: "نوع القاعدة", key: "rule", width: 22 },
    { header: "الحالة", key: "status", width: 14 },
    { header: "العنوان", key: "title", width: 32 },
    { header: "المرجع", key: "reference", width: 14 },
    { header: "المبلغ (ر.س)", key: "amount", width: 16 },
    { header: "الطرف المقابل", key: "counterparty", width: 22 },
    { header: "الدرجة", key: "score", width: 10 },
    { header: "تاريخ الرصد", key: "detectedAt", width: 22 },
  ];

  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF1D4ED8" },
  };
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };

  for (const a of anomalies) {
    sheet.addRow({
      severity: SEVERITY_LABELS_AR[a.severity],
      rule: RULE_LABELS_AR[a.ruleCode],
      status: STATUS_LABELS_AR[a.status],
      title: a.titleAr,
      reference: a.reference ?? "—",
      amount: a.amount ? Number.parseFloat(a.amount) : "—",
      counterparty: a.counterparty ?? "—",
      score: Math.round(Number.parseFloat(a.score)),
      detectedAt: formatDateTime(a.detectedAt),
    });
  }
  sheet.getColumn("amount").numFmt = "#,##0.00";

  const buffer = await workbook.xlsx.writeBuffer();

  // Immutable audit trail (only when authenticated against a real tenant).
  if (authz.session) {
    try {
      await recordAuditLog({
        auditFirmId: authz.session.auditFirmId,
        engagementId,
        userId: authz.session.userId,
        action: "EXPORT_DATA",
        entityType: "AnomalyFlag",
        metadata: {
          format: "xlsx",
          rows: anomalies.length,
          filters: {
            search: filters.search,
            severity: filters.severity,
            ruleCode: filters.ruleCode,
            status: filters.status,
            from: filters.from,
            to: filters.to,
          },
        },
      });
    } catch {
      // Export still succeeds if the audit write fails.
    }
  }

  const fileName = `anomalies-${new Date().toISOString().slice(0, 10)}.xlsx`;
  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}
