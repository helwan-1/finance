import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { securityHeaders, isAllowedRequestOrigin } from "@/lib/security/http";

/**
 * Edge middleware (G1): applies security headers to every response and enforces
 * the CSRF origin boundary on state-changing API requests. Runs before route
 * handlers; uses only edge-safe APIs.
 */
export function middleware(req: NextRequest): NextResponse {
  const isProd = process.env.NODE_ENV === "production";
  const { pathname } = req.nextUrl;

  // CSRF: block cross-origin state-changing API calls.
  if (pathname.startsWith("/api/") && !isAllowedRequestOrigin(req)) {
    const res = NextResponse.json(
      { error: "Cross-origin request blocked" },
      { status: 403 },
    );
    for (const [k, v] of Object.entries(securityHeaders(isProd))) {
      res.headers.set(k, v);
    }
    return res;
  }

  const res = NextResponse.next();
  for (const [k, v] of Object.entries(securityHeaders(isProd))) {
    res.headers.set(k, v);
  }
  return res;
}

export const config = {
  // Everything except Next internals and static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
