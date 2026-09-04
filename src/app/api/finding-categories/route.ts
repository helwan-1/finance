import { NextResponse } from "next/server";
import { authorize } from "@/lib/auth/guard";
import { prisma } from "@/lib/prisma";
import type { FindingCategoriesResponse, FindingCategoryDTO } from "@/lib/ui-types";

/** Fallback categories when the reference table is empty/unreachable. */
const FALLBACK: FindingCategoryDTO[] = [
  { code: "CONTROL_DEFICIENCY", labelAr: "قصور في الرقابة الداخلية" },
  { code: "COMPLIANCE", labelAr: "مخالفة للأنظمة والتشريعات" },
  { code: "MISSTATEMENT", labelAr: "تحريف في القوائم المالية" },
  { code: "FRAUD_INDICATOR", labelAr: "مؤشر احتيال" },
  { code: "PROCESS_GAP", labelAr: "فجوة في الإجراءات" },
  { code: "OTHER", labelAr: "أخرى" },
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
