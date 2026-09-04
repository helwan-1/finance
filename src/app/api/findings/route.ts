import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { authorize, requireSession } from "@/lib/auth/guard";
import { withTenantContext } from "@/lib/db/tenant";
import { createExceptionFromResult } from "@/lib/g5/exception";
import { g5ErrorResponse } from "@/lib/g5/http-errors";
import type {
  ExceptionDTO,
  ExceptionsResponse,
  ExceptionStatus,
  MatterPriority,
} from "@/lib/ui-types";

const STATUSES: ExceptionStatus[] = [
  "OPEN",
  "UNDER_INVESTIGATION",
  "CONCLUDED_WITH_FINDING",
  "CLOSED_NO_FINDING",
];

/**
 * GET /api/findings?engagementId=...&status=...
 *
 * Lists professional exceptions (matters) for an engagement with per-matter
 * counts of linked audit results and findings. Tenant scoping is enforced by
 * withTenantContext (RLS); engagementId is an ordinary filter.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const engagementId = searchParams.get("engagementId");
  const statusParam = searchParams.get("status");

  const authz = await authorize("findings:view");
  if (!authz.ok) return authz.response;

  if (!authz.session || !engagementId) {
    return NextResponse.json<ExceptionsResponse>({ exceptions: [], total: 0 });
  }

  const where: Prisma.AuditExceptionWhereInput = {
    engagementId,
    ...(statusParam && STATUSES.includes(statusParam as ExceptionStatus)
      ? { currentStatus: statusParam as ExceptionStatus }
      : {}),
  };

  try {
    const { rows, linkMap, findMap } = await withTenantContext(
      authz.session.auditFirmId,
      async (tx) => {
        const rows = await tx.auditException.findMany({
          where,
          orderBy: { updatedAt: "desc" },
          take: 200,
        });
        const ids = rows.map((r) => r.id);
        const [linkGroups, findingGroups] = await Promise.all([
          tx.auditExceptionResultLink.groupBy({
            by: ["exceptionId"],
            where: { exceptionId: { in: ids }, active: true },
            _count: { _all: true },
          }),
          tx.auditFinding.groupBy({
            by: ["exceptionId"],
            where: { exceptionId: { in: ids } },
            _count: { _all: true },
          }),
        ]);
        return {
          rows,
          linkMap: new Map(linkGroups.map((g) => [g.exceptionId, g._count._all])),
          findMap: new Map(findingGroups.map((g) => [g.exceptionId, g._count._all])),
        };
      },
    );

    const exceptions: ExceptionDTO[] = rows.map((r) => ({
      id: r.id,
      status: r.currentStatus,
      priority: r.priority,
      title: r.currentTitle,
      titleAr: r.currentTitleAr,
      description: r.currentDescription,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      linkedResultCount: linkMap.get(r.id) ?? 0,
      findingCount: findMap.get(r.id) ?? 0,
    }));

    return NextResponse.json<ExceptionsResponse>({
      exceptions,
      total: exceptions.length,
    });
  } catch {
    return NextResponse.json({ error: "تعذّر تحميل البيانات" }, { status: 503 });
  }
}

interface CreateBody {
  engagementId?: unknown;
  firstResultId?: unknown;
  title?: unknown;
  titleAr?: unknown;
  description?: unknown;
  priority?: unknown;
}

/**
 * POST /api/findings — create a professional exception (matter) from an audit
 * result. Body: { engagementId, firstResultId, title, titleAr?, description?, priority? }
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireSession("findings:manage");
  if (!auth.ok) return auth.response;

  let body: CreateBody;
  try {
    body = (await request.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const engagementId = typeof body.engagementId === "string" ? body.engagementId.trim() : "";
  const firstResultId = typeof body.firstResultId === "string" ? body.firstResultId.trim() : "";
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!engagementId || !firstResultId || !title) {
    return NextResponse.json(
      { error: "engagementId و firstResultId و العنوان حقول مطلوبة" },
      { status: 400 },
    );
  }
  const priority: MatterPriority =
    body.priority === "LOW" || body.priority === "HIGH" ? body.priority : "MEDIUM";
  const titleAr =
    typeof body.titleAr === "string" && body.titleAr.trim() ? body.titleAr.trim() : null;
  const description =
    typeof body.description === "string" && body.description.trim()
      ? body.description.trim()
      : null;

  try {
    const { exceptionId } = await createExceptionFromResult(auth.session.auditFirmId, {
      engagementId,
      createdById: auth.session.userId,
      title,
      titleAr,
      description,
      priority,
      firstResultId,
      idempotencyKey: randomUUID(),
    });
    return NextResponse.json({ exceptionId }, { status: 201 });
  } catch (e) {
    return g5ErrorResponse(e);
  }
}
