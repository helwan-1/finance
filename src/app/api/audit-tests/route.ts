import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authorize } from "@/lib/auth/guard";
import { listAuditTests, createAuditTest, CREATABLE_TEST_KINDS } from "@/lib/g4/app/run-access";
import { runErrorResponse } from "@/lib/g4/app/http";

/** GET /api/audit-tests — firm audit tests with an ACTIVE current version,
 *  plus the catalog of executor kinds that can be authored from the UI. */
export async function GET(): Promise<NextResponse> {
  const authz = await authorize("runs:view");
  if (!authz.ok) return authz.response;
  if (!authz.session) return NextResponse.json({ tests: [], creatable: [] });
  try {
    const tests = await listAuditTests({ userId: authz.session.userId, auditFirmId: authz.session.auditFirmId });
    const creatable = Object.values(CREATABLE_TEST_KINDS);
    return NextResponse.json({ tests, creatable });
  } catch (e) {
    return runErrorResponse(e);
  }
}

interface CreateBody {
  key?: string;
  name?: string;
  nameAr?: string;
  testType?: string;
  kind?: string;
  requiredDatasetKinds?: string[];
  requiresAccountMapping?: boolean;
  params?: Record<string, unknown>;
}

/** POST /api/audit-tests — author a new firm audit test (ACTIVE version 1). */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const authz = await authorize("runs:manage");
  if (!authz.ok) return authz.response;
  if (!authz.session) return NextResponse.json({ error: "UNAUTHENTICATED", code: "UNAUTHENTICATED" }, { status: 401 });
  let body: CreateBody;
  try {
    body = (await request.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body", code: "VALIDATION" }, { status: 422 });
  }
  try {
    const out = await createAuditTest(
      { userId: authz.session.userId, auditFirmId: authz.session.auditFirmId },
      {
        key: body.key ?? "",
        name: body.name ?? "",
        nameAr: body.nameAr ?? "",
        testType: body.testType ?? "",
        kind: body.kind ?? "",
        requiredDatasetKinds: Array.isArray(body.requiredDatasetKinds) ? body.requiredDatasetKinds : [],
        requiresAccountMapping: Boolean(body.requiresAccountMapping),
        params: body.params && typeof body.params === "object" ? body.params : undefined,
      },
    );
    return NextResponse.json(out, { status: 201 });
  } catch (e) {
    return runErrorResponse(e);
  }
}
