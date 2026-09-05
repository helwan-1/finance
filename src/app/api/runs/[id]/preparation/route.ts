import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth/guard";
import { beginRunPreparation } from "@/lib/g4/app/run-access";
import type { TestSelection } from "@/lib/g4/preparation";
import { runErrorResponse } from "@/lib/g4/app/http";

interface Body {
  tests?: unknown;
  datasetIds?: unknown;
  batchSize?: unknown;
}

/**
 * POST /api/runs/:id/preparation — begin a preparation generation for the run
 * (pins test versions + datasets, resolves scope). Does NOT materialize the
 * population (no unbounded scan over HTTP) and starts no job.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const auth = await requireSession("runs:manage");
  if (!auth.ok) return auth.response;

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body", code: "VALIDATION" }, { status: 422 });
  }

  const tests = Array.isArray(body.tests)
    ? body.tests
        .map((t) => (t && typeof t === "object" && typeof (t as { testKey?: unknown }).testKey === "string"
          ? ({ testKey: (t as { testKey: string }).testKey, parameters: (t as { parameters?: Record<string, unknown> }).parameters } as TestSelection)
          : null))
        .filter((t): t is TestSelection => t !== null)
    : [];
  const datasetIds = Array.isArray(body.datasetIds) ? body.datasetIds.filter((d): d is string => typeof d === "string") : [];
  if (tests.length === 0 || datasetIds.length === 0) {
    return NextResponse.json({ error: "tests[] and datasetIds[] are required", code: "VALIDATION" }, { status: 422 });
  }
  const batchSize = typeof body.batchSize === "number" ? body.batchSize : undefined;

  try {
    const out = await beginRunPreparation(
      { userId: auth.session.userId, auditFirmId: auth.session.auditFirmId },
      params.id,
      { tests, datasetIds, batchSize },
    );
    return NextResponse.json(out, { status: 201 });
  } catch (e) {
    return runErrorResponse(e);
  }
}
