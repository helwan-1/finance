import { describe, it, expect, beforeAll, vi } from "vitest";
import { NextRequest } from "next/server";

// No session in tests → routes take the public demo path.
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: () => undefined,
    getAll: () => [],
    set: () => {},
    delete: () => {},
  }),
}));

beforeAll(() => {
  process.env.AUTH_REQUIRED = "false";
});

import { GET as anomaliesGET } from "@/app/api/anomalies/route";
import { GET as documentsGET } from "@/app/api/documents/route";
import { GET as analyticsGET } from "@/app/api/analytics/route";
import { GET as auditLogGET } from "@/app/api/audit-log/route";
import { GET as reconciliationGET } from "@/app/api/reconciliation/route";
import { GET as exportGET } from "@/app/api/anomalies/export/route";

function req(url: string): NextRequest {
  return new NextRequest(url);
}

describe("GET /api/anomalies (demo path)", () => {
  it("returns the demo feed when no engagement is selected", async () => {
    const res = await anomaliesGET(req("http://localhost/api/anomalies"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.total).toBe(body.anomalies.length);
    expect(body.total).toBeGreaterThan(0);
  });

  it("applies a severity filter", async () => {
    const res = await anomaliesGET(
      req("http://localhost/api/anomalies?severity=CRITICAL"),
    );
    const body = await res.json();
    expect(body.anomalies.every((a: { severity: string }) => a.severity === "CRITICAL")).toBe(true);
  });

  it("applies a search filter by reference", async () => {
    const res = await anomaliesGET(
      req("http://localhost/api/anomalies?search=INV-7781"),
    );
    const body = await res.json();
    expect(body.total).toBe(1);
    expect(body.anomalies[0].reference).toBe("INV-7781");
  });
});

describe("other GET routes (demo path)", () => {
  it("documents returns the demo document set", async () => {
    const res = await documentsGET(req("http://localhost/api/documents"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.documents.length).toBeGreaterThan(0);
  });

  it("analytics returns a Benford result that rejects the demo population", async () => {
    const res = await analyticsGET(req("http://localhost/api/analytics"));
    const body = await res.json();
    expect(body.digits).toHaveLength(9);
    expect(body.rejectsBenford).toBe(true);
  });

  it("audit-log returns the demo trail", async () => {
    const res = await auditLogGET(req("http://localhost/api/audit-log"));
    const body = await res.json();
    expect(body.logs.length).toBeGreaterThan(0);
  });

  it("reconciliation returns the demo session", async () => {
    const res = await reconciliationGET(
      req("http://localhost/api/reconciliation"),
    );
    const body = await res.json();
    expect(body.sessions.length).toBeGreaterThan(0);
    expect(body.sessions[0].matches.length).toBeGreaterThan(0);
  });
});

describe("GET /api/anomalies/export", () => {
  it("streams a valid .xlsx workbook", async () => {
    const res = await exportGET(req("http://localhost/api/anomalies/export"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain(
      "spreadsheetml.sheet",
    );
    expect(res.headers.get("Content-Disposition")).toContain(".xlsx");
    const buf = Buffer.from(await res.arrayBuffer());
    // .xlsx is a ZIP archive → starts with "PK".
    expect(buf.length).toBeGreaterThan(0);
    expect(buf.subarray(0, 2).toString()).toBe("PK");
  });
});
