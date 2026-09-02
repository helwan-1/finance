import { NextResponse } from "next/server";

/**
 * DEPRECATED (G2). The previous direct ledger import created transactions with
 * silently fabricated dates/types/sources and no source-file custody or row
 * lineage. It is replaced by the lineage-aware two-phase flow:
 *
 *   POST /api/imports              → stores the SourceFile, validates rows,
 *                                    halts at READY (no transactions yet)
 *   POST /api/imports/:id/confirm  → explicit auditor confirmation → IMPORTING
 *
 * This endpoint is retired to remove the destructive path from the API surface.
 */
export async function POST(): Promise<NextResponse> {
  return NextResponse.json(
    {
      error: "gone",
      message:
        "هذا المسار أُلغي. استخدم /api/imports (استيراد بمسار المصدر والتتبّع) ثم التأكيد عبر /api/imports/:id/confirm.",
      replacement: { start: "/api/imports", confirm: "/api/imports/:id/confirm" },
    },
    { status: 410 },
  );
}
