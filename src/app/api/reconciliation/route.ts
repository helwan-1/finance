import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { DEMO_RECON_SESSIONS } from "@/lib/demo-reconciliation";
import { authorize } from "@/lib/auth/guard";
import { withTenantContext } from "@/lib/db/tenant";
import type {
  ReconMatchDTO,
  ReconSessionDTO,
  ReconciliationResponse,
} from "@/lib/ui-types";

/**
 * GET /api/reconciliation?engagementId=...
 *
 * MULTI-TENANCY: every query is scoped by auditFirmId + engagementId. Falls
 * back to an in-memory demo session when no database is provisioned.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const engagementId = searchParams.get("engagementId");

  const authz = await authorize("reconciliation:view");
  if (!authz.ok) return authz.response;

  // Non-production demo path (no session).
  if (!authz.session) {
    return NextResponse.json<ReconciliationResponse>({
      sessions: DEMO_RECON_SESSIONS,
    });
  }
  if (!engagementId) {
    return NextResponse.json<ReconciliationResponse>({ sessions: [] });
  }

  try {
    const rows = await withTenantContext(authz.session.auditFirmId, (tx) =>
      tx.reconciliationSession.findMany({
        where: { engagementId },
        orderBy: { createdAt: "desc" },
        include: {
          matches: {
            orderBy: { status: "asc" },
            include: {
              sourceTxn: { select: { reference: true, amount: true } },
              targetTxn: { select: { reference: true } },
            },
          },
        },
      }),
    );

    const sessions: ReconSessionDTO[] = rows.map((s) => {
      const matches: ReconMatchDTO[] = s.matches.map((m) => ({
        id: m.id,
        sourceRef: m.sourceTxn.reference,
        sourceAmount: m.sourceTxn.amount.toString(),
        targetRef: m.targetTxn?.reference ?? null,
        status: m.status === "DISPUTED" ? "UNMATCHED" : m.status,
        confidence: m.confidence.toString(),
        amountDelta: m.amountDelta?.toString() ?? null,
      }));
      const partialCount = matches.filter((m) => m.status === "PARTIAL").length;
      const unmatchedCount = matches.filter(
        (m) => m.status === "UNMATCHED",
      ).length;
      return {
        id: s.id,
        name: s.name,
        status: s.status,
        sourceA: s.sourceA,
        sourceB: s.sourceB,
        matchedCount: matches.filter((m) => m.status === "MATCHED").length,
        partialCount,
        unmatchedCount,
        totalCount: s.totalCount,
        matches,
      };
    });

    return NextResponse.json<ReconciliationResponse>({ sessions });
  } catch {
    return NextResponse.json({ error: "تعذّر تحميل المطابقات" }, { status: 503 });
  }
}
