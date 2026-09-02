import { describe, it, expect, afterEach, vi } from "vitest";
import {
  isProduction,
  authEnforced,
  demoAllowed,
  getSessionSecret,
  checkSecurityConfig,
} from "@/lib/security/env";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("G1 security policy (fail-closed)", () => {
  it("production always enforces auth and forbids the demo path", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_REQUIRED", "false");
    expect(isProduction()).toBe(true);
    expect(authEnforced()).toBe(true);
    expect(demoAllowed()).toBe(false);
  });

  it("non-production allows the demo path unless AUTH_REQUIRED=true", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("AUTH_REQUIRED", "false");
    expect(demoAllowed()).toBe(true);
    vi.stubEnv("AUTH_REQUIRED", "true");
    expect(authEnforced()).toBe(true);
    expect(demoAllowed()).toBe(false);
  });
});

describe("G1 secret validation", () => {
  it("rejects a known placeholder secret in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_SECRET", "change-me-to-a-long-random-string");
    expect(() => getSessionSecret()).toThrow();
  });

  it("rejects a too-short secret in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_SECRET", "short-secret");
    expect(() => getSessionSecret()).toThrow();
  });

  it("accepts a strong secret in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_SECRET", "x".repeat(40));
    expect(getSessionSecret()).toHaveLength(40);
  });

  it("flags a misleading AUTH_REQUIRED=false in production config", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_SECRET", "x".repeat(40));
    vi.stubEnv("AUTH_REQUIRED", "false");
    expect(checkSecurityConfig().some((p) => p.includes("ignored"))).toBe(true);
  });
});
