import { NextResponse } from "next/server";
import { authorize } from "@/lib/auth/guard";
import { listAuditTests } from "@/lib/g4/app/run-access";
import { runErrorResponse } from "@/lib/g4/app/http";

/** GET /api/audit-tests — firm audit tests with an ACTIVE current version. */
export async function GET(): Promise<NextResponse> {
  const authz = await authorize("runs:view");
  if (!authz.ok) return authz.response;
  if (!authz.session) return NextResponse.json({ tests: [] });
  try {
    const tests = await listAuditTests({ userId: authz.session.userId, auditFirmId: authz.session.auditFirmId });
    return NextResponse.json({ tests });
  } catch (e) {
    return runErrorResponse(e);
  }
}
