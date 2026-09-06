/**
 * G6 PHASE C3-1 — Cross-tenant work locator security (ADR-006), V1–V24.
 *
 * Real PostgreSQL, gated by G4_DB_TEST. Adversarially proves the narrow
 * SECURITY DEFINER locator `app_locate_runnable_work()`, the `audit_dispatch`
 * principal, its ACL, and the `ix_runs_runnable` index against the frozen
 * verification plan in docs/adr-006-cross-tenant-work-locator.md:
 *
 *   ACL / blast radius ....... V1  V2  V3  V4  V5
 *   Output contract .......... V6  V17
 *   Discovery predicates ..... V7  V8  V9  V10 V11 V12 V13
 *   RLS re-derivation floor .. V14 V15 V24
 *   Safety / hardening ....... V16 V18 V22 V23
 *   Fairness / limit / plan .. V19 V20 V21
 *
 * Scope: locator security only. No worker, dispatcher service, scheduler, queue,
 * outbox, or deployment is implemented or tested here (out of C3-1 scope).
 *
 * Roles under test (local disposable cluster):
 *   audit_owner    — superuser/schema owner (DIRECT_DATABASE_URL, `owner`);
 *                    used to seed and to `SET LOCAL ROLE` into other principals.
 *   audit_app      — runtime tenant worker (DATABASE_URL, `prisma`); RLS-subject.
 *   audit_dispatch — dispatcher principal; the only role granted EXECUTE.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withTenantContext } from "@/lib/db/tenant";

const run = process.env.G4_DB_TEST ? describe : describe.skip;
const owner = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_DATABASE_URL } } });

const FN = 'app_locate_runnable_work()';
const LOCATE_SQL = 'SELECT * FROM app_locate_runnable_work()';

type WorkItem = { auditFirmId: string; runId: string; workType: string };
type RunStatus = "DRAFT" | "PREPARING" | "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";
type PrepStatus = "PREPARING" | "COMPLETE" | "FAILED" | "ABANDONED" | "PUBLISHED";
type JobStatus = "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";

// ── seeding (as owner; bypasses RLS; the run/prep UPDATE guards fire only on
//    UPDATE, so direct-state INSERTs are unrestricted) ────────────────────────
async function mkFirm(): Promise<{ firmId: string; engId: string }> {
  const firmId = `c31-${randomUUID()}`;
  await owner.auditFirm.create({ data: { id: firmId, name: firmId, nameAr: firmId, licenseNo: `L-${firmId}` } });
  const clientId = `cl-${firmId}`;
  await owner.clientCompany.create({ data: { id: clientId, auditFirmId: firmId, name: clientId, nameAr: clientId } });
  const engId = `eng-${firmId}`;
  await owner.auditEngagement.create({
    data: {
      id: engId, auditFirmId: firmId, clientCompanyId: clientId, title: engId, titleAr: engId,
      fiscalYear: 2024, periodStart: new Date("2024-01-01"), periodEnd: new Date("2024-12-31"), currency: "SAR",
    },
  });
  return { firmId, engId };
}
async function mkRun(firmId: string, engId: string, status: RunStatus): Promise<string> {
  const r = await owner.auditRun.create({ data: { auditFirmId: firmId, engagementId: engId, status }, select: { id: true } });
  return r.id;
}
async function mkPrep(firmId: string, runId: string, status: PrepStatus, gen = 1): Promise<string> {
  const p = await owner.auditRunPreparation.create({ data: { auditFirmId: firmId, runId, generationNo: gen, status }, select: { id: true } });
  return p.id;
}
async function mkJob(firmId: string, runId: string, attemptNo: number, status: JobStatus, lease: "live" | "expired" | null): Promise<string> {
  const j = await owner.auditJob.create({ data: { auditFirmId: firmId, runId, attemptNo, status }, select: { id: true } });
  if (lease) {
    const expr = lease === "live" ? "now() + interval '5 minutes'" : "now() - interval '5 minutes'";
    await owner.$executeRawUnsafe(`UPDATE public."audit_jobs" SET "leaseExpiresAt" = ${expr}, "leaseOwner" = 'w1' WHERE "id" = $1`, j.id);
  }
  return j.id;
}

// ── running the locator as the dispatcher principal ──────────────────────────
async function locateAsDispatch(): Promise<WorkItem[]> {
  return owner.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL ROLE audit_dispatch");
    return tx.$queryRawUnsafe<WorkItem[]>(LOCATE_SQL);
  });
}
/** Remove every runnable run so a fairness/limit invocation observes only what a
 *  test seeds (the global LIMIT is updatedAt-ASC, so accumulated older runnable
 *  rows would otherwise saturate the window). Owner-only; DELETE cascades. */
