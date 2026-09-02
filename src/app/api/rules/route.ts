import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { Prisma, RuleCategory } from "@prisma/client";
import { DEMO_RULES } from "@/lib/demo-rules";
import { authorize, requireSession } from "@/lib/auth/guard";
import { withTenantContext } from "@/lib/db/tenant";
import type { RuleDTO, RulesResponse } from "@/lib/ui-types";

const CATEGORIES: RuleCategory[] = ["NUMERIC", "PARTY", "TIMING", "AGGREGATE"];

function toDTO(r: {
  id: string;
  code: string;
  nameAr: string;
  category: RuleCategory;
  severity: string;
  enabled: boolean;
  engagementId: string | null;
  descriptionAr: string | null;
  definition: unknown;
}): RuleDTO {
  return {
    id: r.id,
    code: r.code,
    nameAr: r.nameAr,
    category: r.category,
    severity: r.severity as RuleDTO["severity"],
    enabled: r.enabled,
    scope: r.engagementId ? "ENGAGEMENT" : "FIRM",
    descriptionAr: r.descriptionAr,
    definition: (r.definition ?? {}) as Record<string, unknown>,
  };
}

/**
 * GET /api/rules?engagementId=... — rules applicable to the engagement:
 * firm-wide rules (engagementId null) plus rules scoped to this engagement.
 * Demo fallback returns the professional starter library.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const engagementId = searchParams.get("engagementId");

  const authz = await authorize("rules:view");
  if (!authz.ok) return authz.response;

  // Non-production demo path (no session) → the starter library.
  if (!authz.session) {
    return NextResponse.json<RulesResponse>({ rules: DEMO_RULES });
  }

  try {
    const rows = await withTenantContext(authz.session.auditFirmId, (tx) =>
      tx.auditRule.findMany({
        where: engagementId
          ? { OR: [{ engagementId: null }, { engagementId }] }
          : { engagementId: null },
        orderBy: [{ category: "asc" }, { code: "asc" }],
      }),
    );
    return NextResponse.json<RulesResponse>({ rules: rows.map(toDTO) });
  } catch {
    return NextResponse.json({ error: "تعذّر تحميل القواعد" }, { status: 503 });
  }
}

interface CreateBody {
  engagementId?: string | null;
  code?: string;
  nameAr?: string;
  category?: RuleCategory;
  severity?: RuleDTO["severity"];
  descriptionAr?: string;
  scope?: "FIRM" | "ENGAGEMENT";
  definition?: Prisma.InputJsonValue;
}

/** POST /api/rules — create a new rule (requires rules:manage). */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireSession("rules:manage");
  if (!auth.ok) return auth.response;
  const session = auth.session;

  let body: CreateBody;
  try {
    body = (await request.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const code = body.code?.trim();
  const nameAr = body.nameAr?.trim();
  const category = body.category && CATEGORIES.includes(body.category) ? body.category : null;
  if (!code || !nameAr || !category || !body.definition) {
    return NextResponse.json(
      { error: "code, nameAr, category, and definition are required" },
      { status: 400 },
    );
  }

  const wantEngagement =
    body.scope === "ENGAGEMENT" && body.engagementId ? body.engagementId : null;

  try {
    const result = await withTenantContext(session.auditFirmId, async (tx) => {
      let engagementId: string | null = null;
      if (wantEngagement) {
        // RLS makes a cross-tenant engagement invisible → treated as invalid.
        const eng = await tx.auditEngagement.findUnique({
          where: { id: wantEngagement },
          select: { id: true },
        });
        if (!eng) return "invalid_engagement" as const;
        engagementId = wantEngagement;
      }
      return tx.auditRule.create({
        data: {
          auditFirmId: session.auditFirmId,
          engagementId,
          code,
          name: code,
          nameAr,
          category,
          severity: body.severity ?? "MEDIUM",
          descriptionAr: body.descriptionAr ?? null,
          definition: body.definition!,
          createdById: session.userId,
        },
      });
    });

    if (result === "invalid_engagement") {
      return NextResponse.json({ error: "Invalid engagement" }, { status: 403 });
    }
    return NextResponse.json(toDTO(result), { status: 201 });
  } catch {
    return NextResponse.json({ error: "تعذّر إنشاء القاعدة" }, { status: 503 });
  }
}
