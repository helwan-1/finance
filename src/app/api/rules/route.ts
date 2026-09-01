import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { Prisma, RuleCategory } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { DEMO_RULES } from "@/lib/demo-rules";
import { authorize } from "@/lib/auth/guard";
import { getSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
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

  const authz = await authorize("rules:view", engagementId);
  if (!authz.ok) return authz.response;

  try {
    if (!engagementId) {
      return NextResponse.json<RulesResponse>({ rules: DEMO_RULES });
    }
    const engagement = await prisma.auditEngagement.findUnique({
      where: { id: engagementId },
      select: { auditFirmId: true },
    });
    if (!engagement) {
      return NextResponse.json<RulesResponse>({ rules: DEMO_RULES });
    }

    const rows = await prisma.auditRule.findMany({
      where: {
        auditFirmId: engagement.auditFirmId,
        OR: [{ engagementId: null }, { engagementId }],
      },
      orderBy: [{ category: "asc" }, { code: "asc" }],
    });
    return NextResponse.json<RulesResponse>({ rules: rows.map(toDTO) });
  } catch {
    return NextResponse.json<RulesResponse>({ rules: DEMO_RULES });
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
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  if (!can(session.role, "rules:manage")) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

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

  try {
    // Engagement scope must belong to the caller's firm.
    let engagementId: string | null = null;
    if (body.scope === "ENGAGEMENT" && body.engagementId) {
      const eng = await prisma.auditEngagement.findUnique({
        where: { id: body.engagementId },
        select: { auditFirmId: true },
      });
      if (!eng || eng.auditFirmId !== session.auditFirmId) {
        return NextResponse.json({ error: "Invalid engagement" }, { status: 403 });
      }
      engagementId = body.engagementId;
    }

    const created = await prisma.auditRule.create({
      data: {
        auditFirmId: session.auditFirmId,
        engagementId,
        code,
        name: code,
        nameAr,
        category,
        severity: body.severity ?? "MEDIUM",
        descriptionAr: body.descriptionAr ?? null,
        definition: body.definition,
        createdById: session.userId,
      },
    });
    return NextResponse.json(toDTO(created), { status: 201 });
  } catch {
    return NextResponse.json({ error: "تعذّر إنشاء القاعدة" }, { status: 503 });
  }
}
