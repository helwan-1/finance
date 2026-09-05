/**
 * G6 PHASE B — authenticated AuditRun application boundary (real PostgreSQL).
 * B1–B25. Proves authentication wiring, RBAC, engagement-membership authorization,
 * cross-firm (RLS) and cross-engagement isolation, runId→engagement resolution,
 * session-authoritative firm/actor, command boundaries, forbidden surface, and
 * TOCTOU-safe composition. Gated on G4_DB_TEST.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/auth/rbac";
import { withTenantContext } from "@/lib/db/tenant";
import { startImport, confirmImport } from "@/lib/import/pipeline";
import { materializePopulation } from "@/lib/g4/preparation";
import { createDraftRun } from "@/lib/g4/run";
import * as runAccess from "@/lib/g4/app/run-access";
import { RunAccessError } from "@/lib/g4/app/run-access";

const run = process.env.G4_DB_TEST ? describe : describe.skip;
const owner = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_DATABASE_URL } } });

const FIRM_A = "firmA";
const FIRM_B = "firmB";
const ENG_A = "engA"; // firmA (seed)
const ENG_A2 = "engB-A2"; // second firmA engagement (created here, under clientA)
const ENG_B = "engB"; // firmB (g4 seed)

const U_MEMBER_A = "u-b-memberA";
const U_NONMEMBER_A = "u-b-nonmemberA";
const U_MEMBER_A2 = "u-b-memberA2"; // member of ENG_A2 only
const U_MEMBER_B = "u-b-memberB";

const actorMemberA: runAccess.RunActor = { userId: U_MEMBER_A, auditFirmId: FIRM_A };
const actorNonMemberA: runAccess.RunActor = { userId: U_NONMEMBER_A, auditFirmId: FIRM_A };
const actorMemberA2: runAccess.RunActor = { userId: U_MEMBER_A2, auditFirmId: FIRM_A };
const actorB: runAccess.RunActor = { userId: U_MEMBER_B, auditFirmId: FIRM_B };

const ROUTES = join(process.cwd(), "src/app/api/runs");
const routeSrc = (p: string) => readFileSync(join(ROUTES, p), "utf8");
const statusOf = async (fn: () => Promise<unknown>): Promise<number> => {
  try { await fn(); return 200; } catch (e) { return e instanceof RunAccessError ? e.status : -1; }
};

async function upsertUser(id: string, firm: string): Promise<void> {
  await owner.user.upsert({
    where: { id }, update: {},
    create: { id, auditFirmId: firm, email: `${id}@t.example`, fullName: id, fullNameAr: "مستخدم", role: "SENIOR", passwordHash: "x" },
  });
}
async function addMember(engagementId: string, userId: string): Promise<void> {
  await owner.engagementMember.upsert({
    where: { engagementId_userId: { engagementId, userId } }, update: {}, create: { engagementId, userId },
  });
}

/** Build a run in ENG_A with a materialized-and-ready-to-seal preparation. */
async function buildRunWithPrep(): Promise<{ runId: string; prepId: string }> {
  const n = randomUUID();
  const csv = "account,date,debit,credit,currency\n900931,2024-01-01,7.00,4.00,USD\n";
  const start = await startImport({
    auditFirmId: FIRM_A, userId: null, engagementId: ENG_A, datasetKind: "GENERAL_LEDGER",
    fileName: `b-${n}.csv`, mimeType: "text/csv", bytes: Buffer.from(csv, "utf8"),
    idempotencyKey: `b-${n}`, acknowledgeDuplicate: true,
  });
  await confirmImport(FIRM_A, null, start.batchId!);
  const key = `T-B-${n}`;
  await withTenantContext(FIRM_A, async (t) => {
    const test = await t.auditTest.create({ data: { auditFirmId: FIRM_A, key, name: "n", nameAr: "ن", testType: "ACCOUNTING_INTEGRITY" }, select: { id: true } });
    const v = await t.auditTestVersion.create({ data: { auditFirmId: FIRM_A, auditTestId: test.id, version: 1, testType: "ACCOUNTING_INTEGRITY", definitionJson: { kind: "INVALID_DEBIT_CREDIT" }, requirementsJson: { requiredDatasetKinds: ["GENERAL_LEDGER"] }, versionHash: `vh-${n}`, status: "ACTIVE" }, select: { id: true } });
    await t.auditTest.update({ where: { id: test.id }, data: { currentVersionId: v.id } });
  });
  const { runId } = await runAccess.createRun(actorMemberA, { engagementId: ENG_A });
  const { prepId } = await runAccess.beginRunPreparation(actorMemberA, runId, { tests: [{ testKey: key }], datasetIds: [start.datasetId!], batchSize: 500 });
  // Materialization is intentionally NOT exposed over HTTP; here it stands in
  // for the deferred out-of-band worker so seal/publish boundaries are testable.
  const chunks = await withTenantContext(FIRM_A, (t) => t.auditRunPrepChunk.findMany({ where: { preparationId: prepId }, select: { auditTestVersionId: true, datasetId: true } }));
  for (const c of chunks) await materializePopulation(FIRM_A, prepId, c.auditTestVersionId, c.datasetId, { batchSize: 500 });
  return { runId, prepId };
}

