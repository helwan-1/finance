import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authorize } from "@/lib/auth/guard";
import { withTenantContext } from "@/lib/db/tenant";
import type { AuditResultDTO, AuditResultsResponse } from "@/lib/ui-types";

/**
 * GET /api/audit-results?engagementId=...
 *
 * Lists G4 audit results for an engagement (via its runs) together with each
 * result's current professional-disposition state. Used by the "create
 * exception" flow to pick a source result. Tenant-scoped via withTenantContext.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const engagementId = searchParams.get("engagementId");

  const authz = await authorize("findings:view");
  if (!authz.ok) return authz.response;
  if (!authz.session || !engagementId) {
    return NextResponse.json<AuditResultsResponse>({ results: [] });
  }

  try {
    const { results, stateMap } = await withTenantContext(
      authz.session.auditFirmId,
      async (tx) => {
        const runs = await tx.auditRun.findMany({
          where: { engagementId },
          select: { id: true },
        });
        const runIds = runs.map((r) => r.id);
        const results = runIds.length
          ? await tx.auditResult.findMany({
              where: { runId: { in: runIds } },
              orderBy: { createdAt: "desc" },
              take: 200,
            })
          : [];
        const resultIds = results.map((r) => r.id);
        const states = resultIds.length
          ? await tx.auditResultDispositionState.findMany({
              where: { auditResultId: { in: resultIds } },
            })
          : [];
        return {
          results,
          stateMap: new Map(states.map((s) => [s.auditResultId, s.currentState])),
        };
      },
    );

    const dtos: AuditResultDTO[] = results.map((r) => ({
      id: r.id,
      resultKind: r.resultKind,
      resultCode: r.resultCode,
      severity: r.severity,
      score: r.score.toString(),
      createdAt: r.createdAt.toISOString(),
      dispositionState: stateMap.get(r.id) ?? "UNREVIEWED",
    }));

    return NextResponse.json<AuditResultsResponse>({ results: dtos });
  } catch {
    return NextResponse.json({ error: "تعذّر تحميل البيانات" }, { status: 503 });
  }
}
