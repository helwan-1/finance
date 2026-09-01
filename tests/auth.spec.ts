import { describe, it, expect, beforeAll } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { can, ROLE_PERMISSIONS } from "@/lib/auth/rbac";
import {
  createSessionToken,
  verifySessionToken,
  type SessionUser,
} from "@/lib/auth/session";

beforeAll(() => {
  process.env.AUTH_SECRET = "unit-test-secret-please-change-0123456789";
});

describe("password hashing", () => {
  it("verifies a correct password and rejects a wrong one", async () => {
    const hash = await hashPassword("Audit@1234");
    expect(await verifyPassword("Audit@1234", hash)).toBe(true);
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });
  it("rejects against an empty hash", async () => {
    expect(await verifyPassword("anything", "")).toBe(false);
  });
});

describe("rbac", () => {
  it("grants read-only roles view but not resolve", () => {
    expect(can("REVIEWER", "anomalies:view")).toBe(true);
    expect(can("REVIEWER", "anomalies:resolve")).toBe(false);
    expect(can("REVIEWER", "data:export")).toBe(false);
  });
  it("grants field roles resolve and export", () => {
    expect(can("SENIOR", "anomalies:resolve")).toBe(true);
    expect(can("SENIOR", "data:export")).toBe(true);
  });
  it("grants admins and partners everything", () => {
    for (const p of ROLE_PERMISSIONS.ADMIN) {
      expect(can("PARTNER", p)).toBe(true);
    }
  });
  it("limits staff to non-destructive capabilities", () => {
    expect(can("STAFF", "documents:upload")).toBe(true);
    expect(can("STAFF", "anomalies:resolve")).toBe(false);
    expect(can("STAFF", "engagement:manage")).toBe(false);
  });
});

describe("session tokens", () => {
  const user: SessionUser = {
    userId: "u1",
    auditFirmId: "firm1",
    role: "SENIOR",
    fullNameAr: "سارة",
  };

  it("round-trips a signed session", async () => {
    const token = await createSessionToken(user);
    const decoded = await verifySessionToken(token);
    expect(decoded).not.toBeNull();
    expect(decoded?.userId).toBe("u1");
    expect(decoded?.auditFirmId).toBe("firm1");
    expect(decoded?.role).toBe("SENIOR");
  });

  it("rejects a tampered token", async () => {
    const token = await createSessionToken(user);
    expect(await verifySessionToken(token.slice(0, -3) + "xyz")).toBeNull();
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await createSessionToken(user);
    process.env.AUTH_SECRET = "a-different-secret-0123456789abcdef";
    const decoded = await verifySessionToken(token);
    process.env.AUTH_SECRET = "unit-test-secret-please-change-0123456789";
    expect(decoded).toBeNull();
  });
});
