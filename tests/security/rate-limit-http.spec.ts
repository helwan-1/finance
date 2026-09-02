import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { rateLimit, __resetRateLimit } from "@/lib/security/rate-limit";
import { isAllowedRequestOrigin, securityHeaders } from "@/lib/security/http";

describe("rate limiter", () => {
  beforeEach(() => __resetRateLimit());

  it("allows up to max then blocks with a retry hint", () => {
    const opts = { windowMs: 60_000, max: 3 };
    expect(rateLimit("k", opts).allowed).toBe(true);
    expect(rateLimit("k", opts).allowed).toBe(true);
    expect(rateLimit("k", opts).allowed).toBe(true);
    const blocked = rateLimit("k", opts);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
  });

  it("keys are independent", () => {
    const opts = { windowMs: 60_000, max: 1 };
    expect(rateLimit("a", opts).allowed).toBe(true);
    expect(rateLimit("a", opts).allowed).toBe(false);
    expect(rateLimit("b", opts).allowed).toBe(true);
  });
});

function req(method: string, headers: Record<string, string>): NextRequest {
  return new NextRequest("http://localhost/api/rules", { method, headers });
}

describe("CSRF origin boundary", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("allows non-mutating methods", () => {
    expect(isAllowedRequestOrigin(req("GET", {}))).toBe(true);
  });

  it("blocks a state-changing request with no Origin", () => {
    expect(isAllowedRequestOrigin(req("POST", {}))).toBe(false);
  });

  it("blocks a cross-origin state-changing request", () => {
    expect(
      isAllowedRequestOrigin(req("POST", { origin: "https://evil.example" })),
    ).toBe(false);
  });

  it("allows an explicitly allow-listed origin", () => {
    vi.stubEnv("ALLOWED_ORIGINS", "https://app.example");
    expect(
      isAllowedRequestOrigin(req("POST", { origin: "https://app.example" })),
    ).toBe(true);
  });
});

describe("security headers", () => {
  it("includes core headers and a frame-blocking CSP", () => {
    const h = securityHeaders(false);
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["X-Frame-Options"]).toBe("DENY");
    expect(h["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(h["Content-Security-Policy"]).toContain("object-src 'none'");
  });

  it("adds HSTS only in production and drops unsafe-eval there", () => {
    expect(securityHeaders(true)["Strict-Transport-Security"]).toBeDefined();
    expect(securityHeaders(false)["Strict-Transport-Security"]).toBeUndefined();
    expect(securityHeaders(true)["Content-Security-Policy"]).not.toContain(
      "unsafe-eval",
    );
    expect(securityHeaders(false)["Content-Security-Policy"]).toContain(
      "unsafe-eval",
    );
  });
});