async function clearRunnable(): Promise<void> {
  await owner.$executeRawUnsafe(
    `DELETE FROM public."audit_runs" WHERE "status" IN ('PREPARING','QUEUED','RUNNING')`);
}
const runIds = (items: WorkItem[]): Set<string> => new Set(items.map((i) => i.runId));
const boolRow = async (sql: string): Promise<boolean> => {
  const r = await owner.$queryRawUnsafe<Array<{ ok: boolean }>>(sql);
  return r[0]!.ok;
};

run("G6 Phase C3-1 — locator security (V1–V24)", () => {
  beforeAll(async () => {
    // Fail fast if the C3-1 migration has not been applied.
    const fn = await owner.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT count(*) AS n FROM pg_proc WHERE proname = 'app_locate_runnable_work'`);
    expect(Number(fn[0]!.n)).toBe(1);
    const role = await owner.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT count(*) AS n FROM pg_roles WHERE rolname = 'audit_dispatch'`);
    expect(Number(role[0]!.n)).toBe(1);
  }, 120_000);
  afterAll(async () => {
    await owner.$disconnect();
    await prisma.$disconnect();
  });

  // ── ACL / blast radius ─────────────────────────────────────────────────────
  it("V1: audit_app cannot EXECUTE the locator (privilege + live attempt)", async () => {
    expect(await boolRow(`SELECT has_function_privilege('audit_app', '${FN}', 'EXECUTE') AS ok`)).toBe(false);
    await expect(prisma.$queryRawUnsafe(LOCATE_SQL)).rejects.toThrow(/permission denied/i);
  });
  it("V2: PUBLIC cannot EXECUTE the locator", async () => {
    expect(await boolRow(`SELECT has_function_privilege('public', '${FN}', 'EXECUTE') AS ok`)).toBe(false);
  });
  it("V3: audit_dispatch can EXECUTE the locator (privilege + live call)", async () => {
    expect(await boolRow(`SELECT has_function_privilege('audit_dispatch', '${FN}', 'EXECUTE') AS ok`)).toBe(true);
    await expect(locateAsDispatch()).resolves.toBeInstanceOf(Array); // no throw
  });
  it("V4: audit_dispatch cannot SELECT tenant tables (privilege + live attempt)", async () => {
    for (const t of ["audit_runs", "audit_run_preparations", "audit_jobs", "audit_results"]) {
      expect(await boolRow(`SELECT has_table_privilege('audit_dispatch', 'public."${t}"', 'SELECT') AS ok`)).toBe(false);
    }
    await expect(
      owner.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL ROLE audit_dispatch");
        return tx.$queryRawUnsafe(`SELECT 1 FROM public."audit_runs" LIMIT 1`);
      }),
    ).rejects.toThrow(/permission denied/i);
  });
  it("V5: audit_dispatch cannot mutate tenant tables (INSERT/UPDATE/DELETE + no BYPASSRLS)", async () => {
    for (const t of ["audit_runs", "audit_jobs", "audit_run_preparations"]) {
      for (const priv of ["INSERT", "UPDATE", "DELETE"]) {
        expect(await boolRow(`SELECT has_table_privilege('audit_dispatch', 'public."${t}"', '${priv}') AS ok`)).toBe(false);
      }
    }
    expect(await boolRow(`SELECT NOT rolbypassrls AS ok FROM pg_roles WHERE rolname='audit_dispatch'`)).toBe(true);
    expect(await boolRow(`SELECT NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AS ok FROM pg_roles WHERE rolname='audit_dispatch'`)).toBe(true);
    await expect(
      owner.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL ROLE audit_dispatch");
        return tx.$executeRawUnsafe(`UPDATE public."audit_runs" SET "label" = 'x'`);
      }),
    ).rejects.toThrow(/permission denied/i);
  });

  // ── output contract ────────────────────────────────────────────────────────
  it("V6/V17: output is exactly {auditFirmId, runId, workType} — no client/accounting payload", async () => {
    const { firmId, engId } = await mkFirm();
    await mkRun(firmId, engId, "QUEUED");
    const rows = await locateAsDispatch();
    expect(rows.length).toBeGreaterThan(0);
    const keys = Object.keys(rows[0]!).sort();
    expect(keys).toEqual(["auditFirmId", "runId", "workType"]);
    const forbidden = ["clientId", "engagementId", "preparationId", "datasetId", "testVersionId", "jobId", "leaseOwner", "clientName", "balance", "amount", "payload", "findings", "failureDetail"];
    for (const r of rows) for (const f of forbidden) expect(r as Record<string, unknown>).not.toHaveProperty(f);
    for (const r of rows) expect(["PREPARATION", "EXECUTION"]).toContain(r.workType);
  });

  // ── discovery predicates ───────────────────────────────────────────────────
  it("V7: PREPARING run with an unfinished (PREPARING) preparation is discovered as PREPARATION", async () => {
    const { firmId, engId } = await mkFirm();
    const runId = await mkRun(firmId, engId, "PREPARING");
    await mkPrep(firmId, runId, "PREPARING");
    const items = (await locateAsDispatch()).filter((i) => i.runId === runId);
    expect(items).toHaveLength(1);
    expect(items[0]!.workType).toBe("PREPARATION");
  });
  it("V8: PREPARING run whose prep is zero-undone-but-unsealed (still PREPARING) is discovered", async () => {
    // Represented by a PREPARING preparation with no undone chunks — the
    // crash-after-final-chunk state. The predicate keys on prep.status, so it is
    // discovered exactly as V7 (the seal transition, not chunk counts, ends it).
    const { firmId, engId } = await mkFirm();
    const runId = await mkRun(firmId, engId, "PREPARING");
    await mkPrep(firmId, runId, "PREPARING"); // no prep chunks => zero undone
    const items = (await locateAsDispatch()).filter((i) => i.runId === runId);
    expect(items).toHaveLength(1);
    expect(items[0]!.workType).toBe("PREPARATION");
  });
  it("V9: PREPARING run whose current prep is COMPLETE (awaiting human Publish) is NOT background work", async () => {
    const { firmId, engId } = await mkFirm();
    const runId = await mkRun(firmId, engId, "PREPARING");
    await mkPrep(firmId, runId, "COMPLETE");
    expect(runIds(await locateAsDispatch()).has(runId)).toBe(false);
  });
  it("V10: QUEUED run is discovered as EXECUTION", async () => {
    const { firmId, engId } = await mkFirm();
    const runId = await mkRun(firmId, engId, "QUEUED");
    const items = (await locateAsDispatch()).filter((i) => i.runId === runId);
    expect(items).toHaveLength(1);
    expect(items[0]!.workType).toBe("EXECUTION");
  });
  it("V11: RUNNING run with a live latest lease is EXCLUDED (no premature takeover)", async () => {
    const { firmId, engId } = await mkFirm();
    const runId = await mkRun(firmId, engId, "RUNNING");
    await mkJob(firmId, runId, 1, "RUNNING", "live");
    expect(runIds(await locateAsDispatch()).has(runId)).toBe(false);
  });
  it("V12: RUNNING run whose latest attempt lease has expired is discovered as EXECUTION", async () => {
    const { firmId, engId } = await mkFirm();
    const runId = await mkRun(firmId, engId, "RUNNING");
    await mkJob(firmId, runId, 1, "RUNNING", "expired");
    const items = (await locateAsDispatch()).filter((i) => i.runId === runId);
    expect(items).toHaveLength(1);
    expect(items[0]!.workType).toBe("EXECUTION");
  });
  it("V12b: latest-attempt resolution — expired predecessor superseded by a live newer attempt is EXCLUDED", async () => {
    const { firmId, engId } = await mkFirm();
    const runId = await mkRun(firmId, engId, "RUNNING");
    await mkJob(firmId, runId, 1, "FAILED", "expired"); // old, expired, terminal
    await mkJob(firmId, runId, 2, "RUNNING", "live"); // latest, live
    expect(runIds(await locateAsDispatch()).has(runId)).toBe(false);
  });
  it("V13: terminal runs (COMPLETED/FAILED/CANCELLED) and DRAFT are excluded", async () => {
    const { firmId, engId } = await mkFirm();
    const ids = await Promise.all(
      (["COMPLETED", "FAILED", "CANCELLED", "DRAFT"] as RunStatus[]).map((s) => mkRun(firmId, engId, s)),
    );
    const found = runIds(await locateAsDispatch());
    for (const id of ids) expect(found.has(id)).toBe(false);
  });
  it("V13b: RUNNING run + terminal latest attempt is NOT invented as recoverable", async () => {
    const { firmId, engId } = await mkFirm();
    const runId = await mkRun(firmId, engId, "RUNNING");
    await mkJob(firmId, runId, 1, "SUCCEEDED", null); // latest not RUNNING
    expect(runIds(await locateAsDispatch()).has(runId)).toBe(false);
  });

  // ── RLS re-derivation floor (the non-authoritative-hint safety net) ─────────
  it("V14: tenant ownership is re-derivable under RLS — audit_app sees only its own runs", async () => {
    const a = await mkFirm();
    const b = await mkFirm();
    const runA = await mkRun(a.firmId, a.engId, "QUEUED");
    const runB = await mkRun(b.firmId, b.engId, "QUEUED");
    const seenByA = await withTenantContext(a.firmId, (t) =>
      t.auditRun.findMany({ where: { id: { in: [runA, runB] } }, select: { id: true, auditFirmId: true } }),
    );
    expect(seenByA.map((r) => r.id)).toEqual([runA]);
    expect(seenByA.every((r) => r.auditFirmId === a.firmId)).toBe(true);
  });
  it("V15: a tampered/mismatched locator coordinate cannot drive a cross-tenant mutation (RLS)", async () => {
    const a = await mkFirm();
    const b = await mkFirm();
    const runA = await mkRun(a.firmId, a.engId, "QUEUED");
    // Worker mis-uses firmB context against a firmA runId (the tampered-hint case).
    const affected = await withTenantContext(b.firmId, (t) =>
      t.$executeRawUnsafe(`UPDATE public."audit_runs" SET "label" = 'tampered' WHERE "id" = $1`, runA),
    );
    expect(affected).toBe(0); // RLS USING clause excluded the row
    const row = await owner.auditRun.findUniqueOrThrow({ where: { id: runA }, select: { label: true } });
    expect(row.label).toBeNull();
  });
  it("V24: existing tenant-isolation RLS policies are unchanged by this migration", async () => {
    const pol = await owner.$queryRawUnsafe<Array<{ tablename: string }>>(
      `SELECT tablename FROM pg_policies WHERE schemaname='public' AND policyname='tenant_isolation'
         AND tablename IN ('audit_runs','audit_run_preparations','audit_jobs','audit_firms','users')
       ORDER BY tablename`);
    expect(pol.map((p) => p.tablename)).toEqual(["audit_firms", "audit_jobs", "audit_run_preparations", "audit_runs", "users"]);
    // audit_app remains fully RLS-subject: no tenant context ⇒ no rows.
    const none = await prisma.auditRun.findMany({ take: 1 });
    expect(none).toHaveLength(0);
  });

  // ── safety / hardening ─────────────────────────────────────────────────────
  it("V16: duplicate discovery is safe — repeated calls are idempotent, non-consuming", async () => {
    const { firmId, engId } = await mkFirm();
    const runId = await mkRun(firmId, engId, "QUEUED");
    const first = runIds(await locateAsDispatch());
    const second = runIds(await locateAsDispatch());
    expect(first.has(runId)).toBe(true);
    expect(second.has(runId)).toBe(true); // still present ⇒ not consumed/mutated
  });
  it("V18: SECURITY DEFINER pins search_path and schema-qualifies — object-shadowing fails", async () => {
    const meta = await owner.$queryRawUnsafe<Array<{ proconfig: string[] | null; prosrc: string }>>(
      `SELECT proconfig, prosrc FROM pg_proc WHERE proname='app_locate_runnable_work'`);
    // (1) search_path is pinned, not caller-controlled.
    expect(meta[0]!.proconfig).toContain("search_path=pg_catalog, public");
    // (2) every relation is schema-qualified, so no unqualified name can be shadowed.
    for (const rel of ['public."audit_runs"', 'public."audit_run_preparations"', 'public."audit_jobs"']) {
      expect(meta[0]!.prosrc).toContain(rel);
    }
    // (3) Live: even with `public` stripped from the CALLER's search_path, the
    //     schema-qualified function resolves all its own objects and returns
    //     correct data — its internal resolution never consults the caller path.
    const { firmId, engId } = await mkFirm();
    const runId = await mkRun(firmId, engId, "QUEUED");
    const hostile = await owner.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL ROLE audit_dispatch");
      await tx.$executeRawUnsafe("SET LOCAL search_path = pg_temp");
      return tx.$queryRawUnsafe<WorkItem[]>("SELECT * FROM public.app_locate_runnable_work()");
    });
    expect(runIds(hostile).has(runId)).toBe(true);
  });
  it("V22: lease predicate is evaluated against DB transaction time", async () => {
    const { firmId, engId } = await mkFirm();
    const expiredRun = await mkRun(firmId, engId, "RUNNING");
    await mkJob(firmId, expiredRun, 1, "RUNNING", "expired"); // now() - 5m
    const liveRun = await mkRun(firmId, engId, "RUNNING");
    await mkJob(firmId, liveRun, 1, "RUNNING", "live"); // now() + 5m
    const found = runIds(await locateAsDispatch());
    expect(found.has(expiredRun)).toBe(true);
    expect(found.has(liveRun)).toBe(false);
  });
  it("V23: the locator is STABLE, SECURITY DEFINER, and has no write side effects", async () => {
    const meta = await owner.$queryRawUnsafe<Array<{ provolatile: string; prosecdef: boolean }>>(
      `SELECT provolatile, prosecdef FROM pg_proc WHERE proname='app_locate_runnable_work'`);
    expect(meta[0]!.provolatile).toBe("s"); // STABLE
    expect(meta[0]!.prosecdef).toBe(true); // SECURITY DEFINER
    // A function that writes would error inside a READ ONLY transaction.
    await expect(
      owner.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL ROLE audit_dispatch");
        await tx.$executeRawUnsafe("SET LOCAL transaction_read_only = on");
        return tx.$queryRawUnsafe(LOCATE_SQL);
      }),
    ).resolves.toBeInstanceOf(Array);
  });

  // ── fairness / limit / plan ────────────────────────────────────────────────
  it("V19: hard server-side limit of 200 rows per invocation is enforced", async () => {
    await clearRunnable();
    // 6 firms × 40 QUEUED each = 240 runnable, each firm under the per-firm cap,
    // so the only binding constraint is the overall LIMIT 200.
    for (let f = 0; f < 6; f++) {
      const { firmId, engId } = await mkFirm();
      await owner.$executeRawUnsafe(
        `INSERT INTO public."audit_runs" ("id","auditFirmId","engagementId","status","updatedAt","createdAt","maxAttempts")
         SELECT 'v19-'||$1||'-'||g::text, $1, $2, 'QUEUED', now(), now(), 3 FROM generate_series(1,40) g`,
        firmId, engId,
      );
    }
    const rows = await locateAsDispatch();
    expect(rows.length).toBe(200);
  });
  it("V20: per-firm fairness cap bounds any single firm's share within one invocation", async () => {
    await clearRunnable();
    const { firmId, engId } = await mkFirm();
    await owner.$executeRawUnsafe(
      `INSERT INTO public."audit_runs" ("id","auditFirmId","engagementId","status","updatedAt","createdAt","maxAttempts")
       SELECT 'v20-'||$1||'-'||g::text, $1, $2, 'QUEUED', now(), now(), 3 FROM generate_series(1,60) g`,
      firmId, engId,
    );
    // This firm alone has 60 runnable; the cap keeps exactly 50 of them per call.
    const mine = (await locateAsDispatch()).filter((i) => i.auditFirmId === firmId);
    expect(mine.length).toBe(50);
  });
  it("V21: locator query plan uses ix_runs_runnable over a realistic terminal-run population", async () => {
    const { firmId, engId } = await mkFirm();
    // Large terminal population (excluded from the partial index) + a little runnable.
    await owner.$executeRawUnsafe(
      `INSERT INTO public."audit_runs" ("id","auditFirmId","engagementId","status","updatedAt","createdAt","maxAttempts")
       SELECT 'v21done-'||$1||'-'||g::text, $1, $2, 'COMPLETED', now(), now(), 3 FROM generate_series(1,20000) g`,
      firmId, engId,
    );
    await owner.$executeRawUnsafe(
      `INSERT INTO public."audit_runs" ("id","auditFirmId","engagementId","status","updatedAt","createdAt","maxAttempts")
       SELECT 'v21q-'||$1||'-'||g::text, $1, $2, 'QUEUED', now(), now(), 3 FROM generate_series(1,20) g`,
      firmId, engId,
    );
    await owner.$executeRawUnsafe(`ANALYZE public."audit_runs"`);
    // EXPLAIN the runnable core (mirrors the function body's discovery branches).
    const plan = await owner.$queryRawUnsafe<Array<{ "QUERY PLAN": string }>>(
      `EXPLAIN (FORMAT TEXT)
       SELECT r."auditFirmId", r."id", r."updatedAt" FROM public."audit_runs" r
        WHERE r."status" = 'PREPARING'::public."AuditRunStatus"
       UNION ALL
       SELECT r."auditFirmId", r."id", r."updatedAt" FROM public."audit_runs" r
        WHERE r."status" = 'QUEUED'::public."AuditRunStatus"
           OR r."status" = 'RUNNING'::public."AuditRunStatus"`);
    const text = plan.map((p) => p["QUERY PLAN"]).join("\n");
    expect(text).toContain("ix_runs_runnable");
    expect(text).not.toMatch(/Seq Scan on "?audit_runs"?/);
  });
});
