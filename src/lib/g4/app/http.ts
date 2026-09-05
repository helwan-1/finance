import { NextResponse } from "next/server";
import { RunAccessError, RunStateError, RunValidationError, RunConfigError } from "./run-access";
import { PreparationIncompleteError } from "@/lib/g4/preparation";

/** Prisma connection/availability error codes (DB unreachable / timed out). */
const DB_UNAVAILABLE_CODES = new Set(["P1000", "P1001", "P1002", "P1008", "P1017"]);
function isDbUnavailable(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  const err = e as { name?: string; code?: string };
  if (err.name === "PrismaClientInitializationError") return true;
  return typeof err.code === "string" && DB_UNAVAILABLE_CODES.has(err.code);
}

/**
 * Deterministic G6 error → HTTP mapping for the Phase B run routes. Codes are
 * stable and machine-readable; raw Prisma/PostgreSQL error text is NEVER
 * forwarded to the client. Mirrors the project convention (typed domain errors
 * get specific codes; anything unexpected falls through to 503 with a generic
 * message — see src/lib/g5/http-errors.ts).
 *
 *   RunAccessError  FORBIDDEN → 403 ENGAGEMENT_ACCESS_DENIED
 *                   NOT_FOUND → 404 AUDIT_RUN_NOT_FOUND (also tenant-hidden)
 *   RunStateError             → 409 INVALID_RUN_STATE | PREPARATION_NOT_COMPLETE
 *   RunValidationError        → 422 VALIDATION
 *   RunConfigError            → 422 CONFIGURATION
 *   DB unreachable/init       → 503 DB_UNAVAILABLE
 *   anything else             → 503 INTERNAL (generic; no raw details leaked)
 *
 * (401 UNAUTHENTICATED / 403 RBAC are produced earlier by the auth guard.)
 */
export function runErrorResponse(e: unknown): NextResponse {
  if (e instanceof RunAccessError) {
    const code = e.code === "NOT_FOUND" ? "AUDIT_RUN_NOT_FOUND" : "ENGAGEMENT_ACCESS_DENIED";
    return NextResponse.json({ error: e.message, code }, { status: e.status });
  }
  if (e instanceof RunStateError) {
    return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
  }
  // Engine-authoritative completeness failure (a direct/internal caller reaching
  // sealPreparation without the boundary precheck) maps to the SAME contract.
  if (e instanceof PreparationIncompleteError) {
    return NextResponse.json({ error: e.message, code: "PREPARATION_NOT_COMPLETE" }, { status: 409 });
  }
  if (e instanceof RunValidationError) {
    return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
  }
  if (e instanceof RunConfigError) {
    return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
  }
  if (isDbUnavailable(e)) {
    return NextResponse.json({ error: "قاعدة البيانات غير متاحة حالياً. حاول لاحقاً.", code: "DB_UNAVAILABLE" }, { status: 503 });
  }
  // Unexpected: never leak raw DB/error internals (project convention → 503).
  return NextResponse.json({ error: "تعذّر تنفيذ العملية. حاول مرة أخرى.", code: "INTERNAL" }, { status: 503 });
}
