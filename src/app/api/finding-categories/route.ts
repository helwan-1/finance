import { NextResponse } from "next/server";
import { authorize } from "@/lib/auth/guard";
import { prisma } from "@/lib/prisma";
import type { FindingCategoriesResponse, FindingCategoryDTO } from "@/lib/ui-types";

/** Fallback categories when the reference table is empty/unreachable. */
const FALLBACK: FindingCategoryDTO[] = [
  { code: "FS_MISSTATEMENT", labelAr: "تحريف في القوائم المالية" },
  { code: "CONTROL_DEFICIENCY", labelAr: "قصور في الرقابة" },
  { code: "COMPLIANCE_MATTER", labelAr: "مسألة امتثال" },
  { code: "FRAUD_RISK_INDICATOR", labelAr: "مؤشر مخاطر احتيال" },
  { code: "DATA_QUALITY_MATTER", labelAr: "مسألة جودة بيانات" },
  { code: "OTHER", labelAr: "مسألة تدقيق أخرى" },
];

/**
 * GET /api/finding-categories — global reference list of finding categories
 * (not tenant-scoped; the reference table carries no auditFirmId).
 */
export async function GET(): Promise<NextResponse> {
  const authz = await authorize("findings:view");
  if (!authz.ok) return authz.response;

  try {
    const rows = await prisma.auditFindingCategoryRef.findMany({
      where: { active: true },
      orderBy: { sortOrder: "asc" },
    });
    const categories: FindingCategoryDTO[] = rows.length
      ? rows.map((r) => ({ code: r.code, labelAr: r.labelAr }))
      : FALLBACK;
    return NextResponse.json<FindingCategoriesResponse>({ categories });
  } catch {
    return NextResponse.json<FindingCategoriesResponse>({ categories: FALLBACK });
  }
}
