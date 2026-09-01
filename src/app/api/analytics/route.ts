import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { analyzeBenford, CHI_SQUARE_CRITICAL_8DF } from "@/lib/audit/benford";
import { DEMO_ANALYTICS } from "@/lib/demo-analytics";
import { authorize } from "@/lib/auth/guard";
import type { AnalyticsResponse } from "@/lib/ui-types";

/**
 * GET /api/analytics?engagementId=... — runs Benford's Law analysis over the
 * engagement's transaction amounts (tenant-scoped). Demo fallback with no DB.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const engagementId = searchParams.get("engagementId");

  const authz = await authorize("analytics:view", engagementId);
  if (!authz.ok) return authz.response;

  try {
    if (!engagementId) {
      return NextResponse.json<AnalyticsResponse>(DEMO_ANALYTICS);
    }

    const engagement = await prisma.auditEngagement.findUnique({
      where: { id: engagementId },
      select: { auditFirmId: true },
    });
    if (!engagement) {
      return NextResponse.json<AnalyticsResponse>(DEMO_ANALYTICS);
    }

    const rows = await prisma.transaction.findMany({
      where: { auditFirmId: engagement.auditFirmId, engagementId },
      select: { amount: true },
    });

    if (rows.length === 0) {
      return NextResponse.json<AnalyticsResponse>(DEMO_ANALYTICS);
    }

    const result = analyzeBenford(rows.map((r) => r.amount.toString()));
    const response: AnalyticsResponse = {
      sampleSize: result.sampleSize,
      chiSquare: Math.round(result.chiSquare * 100) / 100,
      criticalValue: CHI_SQUARE_CRITICAL_8DF,
      rejectsBenford: result.rejectsBenford,
      digits: result.digits,
    };
    return NextResponse.json<AnalyticsResponse>(response);
  } catch {
    return NextResponse.json<AnalyticsResponse>(DEMO_ANALYTICS);
  }
}
