import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { authorize, requireSession } from "@/lib/auth/guard";
import { withTenantContext } from "@/lib/db/tenant";
import {
  dismissException,
  concludeException,
  reopenException,
} from "@/lib/g5/exception";
import { g5ErrorResponse } from "@/lib/g5/http-errors";
import type {
  ExceptionDetailDTO,
  ExceptionDetailResponse,
  FindingDTO,
  FindingVersionDTO,
} from "@/lib/ui-types";

/** GET /api/findings/[id]?engagementId=... — exception detail with findings. */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const engagementId = searchParams.get("engagementId");

  const authz = await authorize("findings:view");
  if (!authz.ok) return authz.response;
  if (!authz.session) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  try {
    const data = await withTenantContext(authz.session.auditFirmId, async (tx) => {
      const ex = await tx.auditException.findFirst({
        where: { id: params.id, ...(engagementId ? { engagementId } : {}) },
      });
      if (!ex) return null;
      const [links, findings] = await Promise.all([
        tx.auditExceptionResultLink.findMany({
          where: { exceptionId: ex.id, active: true },
          orderBy: { createdAt: "asc" },
        }),
        tx.auditFinding.findMany({
          where: { exceptionId: ex.id },
          orderBy: { createdAt: "asc" },
        }),
      ]);
      const versionIds = findings
        .map((f) => f.currentVersionId)
        .filter((v): v is string => Boolean(v));
      const versions = versionIds.length
        ? await tx.auditFindingVersion.findMany({ where: { id: { in: versionIds } } })
        : [];
      return { ex, links, findings, versions };
    });

    if (!data) {
      return NextResponse.json({ error: "غير موجود" }, { status: 404 });
    }

    const versionById = new Map(data.versions.map((v) => [v.id, v]));
    const toVersionDTO = (id: string | null): FindingVersionDTO | null => {
      if (!id) return null;
      const v = versionById.get(id);
      if (!v) return null;
      return {
        id: v.id,
        versionNo: v.versionNo,
        category: v.category,
        condition: v.condition,
        criteria: v.criteria,
        cause: v.cause,
        effect: v.effect,
        auditorConclusion: v.auditorConclusion,
        recommendation: v.recommendation,
        observedAmount: v.observedAmount ? v.observedAmount.toString() : null,
        observedCurrency: v.observedCurrency,
        estimatedExposureAmount: v.estimatedExposureAmount
          ? v.estimatedExposureAmount.toString()
          : null,
        estimatedExposureCurrency: v.estimatedExposureCurrency,
        preparedById: v.preparedById,
        preparedAt: v.preparedAt.toISOString(),
      };
    };

    const findings: FindingDTO[] = data.findings.map((f) => ({
      id: f.id,
      status: f.currentStatus,
      currentVersionId: f.currentVersionId,
      createdById: f.createdById,
      createdAt: f.createdAt.toISOString(),
      currentVersion: toVersionDTO(f.currentVersionId),
    }));

    const exception: ExceptionDetailDTO = {
      id: data.ex.id,
      status: data.ex.currentStatus,
      priority: data.ex.priority,
      title: data.ex.currentTitle,
      titleAr: data.ex.currentTitleAr,
      description: data.ex.currentDescription,
      createdAt: data.ex.createdAt.toISOString(),
      updatedAt: data.ex.updatedAt.toISOString(),
      linkedResultCount: data.links.length,
      findingCount: data.findings.length,
      linkedResultIds: data.links.map((l) => l.auditResultId),
      findings,
    };

    return NextResponse.json<ExceptionDetailResponse>({ exception });
  } catch {
    return NextResponse.json({ error: "تعذّر تحميل البيانات" }, { status: 503 });
  }
}

interface PatchBody {
  action?: unknown;
  rationale?: unknown;
  reason?: unknown;
}

/**
 * PATCH /api/findings/[id] — exception lifecycle.
 * Body: { action: "DISMISS" | "CONCLUDE" | "REOPEN", rationale?, reason? }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const auth = await requireSession("findings:manage");
  if (!auth.ok) return auth.response;

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const firm = auth.session.auditFirmId;
  const actorId = auth.session.userId;

  try {
    if (body.action === "DISMISS") {
      const rationale = typeof body.rationale === "string" ? body.rationale.trim() : "";
      if (!rationale) {
        return NextResponse.json({ error: "سبب الإغلاق مطلوب" }, { status: 400 });
      }
      await dismissException(firm, {
        exceptionId: params.id,
        actorId,
        rationale,
        idempotencyKey: randomUUID(),
      });
    } else if (body.action === "CONCLUDE") {
      await concludeException(firm, {
        exceptionId: params.id,
        actorId,
        idempotencyKey: randomUUID(),
      });
    } else if (body.action === "REOPEN") {
      const reason = typeof body.reason === "string" ? body.reason.trim() : "";
      if (!reason) {
        return NextResponse.json({ error: "سبب إعادة الفتح مطلوب" }, { status: 400 });
      }
      await reopenException(firm, {
        exceptionId: params.id,
        actorId,
        reason,
        idempotencyKey: randomUUID(),
      });
    } else {
      return NextResponse.json(
        { error: "action يجب أن يكون DISMISS أو CONCLUDE أو REOPEN" },
        { status: 400 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return g5ErrorResponse(e);
  }
}
