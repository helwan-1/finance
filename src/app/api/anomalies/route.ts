import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { DEMO_ANOMALIES } from "@/lib/demo-data";
import { filterAnomalies, parseFilters } from "@/lib/filter-anomalies";
import { authorize } from "@/lib/auth/guard";
import type { AnomaliesResponse, AnomalyDTO } from "@/lib/ui-types";

/**
 * GET /api/anomalies?engagementId=...&severity=...&ruleCode=...&status=...&search=...
 *
 * MULTI-TENANCY: engagementId is REQUIRED and every query is scoped by both
 * auditFirmId and engagementId. In a real deployment auditFirmId comes from the
 * authenticated session, never from the client. Here it is resolved from the
 * engagement row to keep the demo self-contained.
 *
 * When the database is unreachable (no DATABASE_URL in local review), the route
 * falls back to an in-memory demo dataset so the UI still renders.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const filters = parseFilters(searchParams);
  const engagementId = searchParams.get("engagementId");

  const authz = await authorize("anomalies:view", engagementId);
  if (!authz.ok) return authz.response;

  try {
    if (!engagementId) {
      // No engagement selected yet: serve the demo feed filtered client-side.
      const anomalies = filterAnomalies(DEMO_ANOMALIES, filters);
      return NextResponse.json<AnomaliesResponse>({
        anomalies,
        total: anomalies.length,
      });
    }

    // Resolve the tenant from the engagement (would be the session in prod).
    const engagement = await prisma.auditEngagement.findUnique({
      where: { id: engagementId },
      select: { auditFirmId: true },
    });

    if (!engagement) {
      return NextResponse.json(
        { error: "Engagement not found" },
        { status: 404 },
      );
    }

    const where: Prisma.AnomalyFlagWhereInput = {
      // Both tenant keys are always applied.
      auditFirmId: engagement.auditFirmId,
      engagementId,
      ...(filters.severity !== "ALL" ? { severity: filters.severity } : {}),
      ...(filters.ruleCode !== "ALL" ? { ruleCode: filters.ruleCode } : {}),
      ...(filters.status !== "ALL" ? { status: filters.status } : {}),
      ...(filters.from || filters.to
        ? {
            detectedAt: {
              ...(filters.from ? { gte: new Date(filters.from) } : {}),
              ...(filters.to ? { lte: new Date(filters.to) } : {}),
            },
          }
        : {}),
      ...(filters.search
        ? {
            OR: [
              { titleAr: { contains: filters.search, mode: "insensitive" } },
              { title: { contains: filters.search, mode: "insensitive" } },
              {
                descriptionAr: {
                  contains: filters.search,
                  mode: "insensitive",
                },
              },
              {
                transaction: {
                  reference: {
                    contains: filters.search,
                    mode: "insensitive",
                  },
                },
              },
            ],
          }
        : {}),
    };

    const rows = await prisma.anomalyFlag.findMany({
      where,
      orderBy: [{ score: "desc" }, { detectedAt: "desc" }],
      take: 200,
      include: {
        transaction: {
          select: { reference: true, amount: true, counterparty: true },
        },
      },
    });

    const anomalies: AnomalyDTO[] = rows.map((r) => ({
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

    return NextResponse.json<AnomaliesResponse>({
      anomalies,
      total: anomalies.length,
    });
  } catch {
    // Database unavailable — serve filtered demo data so the UI works.
    const anomalies = filterAnomalies(DEMO_ANOMALIES, filters);
    return NextResponse.json<AnomaliesResponse>({
      anomalies,
      total: anomalies.length,
    });
  }
}