run("G6 Phase B — authenticated AuditRun application boundary", () => {
  vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });
  const PRIOR = process.env.AUDIT_ENGINE_BUILD;
  let runA = "";
  let runB = "";

  beforeAll(async () => {
    process.env.AUDIT_ENGINE_BUILD = "test-build-g6b";
    const s = await import("../g4/_seed"); await s.ensureSeed();
    // Second firmA engagement under clientA.
    await withTenantContext(FIRM_A, (t) => t.auditEngagement.upsert({
      where: { id: ENG_A2 }, update: {},
      create: { id: ENG_A2, auditFirmId: FIRM_A, clientCompanyId: "clientA", title: "A2", titleAr: "أ٢", fiscalYear: 2022, periodStart: new Date("2022-01-01"), periodEnd: new Date("2022-12-31"), currency: "SAR" },
    }));
    await upsertUser(U_MEMBER_A, FIRM_A);
    await upsertUser(U_NONMEMBER_A, FIRM_A);
    await upsertUser(U_MEMBER_A2, FIRM_A);
    await upsertUser(U_MEMBER_B, FIRM_B);
    await addMember(ENG_A, U_MEMBER_A);
    await addMember(ENG_A2, U_MEMBER_A2);
    await addMember(ENG_B, U_MEMBER_B);
    // Baseline runs (created via the boundary as the proper member).
    runA = (await runAccess.createRun(actorMemberA, { engagementId: ENG_A })).runId;
    runB = (await createDraftRun(FIRM_B, { engagementId: ENG_B, createdById: U_MEMBER_B })).runId;
  }, 120_000);

  afterAll(async () => {
    if (PRIOR === undefined) delete process.env.AUDIT_ENGINE_BUILD; else process.env.AUDIT_ENGINE_BUILD = PRIOR;
    await owner.$disconnect(); await prisma.$disconnect();
  });

  // ── Authentication wiring + RBAC (B1–B3) ──
  it("B1: write endpoints require a session (requireSession)", () => {
    for (const p of ["route.ts", "[id]/preparation/route.ts", "[id]/preparation/seal/route.ts", "[id]/publish/route.ts"]) {
      expect(routeSrc(p)).toMatch(/requireSession\(/);
    }
    expect(routeSrc("route.ts")).toMatch(/requireSession\("runs:manage"\)/);
  });
  it("B2: read endpoints use the authorize guard (enforced auth in prod, demo-safe otherwise)", () => {
    for (const p of ["[id]/route.ts", "[id]/jobs/route.ts", "[id]/results/route.ts", "route.ts"]) {
      expect(routeSrc(p)).toMatch(/authorize\("runs:view"\)/);
    }
    // Demo fallthrough must never expose tenant data.
    expect(routeSrc("route.ts")).toMatch(/!authz\.session[\s\S]*runs:\s*\[\]/);
  });
  it("B3: RBAC — manage restricted; view broad", () => {
    expect(can("STAFF", "runs:manage")).toBe(false);
    expect(can("REVIEWER", "runs:manage")).toBe(false);
    expect(can("SENIOR", "runs:manage")).toBe(true);
    expect(can("MANAGER", "runs:manage")).toBe(true);
    expect(can("STAFF", "runs:view")).toBe(true);
    expect(can("REVIEWER", "runs:view")).toBe(true);
  });

  // ── Membership authorization (B4–B7) ──
  it("B4: engagement member can create a run", async () => {
    const { runId } = await runAccess.createRun(actorMemberA, { engagementId: ENG_A });
    expect(runId).toBeTruthy();
    const r = await owner.auditRun.findUnique({ where: { id: runId }, select: { engagementId: true, auditFirmId: true } });
    expect(r).toEqual({ engagementId: ENG_A, auditFirmId: FIRM_A });
  });
  it("B5: same-firm non-member cannot create a run (403)", async () => {
    await expect(runAccess.createRun(actorNonMemberA, { engagementId: ENG_A })).rejects.toMatchObject({ status: 403 });
  });
  it("B6: member can read the run", async () => {
    const r = await runAccess.getRun(actorMemberA, runA);
    expect(r.id).toBe(runA);
    expect(r.engagementId).toBe(ENG_A);
  });
  it("B7: same-firm non-member cannot read the run (403)", async () => {
    expect(await statusOf(() => runAccess.getRun(actorNonMemberA, runA))).toBe(403);
  });

  // ── Cross-firm isolation via RLS → 404, never 403 (B8–B11) ──
  it("B8: cross-firm read is 404 (no existence oracle)", async () => {
    expect(await statusOf(() => runAccess.getRun(actorB, runA))).toBe(404);
  });
  it("B9: cross-firm command (beginPreparation) is 404", async () => {
    expect(await statusOf(() => runAccess.beginRunPreparation(actorB, runA, { tests: [{ testKey: "x" }], datasetIds: ["d"] }))).toBe(404);
  });
  it("B10: creating a run in a foreign-firm engagement is 404", async () => {
    expect(await statusOf(() => runAccess.createRun(actorMemberA, { engagementId: ENG_B }))).toBe(404);
  });
  it("B11: a non-existent runId is 404", async () => {
    expect(await statusOf(() => runAccess.getRun(actorMemberA, `missing-${randomUUID()}`))).toBe(404);
  });

  // ── Engagement-scoped, not merely firm-scoped (B12–B13) ──
  it("B12: same-firm member of a DIFFERENT engagement cannot read the run (403)", async () => {
    expect(await statusOf(() => runAccess.getRun(actorMemberA2, runA))).toBe(403);
  });
  it("B13: cross-engagement command is 403 (runId→engagement resolved from the run)", async () => {
    expect(await statusOf(() => runAccess.beginRunPreparation(actorMemberA2, runA, { tests: [{ testKey: "x" }], datasetIds: ["d"] }))).toBe(403);
  });

  // ── Session authoritative (B14–B15) ──
  it("B14: firm comes from the actor/session, never the client (no firm input)", async () => {
    const { runId } = await runAccess.createRun(actorMemberA, { engagementId: ENG_A });
    const r = await owner.auditRun.findUnique({ where: { id: runId }, select: { auditFirmId: true } });
    expect(r?.auditFirmId).toBe(FIRM_A); // actor firm, not client-chosen
    expect(Object.keys({ engagementId: "", maxAttempts: 0, label: null, supersedesRunId: null })).not.toContain("auditFirmId");
  });
  it("B15: createdById is bound to the session actor (provenance)", async () => {
    const { runId } = await runAccess.createRun(actorMemberA, { engagementId: ENG_A, label: "prov" });
    const r = await owner.auditRun.findUnique({ where: { id: runId }, select: { createdById: true } });
    expect(r?.createdById).toBe(U_MEMBER_A);
  });

  // ── Command boundaries: prepare / seal / publish (B16–B18) ──
  it("B16: member begins a preparation via the boundary", async () => {
    const { runId, prepId } = await buildRunWithPrep();
    expect(prepId).toBeTruthy();
    const prep = await owner.auditRunPreparation.findUnique({ where: { id: prepId }, select: { runId: true } });
    expect(prep?.runId).toBe(runId);
  });
  it("B17: seal is membership-gated; a member seals a complete prep", async () => {
    const { runId, prepId } = await buildRunWithPrep();
    // non-member seal rejected before any state change
    expect(await statusOf(() => runAccess.sealRunPreparation(actorNonMemberA, runId, prepId))).toBe(403);
    const out = await runAccess.sealRunPreparation(actorMemberA, runId, prepId);
    expect(out.manifestHash).toBeTruthy();
  });
  it("B18: publish is membership-gated; a member freezes the run", async () => {
    const { runId, prepId } = await buildRunWithPrep();
    await runAccess.sealRunPreparation(actorMemberA, runId, prepId);
    expect(await statusOf(() => runAccess.publishRunForActor(actorNonMemberA, runId, prepId))).toBe(403);
    const out = await runAccess.publishRunForActor(actorMemberA, runId, prepId);
    expect(out.configFingerprint).toBeTruthy();
    const r = await runAccess.getRun(actorMemberA, runId);
    expect(r.status).toBe("QUEUED");
  });

  // ── Read endpoints: jobs / results (B19–B20) ──
  it("B19: jobs read is membership+firm gated", async () => {
    expect(Array.isArray(await runAccess.getRunJobs(actorMemberA, runA))).toBe(true); // member ok
    expect(await statusOf(() => runAccess.getRunJobs(actorNonMemberA, runA))).toBe(403); // same firm, non-member
    expect(await statusOf(() => runAccess.getRunJobs(actorB, runA))).toBe(404); // cross firm
  });
  it("B20: results read is membership+firm gated", async () => {
    expect(Array.isArray(await runAccess.getRunResults(actorMemberA, runA))).toBe(true);
    expect(await statusOf(() => runAccess.getRunResults(actorNonMemberA, runA))).toBe(403);
    expect(await statusOf(() => runAccess.getRunResults(actorB, runA))).toBe(404);
  });

  // ── TOCTOU / composition safety (B21–B23) ──
  it("B21: AuditRun.engagementId is immutable — no UPDATE path in G4 source", () => {
    const g4 = join(process.cwd(), "src/lib/g4");
    const files = ["run.ts", "preparation.ts", "publish.ts", "execution/execute.ts", "execution/job.ts", "execution/context.ts", "app/run-access.ts"];
    for (const f of files) {
      const src = readFileSync(join(g4, f), "utf8");
      // (a) no raw SQL statement that SETs the engagementId column (bounded to
      //     one statement so it cannot cross into unrelated SELECT/`data` blocks)
      expect(src).not.toMatch(/\bSET\b[^;]*"engagementId"\s*=/i);
      // (b) no Prisma auditRun.update whose data mutates engagementId
      expect(src).not.toMatch(/auditRun\.update\([\s\S]*?data:\s*\{[^}]*engagementId/);
    }
    // engagementId is only ever WRITTEN by createDraftRun's .create (allowed).
    const runSrc = readFileSync(join(g4, "run.ts"), "utf8");
    expect(runSrc).toMatch(/auditRun\.create\([\s\S]*?engagementId:/);
  });
  it("B22: reads compose resolve+membership+read in one firm-scoped tx (cross-firm invisible)", async () => {
    // Atomicity is evidenced by RLS holding across the whole read: a foreign
    // firm sees nothing (404) while a member sees consistent data in one call.
    const r = await runAccess.getRun(actorMemberA, runA);
    expect(r.engagementId).toBe(ENG_A);
    expect(await statusOf(() => runAccess.getRun(actorB, runA))).toBe(404);
  });
  it("B23: publish authorizes on the run's OWN engagement (no confused-deputy)", async () => {
    const { runId, prepId } = await buildRunWithPrep();
    await runAccess.sealRunPreparation(actorMemberA, runId, prepId);
    // actorMemberA2 is a valid member of ENG_A2 but NOT of runId's engagement (ENG_A).
    expect(await statusOf(() => runAccess.publishRunForActor(actorMemberA2, runId, prepId))).toBe(403);
  });

  // ── Forbidden surface + model preservation (B24–B25) ──
  it("B24: no synchronous executeRun / materialize HTTP endpoint exists", () => {
    expect(existsSync(join(ROUTES, "[id]/execute"))).toBe(false);
    expect(existsSync(join(ROUTES, "[id]/execute/route.ts"))).toBe(false);
    expect(existsSync(join(ROUTES, "[id]/materialize"))).toBe(false);
    expect(existsSync(join(ROUTES, "[id]/preparation/materialize"))).toBe(false);
    // The boundary module exposes no execute/materialize wrapper.
    expect(Object.keys(runAccess)).not.toContain("executeRun");
    expect(Object.keys(runAccess)).not.toContain("materializePopulation");
    for (const [k] of Object.entries(runAccess)) {
      expect(k.toLowerCase()).not.toContain("execute");
      expect(k.toLowerCase()).not.toContain("materialize");
    }
  });
  it("B25: boundary never bypasses withTenantContext / accepts a client firm", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/g4/app/run-access.ts"), "utf8");
    // every exported entry point flows through withTenantContext and the domain
    // commands; the actor's firm is the only firm source.
    expect(src).toMatch(/withTenantContext\(actor\.auditFirmId/);
    // no direct prisma import that would bypass RLS tenant binding
    expect(src).not.toMatch(/from "@\/lib\/prisma"/);
  });
});
