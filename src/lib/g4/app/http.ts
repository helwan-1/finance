import { NextResponse } from "next/server";
import { RunAccessError } from "./run-access";

/**
 * Map a boundary error to an HTTP response. RunAccessError carries the intended
 * status (404 for not-found/foreign-firm — no cross-firm existence oracle; 403
 * for a non-member of the engagement). Everything else is a 400 (bad request /
 * domain precondition) with a generic message — never leak internals.
 */
export function runErrorResponse(e: unknown): NextResponse {
  if (e instanceof RunAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  const msg = e instanceof Error ? e.message : "request failed";
  return NextResponse.json({ error: msg }, { status: 400 });
}
