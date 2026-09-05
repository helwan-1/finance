/**
 * G6 PHASE B — CLOSURE (debts 001/003/004). Real PostgreSQL, G4_DB_TEST.
 * C1–C5  historical read model (frozen snapshot exposure, no live substitution).
 * C6–C13 professional error contract (409/422/503 + preserved 401/403/404).
 * C14–C15 create non-idempotency + G6-DEBT-001 documentation.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withTenantContext } from "@/lib/db/tenant";
import { startImport, confirmImport } from "@/lib/import/pipeline";
import { materializePopulation } from "@/lib/g4/preparation";
import * as ra from "@/lib/g4/app/run-access";
import { runErrorResponse } from "@/lib/g4/app/http";

const run = process.env.G4_DB_TEST ? describe : describe.skip;
const owner = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_DATABASE_URL } } });
const FIRM_A = "firmA", FIRM_B = "firmB", ENG_A = "engA", ENG_B = "engB";
const U_MEM = "u-c-memberA", U_NON = "u-c-nonmemberA", U_B = "u-c-memberB";
const memberA: ra.RunActor = { userId: U_MEM, auditFirmId: FIRM_A };
const nonMemberA: ra.RunActor = { userId: U_NON, auditFirmId: FIRM_A };
const actorB: ra.RunActor = { userId: U_B, auditFirmId: FIRM_B };

const RA_SRC = readFileSync(join(process.cwd(), "src/lib/g4/app/run-access.ts"), "utf8");
const errStatus = async (fn: () => Promise<unknown>): Promise<{ status: number; code: string }> => {
  try { await fn(); return { status: 200, code: "NONE" }; }
  catch (e) { const r = runErrorResponse(e); return { status: r.status, code: ((await r.json()) as { code: string }).code }; }
};

async function seedTestAndDataset(): Promise<{ testKey: string; datasetId: string }> {
  const n = randomUUID();
  const csv = "account,date,debit,credit,currency\n900941,2024-01-01,9.00,2.00,USD\n";
  const start = await startImport({ auditFirmId: FIRM_A, userId: null, engagementId: ENG_A, datasetKind: "GENERAL_LEDGER", fileName: `c-${n}.csv`, mimeType: "text/csv", bytes: Buffer.from(csv, "utf8"), idempotencyKey: `c-${n}`, acknowledgeDuplicate: true });
  await confirmImport(FIRM_A, null, start.batchId!);
  const testKey = `T-C-${n}`;
  await withTenantContext(FIRM_A, async (t) => {
    const test = await t.auditTest.create({ data: { auditFirmId: FIRM_A, key: testKey, name: "n", nameAr: "ن", testType: "ACCOUNTING_INTEGRITY" }, select: { id: true } });
    const v = await t.auditTestVersion.create({ data: { auditFirmId: FIRM_A, auditTestId: test.id, version: 1, testType: "ACCOUNTING_INTEGRITY", definitionJson: { kind: "INVALID_DEBIT_CREDIT" }, requirementsJson: { requiredDatasetKinds: ["GENERAL_LEDGER"] }, versionHash: `vh-${n}`, status: "ACTIVE" }, select: { id: true } });
    await t.auditTest.update({ where: { id: test.id }, data: { currentVersionId: v.id } });
  });
  return { testKey, datasetId: start.datasetId! };
}
async function beginAndMaterialize(runId: string, testKey: string, datasetId: string): Promise<string> {
  const { prepId } = await ra.beginRunPreparation(memberA, runId, { tests: [{ testKey }], datasetIds: [datasetId], batchSize: 500 });
  const chunks = await withTenantContext(FIRM_A, (t) => t.auditRunPrepChunk.findMany({ where: { preparationId: prepId }, select: { auditTestVersionId: true, datasetId: true } }));
  for (const c of chunks) await materializePopulation(FIRM_A, prepId, c.auditTestVersionId, c.datasetId, { batchSize: 500 });
  return prepId;
}
async function publishedRun(): Promise<string> {
  const { testKey, datasetId } = await seedTestAndDataset();
  const { runId } = await ra.createRun(memberA, { engagementId: ENG_A });
  const prepId = await beginAndMaterialize(runId, testKey, datasetId);
  await ra.sealRunPreparation(memberA, runId, prepId);
  await ra.publishRunForActor(memberA, runId, prepId);
  return runId;
}

run("G6 Phase B — closure (debts 001/003/004)", () => {
  vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });
  const PRIOR = process.env.AUDIT_ENGINE_BUILD;
  let origLicense = "";
  beforeAll(async () => {
    process.env.AUDIT_ENGINE_BUILD = "test-build-g6c";
    const s = await import("../g4/_seed"); await s.ensureSeed();
    for (const [id, firm] of [[U_MEM, FIRM_A], [U_NON, FIRM_A], [U_B, FIRM_B]] as const) {
      await owner.user.upsert({ where: { id }, update: {}, create: { id, auditFirmId: firm, email: `${id}@t.example`, fullName: id, fullNameAr: "م", role: "SENIOR", passwordHash: "x" } });
    }
    await owner.engagementMember.upsert({ where: { engagementId_userId: { engagementId: ENG_A, userId: U_MEM } }, update: {}, create: { engagementId: ENG_A, userId: U_MEM } });
    await owner.engagementMember.upsert({ where: { engagementId_userId: { engagementId: ENG_B, userId: U_B } }, update: {}, create: { engagementId: ENG_B, userId: U_B } });
    origLicense = (await owner.auditFirm.findUniqueOrThrow({ where: { id: FIRM_A }, select: { licenseNo: true } })).licenseNo;
  }, 120_000);
  afterAll(async () => {
    await owner.auditFirm.update({ where: { id: FIRM_A }, data: { licenseNo: origLicense } }).catch(() => {});
    await owner.auditEngagement.update({ where: { id: ENG_A }, data: { fiscalYear: 2024 } }).catch(() => {});
    if (PRIOR === undefined) delete process.env.AUDIT_ENGINE_BUILD; else process.env.AUDIT_ENGINE_BUILD = PRIOR;
    await owner.$disconnect(); await prisma.$disconnect();
  });

  // ── Historical read model (G6-DEBT-003) ──
  it("C1: run detail returns all 3 frozen snapshot fields", async () => {
    const r = await ra.getRun(memberA, await publishedRun());
    expect(r).toHaveProperty("frozenFirmLicenseNo");
    expect(r).toHaveProperty("frozenFiscalYear");
    expect(r).toHaveProperty("frozenClientSemanticKey");
    expect(r.frozenFirmLicenseNo).toBeTruthy();
    expect(typeof r.frozenFiscalYear).toBe("number");
    expect(r.frozenClientSemanticKey).toBeTruthy();
  });
  it("C2: values equal the AuditRun frozen columns", async () => {
    const runId = await publishedRun();
    const r = await ra.getRun(memberA, runId);
    const row = await owner.auditRun.findUniqueOrThrow({ where: { id: runId }, select: { frozenFirmLicenseNo: true, frozenFiscalYear: true, frozenClientSemanticKey: true } });
    expect(r.frozenFirmLicenseNo).toBe(row.frozenFirmLicenseNo);
    expect(r.frozenFiscalYear).toBe(row.frozenFiscalYear);
    expect(r.frozenClientSemanticKey).toBe(row.frozenClientSemanticKey);
  });
  it("C3: mutating current firm license / fiscal year does NOT change the read model", async () => {
    const runId = await publishedRun();
    const before = await ra.getRun(memberA, runId);
    await owner.auditFirm.update({ where: { id: FIRM_A }, data: { licenseNo: `c-tmp-${randomUUID().slice(0, 8)}` } });
    await owner.auditEngagement.update({ where: { id: ENG_A }, data: { fiscalYear: 1990 } });
    try {
      const after = await ra.getRun(memberA, runId);
      expect(after.frozenFirmLicenseNo).toBe(before.frozenFirmLicenseNo);
      expect(after.frozenFiscalYear).toBe(before.frozenFiscalYear);
      expect(after.frozenClientSemanticKey).toBe(before.frozenClientSemanticKey);
      expect(after.frozenFiscalYear).not.toBe(1990);
    } finally {
      await owner.auditFirm.update({ where: { id: FIRM_A }, data: { licenseNo: origLicense } });
      await owner.auditEngagement.update({ where: { id: ENG_A }, data: { fiscalYear: 2024 } });
    }
  });
  it("C4: legacy frozen run with NULL snapshots returns NULL/NULL/NULL", async () => {
    const runId = await publishedRun();
    await owner.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      await tx.$executeRawUnsafe(`UPDATE "audit_runs" SET "frozenFirmLicenseNo"=NULL,"frozenFiscalYear"=NULL,"frozenClientSemanticKey"=NULL WHERE "id"=$1`, runId);
    });
    const r = await ra.getRun(memberA, runId);
    expect(r.frozenFirmLicenseNo).toBeNull();
    expect(r.frozenFiscalYear).toBeNull();
    expect(r.frozenClientSemanticKey).toBeNull();
  });
  it("C5: a DRAFT (unfrozen) run has NULL snapshot fields", async () => {
    const { runId } = await ra.createRun(memberA, { engagementId: ENG_A });
    const r = await ra.getRun(memberA, runId);
    expect(r.status).toBe("DRAFT");
    expect(r.frozenFirmLicenseNo).toBeNull();
    expect(r.frozenFiscalYear).toBeNull();
    expect(r.frozenClientSemanticKey).toBeNull();
  });

  // ── Error contract (G6-DEBT-004) ──
  it("C6: invalid run state → 409 INVALID_RUN_STATE", async () => {
    const runId = await publishedRun(); // now QUEUED
    const prep = await withTenantContext(FIRM_A, (t) => t.auditRunPreparation.findFirstOrThrow({ where: { runId }, select: { id: true } }));
    const out = await errStatus(() => ra.publishRunForActor(memberA, runId, prep.id));
    expect(out).toEqual({ status: 409, code: "INVALID_RUN_STATE" });
  });
  it("C7: incomplete preparation seal → 409 PREPARATION_NOT_COMPLETE", async () => {
    const { testKey, datasetId } = await seedTestAndDataset();
    const { runId } = await ra.createRun(memberA, { engagementId: ENG_A });
    const { prepId } = await ra.beginRunPreparation(memberA, runId, { tests: [{ testKey }], datasetIds: [datasetId], batchSize: 500 });
    // NOT materialized → seal must be rejected as incomplete.
    const out = await errStatus(() => ra.sealRunPreparation(memberA, runId, prepId));
    expect(out).toEqual({ status: 409, code: "PREPARATION_NOT_COMPLETE" });
  });
  it("C8: malformed/invalid request → 422 VALIDATION", async () => {
    const r = runErrorResponse(new ra.RunValidationError("bad payload"));
    expect(r.status).toBe(422);
    expect((await r.json() as { code: string }).code).toBe("VALIDATION");
    // routes return 422 for invalid JSON body
    for (const p of ["route.ts", "[id]/preparation/route.ts", "[id]/preparation/seal/route.ts", "[id]/publish/route.ts"]) {
      expect(readFileSync(join(process.cwd(), "src/app/api/runs", p), "utf8")).toMatch(/status:\s*422[\s\S]*VALIDATION|VALIDATION[\s\S]*status:\s*422/);
    }
  });
  it("C9: deterministic G4 configuration error → 422 CONFIGURATION", async () => {
    const { runId } = await ra.createRun(memberA, { engagementId: ENG_A });
    const out = await errStatus(() => ra.beginRunPreparation(memberA, runId, { tests: [{ testKey: `nope-${randomUUID()}` }], datasetIds: ["ds-nope"] }));
    expect(out).toEqual({ status: 422, code: "CONFIGURATION" });
  });
  it("C10: DB-unavailable → 503 DB_UNAVAILABLE without leaking raw details", async () => {
    for (const e of [{ name: "PrismaClientInitializationError", message: "P1001 raw..." }, { code: "P1001", message: "can't reach db raw" }]) {
      const r = runErrorResponse(e);
      const body = await r.json() as { error: string; code: string };
      expect(r.status).toBe(503);
      expect(body.code).toBe("DB_UNAVAILABLE");
      expect(body.error).not.toMatch(/P1001|raw|reach db/i); // no raw DB detail leaked
    }
    // unexpected internal errors are also 503 (project convention), no leak
    const r2 = runErrorResponse(new Error("SELECT \"secret\" FROM internal"));
    expect(r2.status).toBe(503);
    expect((await r2.json() as { error: string }).error).not.toMatch(/SELECT|secret|internal/);
  });
  it("C11: existing 401 UNAUTHENTICATED preserved (guard-owned, unchanged)", () => {
    const guard = readFileSync(join(process.cwd(), "src/lib/auth/guard.ts"), "utf8");
    expect(guard).toMatch(/deny\(401/); // missing session → 401
    for (const p of ["route.ts", "[id]/preparation/route.ts", "[id]/preparation/seal/route.ts", "[id]/publish/route.ts"]) {
      expect(readFileSync(join(process.cwd(), "src/app/api/runs", p), "utf8")).toMatch(/requireSession\(/);
    }
  });
  it("C12: membership 403 preserved → ENGAGEMENT_ACCESS_DENIED", async () => {
    const runId = await publishedRun();
    const out = await errStatus(() => ra.getRun(nonMemberA, runId));
    expect(out).toEqual({ status: 403, code: "ENGAGEMENT_ACCESS_DENIED" });
  });
  it("C13: cross-tenant/not-found 404 preserved → AUDIT_RUN_NOT_FOUND", async () => {
    const runId = await publishedRun();
    const cross = await errStatus(() => ra.getRun(actorB, runId));
    expect(cross).toEqual({ status: 404, code: "AUDIT_RUN_NOT_FOUND" });
    const missing = await errStatus(() => ra.getRun(memberA, `missing-${randomUUID()}`));
    expect(missing).toEqual({ status: 404, code: "AUDIT_RUN_NOT_FOUND" });
  });

  // ── Create non-idempotency (G6-DEBT-001) ──
  it("C14: create remains non-idempotent; no idempotency persistence added", async () => {
    const a = await ra.createRun(memberA, { engagementId: ENG_A });
    const b = await ra.createRun(memberA, { engagementId: ENG_A });
    expect(a.runId).not.toBe(b.runId); // repeated request → distinct DRAFT runs
    // no idempotency-key plumbing in the boundary (the token would appear if a
    // real key/dedup mechanism had been wired in); prose mentions are hyphen/space
    // forms ("idempotency key"), never the camelCase field token.
    expect(RA_SRC).not.toMatch(/idempotencyKey/);
    expect(ra.createRun.length).toBe(2); // (actor, input) — no idempotency arg
  });
  it("C15: G6-DEBT-001 is documented at the create boundary", () => {
    expect(RA_SRC).toMatch(/G6-DEBT-001/);
    expect(RA_SRC).toMatch(/NON-IDEMPOTENT/);
  });
});
