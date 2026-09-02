import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import type { SessionUser } from "@/lib/auth/session";

// Mock the session resolver so we can drive authenticated / unauthenticated.
vi.mock("@/lib/auth/session", () => ({
  getSession: vi.fn(),
}));

import { getSession } from "@/lib/auth/session";
import { authorize, requireSession } from "@/lib/auth/guard";

const mockGetSession = getSession as unknown as ReturnType<typeof vi.fn>;
const partner: SessionUser = {
  userId: "u1",
  auditFirmId: "firmA",
  role: "PARTNER",
  fullNameAr: "شريك",
};
const reviewer: SessionUser = { ...partner, role: "REVIEWER" };

beforeEach(() => mockGetSession.mockReset());
afterEach(() => vi.unstubAllEnvs());

describe("authorize() — read paths", () => {
  it("DENIES an unauthenticated request in production (401)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    mockGetSession.mockResolvedValue(null);
    const r = await authorize("anomalies:view");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(401);
  });

  it("DENIES an unauthenticated request when AUTH_REQUIRED=true (401)", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("AUTH_REQUIRED", "true");
    mockGetSession.mockResolvedValue(null);
    const r = await authorize("anomalies:view");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(401);
  });

  it("allows the demo path (null session) only outside production", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("AUTH_REQUIRED", "false");
    mockGetSession.mockResolvedValue(null);
    const r = await authorize("anomalies:view");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.session).toBeNull();
  });

  it("returns 403 when the role lacks the permission", async () => {
    mockGetSession.mockResolvedValue(reviewer);
    const r = await authorize("data:export");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(403);
  });

  it("passes an authorized authenticated request with the session", async () => {
    mockGetSession.mockResolvedValue(partner);
    const r = await authorize("anomalies:view");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.session?.auditFirmId).toBe("firmA");
  });
});

describe("requireSession() — write paths (always fail-closed)", () => {
  it("returns 401 without a session even outside production", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("AUTH_REQUIRED", "false");
    mockGetSession.mockResolvedValue(null);
    const r = await requireSession("rules:manage");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(401);
  });

  it("returns 403 when the role lacks the write permission", async () => {
    mockGetSession.mockResolvedValue(reviewer);
    const r = await requireSession("rules:manage");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(403);
  });

  it("passes a permitted write with the session", async () => {
    mockGetSession.mockResolvedValue(partner);
    const r = await requireSession("rules:manage");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.session.userId).toBe("u1");
  });
});
