import { NextResponse } from "next/server";
import { IdempotencyConflictError, PreconditionError } from "./errors";
import { isProduction } from "@/lib/security/env";

/**
 * Map a G5 service error to an HTTP response.
 *
 * - PreconditionError        → 400 (a professional precondition was not met).
 * - IdempotencyConflictError → 409 (same key replayed with a different payload).
 * - anything else            → 503 (DB unreachable / unexpected), Arabic message.
 *
 * The G5 errors are plain classes (routes hand-roll responses), so callers catch
 * and pass the error here instead of a shared framework doing it for them.
 */
export function g5ErrorResponse(e: unknown): NextResponse {
  if (e instanceof PreconditionError) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
  if (e instanceof IdempotencyConflictError) {
    return NextResponse.json({ error: e.message }, { status: 409 });
  }
  // Unexpected: log it, and outside production append the real cause so it is
  // diagnosable during setup/testing rather than a bare "try again".
  console.error("[g5] operation failed", e);
  const code = (e as { code?: string })?.code;
  const detail = !isProduction() && e instanceof Error ? ` — ${code ? code + ": " : ""}${e.message}` : "";
  return NextResponse.json(
    { error: `تعذّر تنفيذ العملية. حاول مرة أخرى.${detail}` },
    { status: 503 },
  );
}
