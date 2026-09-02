import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSession } from "@/lib/auth/session";
import { requireSession } from "@/lib/auth/guard";
import { demoAllowed } from "@/lib/security/env";
import { withTenantContext } from "@/lib/db/tenant";
import { DEMO_ENGAGEMENTS } from "@/lib/demo-data";
import type { EngagementSummary } from "@/lib/ui-types";

/**
 * GET /api/engagements — the caller's engagements (from the DB), so the UI runs
 * on real data. Without a session the non-production demo list is served;
 * production fails closed.
 */
export async function GET(): Promise<NextResponse> {
  const session = await getSession();
  if (!session) {
    if (demoAllowed()) return NextResponse.json({ engagements: DEMO_ENGAGEMENTS });
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  try {
    const rows = await withTenantContext(session.auditFirmId, (tx) =>
      tx.auditEngagement.findMany({
        orderBy: [{ fiscalYear: "desc" }, { createdAt: "desc" }],
        include: { clientCompany: { select: { nameAr: true } } },
      }),
    );
    const engagements: EngagementSummary[] = rows.map((e) => ({
      id: e.id,
      titleAr: e.titleAr,
      clientNameAr: e.clientCompany.nameAr,
      fiscalYear: e.fiscalYear,
    }));
    return NextResponse.json({ engagements });
  } catch {
    return NextResponse.json({ error: "تعذّر تحميل المهام" }, { status: 503 });
  }
}

interface CreateBody {
  clientNameAr?: string;
  clientVatNumber?: string;
  titleAr?: string;
  fiscalYear?: number;
  periodStart?: string;
  periodEnd?: string;
}

/** POST /api/engagements — create a client + engagement (requires engagement:manage). */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireSession("engagement:manage");
  if (!auth.ok) return auth.response;
  const session = auth.session;

  let body: CreateBody;
  try {
    body = (await request.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const clientNameAr = body.clientNameAr?.trim();
  const titleAr = body.titleAr?.trim();
  const fiscalYear =
    typeof body.fiscalYear === "number" ? Math.floor(body.fiscalYear) : NaN;
  if (!clientNameAr || !titleAr || !Number.isFinite(fiscalYear)) {
    return NextResponse.json(
      { error: "clientNameAr, titleAr and fiscalYear are required" },
      { status: 400 },
    );
  }

  const periodStart = body.periodStart
    ? new Date(body.periodStart)
    : new Date(Date.UTC(fiscalYear, 0, 1));
  const periodEnd = body.periodEnd
    ? new Date(body.periodEnd)
    : new Date(Date.UTC(fiscalYear, 11, 31));

  try {
    const engagement = await withTenantContext(session.auditFirmId, async (tx) => {
      const client = await tx.clientCompany.create({
        data: {
          auditFirmId: session.auditFirmId,
          name: clientNameAr,
          nameAr: clientNameAr,
          vatNumber: body.clientVatNumber?.trim() || null,
        },
      });
      return tx.auditEngagement.create({
        data: {
          auditFirmId: session.auditFirmId,
          clientCompanyId: client.id,
          title: titleAr,
          titleAr,
          fiscalYear,
          periodStart,
          periodEnd,
          currency: "SAR",
          members: { create: [{ userId: session.userId }] },
        },
        include: { clientCompany: { select: { nameAr: true } } },
      });
    });

    const dto: EngagementSummary = {
      id: engagement.id,
      titleAr: engagement.titleAr,
      clientNameAr: engagement.clientCompany.nameAr,
      fiscalYear: engagement.fiscalYear,
    };
    return NextResponse.json({ engagement: dto }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "تعذّر إنشاء المهمة" }, { status: 503 });
  }
}
