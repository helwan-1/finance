/**
 * G6 PHASE C3-2R — preparation generation-multiplicity remediation (GM suite).
 *
 * Real PostgreSQL, gated by G4_DB_TEST. Proves the frozen invariant
 *   "at most one AuditRunPreparation with status='PREPARING' per AuditRun"
 * enforced race-safely by the partial unique index ux_prep_active_generation_per_run
 * plus the deterministic begin-preparation boundary guard, while multiple
 * historical/non-PREPARING generations remain legitimate and untouched.
 *
 * Migration-level proofs (GM7 dirty-upgrade fail-closed, GM8 fresh chain, GM9
 * clean upgrade, index catalog proof, allowed/rejected combinations) run via psql
 * in the C3-2R verification harness — see the phase report.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withTenantContext } from "@/lib/db/tenant";
import { startImport, confirmImport } from "@/lib/import/pipeline";
import { createDraftRun } from "@/lib/g4/run";
import { materializePopulation, sealPreparation } from "@/lib/g4/preparation";
import { beginRunPreparation, isActivePreparationConflict, RunStateError, type RunActor } from "@/lib/g4/app/run-access";

const run = process.env.G4_DB_TEST ? describe : describe.skip;
const owner = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_DATABASE_URL } } });
const FIRM = "firmA", ENG = "engA";
const U_MEM = "u-c32r-member";
const actor: RunActor = { userId: U_MEM, auditFirmId: FIRM };

async function seedTestAndDataset(): Promise<{ testKey: string; datasetId: string }> {
  const n = randomUUID();
  const csv = "account,date,debit,credit,currency\n900971,2024-01-01,6.00,4.00,USD\n900972,2024-01-02,3.00,1.00,USD\n";
  const start = await startImport({ auditFirmId: FIRM, userId: null, engagementId: ENG, datasetKind: "GENERAL_LEDGER", fileName: `c32r-${n}.csv`, mimeType: "text/csv", bytes: Buffer.from(csv, "utf8"), idempotencyKey: `c32r-${n}`, acknowledgeDuplicate: true });
  await confirmImport(FIRM, null, start.batchId!);
  const testKey = `T-C32R-${n}`;
  await withTenantContext(FIRM, async (t) => {
    const test = await t.auditTest.create({ data: { auditFirmId: FIRM, key: testKey, name: "n", nameAr: "ن", testType: "ACCOUNTING_INTEGRITY" }, select: { id: true } });
    const v = await t.auditTestVersion.create({ data: { auditFirmId: FIRM, auditTestId: test.id, version: 1, testType: "ACCOUNTING_INTEGRITY", definitionJson: { kind: "INVALID_DEBIT_CREDIT" }, requirementsJson: { requiredDatasetKinds: ["GENERAL_LEDGER"] }, versionHash: `vh-${n}`, status: "ACTIVE" }, select: { id: true } });
    await t.auditTest.update({ where: { id: test.id }, data: { currentVersionId: v.id } });
  });
  return { testKey, datasetId: start.datasetId! };
}
async function draftRun(): Promise<{ runId: string; testKey: string; datasetId: string }> {
  const { testKey, datasetId } = await seedTestAndDataset();
  const { runId } = await createDraftRun(FIRM, { engagementId: ENG, createdById: U_MEM });
  return { runId, testKey, datasetId };
}
const beginInput = (testKey: string, datasetId: string) => ({ tests: [{ testKey }], datasetIds: [datasetId], batchSize: 500 });
async function materializeAll(prepId: string): Promise<void> {
  const chunks = await withTenantContext(FIRM, (t) => t.auditRunPrepChunk.findMany({ where: { preparationId: prepId }, select: { auditTestVersionId: true, datasetId: true } }));
  for (const c of chunks) await materializePopulation(FIRM, prepId, c.auditTestVersionId, c.datasetId, { batchSize: 500 });
}
const preparingCount = (runId: string) => owner.auditRunPreparation.count({ where: { runId, status: "PREPARING" } });

run("G6 Phase C3-2R — preparation multiplicity remediation", () => {
  beforeAll(async () => {
    process.env.AUDIT_ENGINE_BUILD = "test-build-c32r";
    const s = await import("../g4/_seed"); await s.ensureSeed();
    await owner.user.upsert({ where: { id: U_MEM }, update: {}, create: { id: U_MEM, auditFirmId: FIRM, email: `${U_MEM}@t.example`, fullName: U_MEM, fullNameAr: "م", role: "SENIOR", passwordHash: "x" } });
    await owner.engagementMember.upsert({ where: { engagementId_userId: { engagementId: ENG, userId: U_MEM } }, update: {}, create: { engagementId: ENG, userId: U_MEM } });
    // Confirm the C3-2R index is present (fail fast otherwise).
    const idx = await owner.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*) AS n FROM pg_indexes WHERE indexname='ux_prep_active_generation_per_run'`);
    expect(Number(idx[0]!.n)).toBe(1);
  }, 120_000);
  afterAll(async () => { await owner.$disconnect(); await prisma.$disconnect(); });

  it("GM1: sequential second begin while gen1 PREPARING → 409 PREPARATION_ALREADY_ACTIVE; one PREPARING remains", async () => {
    const { runId, testKey, datasetId } = await draftRun();
    const g1 = await beginRunPreparation(actor, runId, beginInput(testKey, datasetId));
    expect(g1.generationNo).toBe(1);
    let code = "";
    try { await beginRunPreparation(actor, runId, beginInput(testKey, datasetId)); }
    catch (e) { expect(e).toBeInstanceOf(RunStateError); code = (e as RunStateError).code; expect((e as RunStateError).status).toBe(409); }
    expect(code).toBe("PREPARATION_ALREADY_ACTIVE");
    expect(await preparingCount(runId)).toBe(1);
  });

  it("GM2/GM10: two concurrent begins → exactly one wins, loser 409, one PREPARING, no raw error leak", async () => {
    const { runId, testKey, datasetId } = await draftRun();
    const results = await Promise.allSettled([
      beginRunPreparation(actor, runId, beginInput(testKey, datasetId)),
      beginRunPreparation(actor, runId, beginInput(testKey, datasetId)),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const bad = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(bad).toHaveLength(1);
    // Deterministic domain conflict — never a raw Prisma/Postgres error.
    expect(bad[0]!.reason).toBeInstanceOf(RunStateError);
    expect((bad[0]!.reason as RunStateError).code).toBe("PREPARATION_ALREADY_ACTIVE");
    expect((bad[0]!.reason as RunStateError).status).toBe(409);
    expect(String((bad[0]!.reason as { message: string }).message)).not.toMatch(/P2002|unique|constraint|prisma/i);
    expect(await preparingCount(runId)).toBe(1);
  });

  it("GM3: begin after gen1 COMPLETE → gen2 PREPARING allowed; generationNo increases; gen1 unchanged", async () => {
    const { runId, testKey, datasetId } = await draftRun();
    const g1 = await beginRunPreparation(actor, runId, beginInput(testKey, datasetId));
    await materializeAll(g1.prepId);
    await sealPreparation(FIRM, g1.prepId);
    const g1Before = await owner.auditRunPreparation.findUniqueOrThrow({ where: { id: g1.prepId }, select: { status: true, preparationManifestHash: true, sealedAt: true } });
    expect(g1Before.status).toBe("COMPLETE");
    const g2 = await beginRunPreparation(actor, runId, beginInput(testKey, datasetId));
    expect(g2.generationNo).toBe(2);
    expect(await preparingCount(runId)).toBe(1); // only gen2
    const g1After = await owner.auditRunPreparation.findUniqueOrThrow({ where: { id: g1.prepId }, select: { status: true, preparationManifestHash: true, sealedAt: true } });
    expect(g1After).toEqual(g1Before); // gen1 immutable
  });

  it("GM4: ABANDONED + PREPARING coexist (index permits; raw fixture — no production ABANDONED path)", async () => {
    const { runId } = await draftRun();
    await owner.auditRunPreparation.create({ data: { auditFirmId: FIRM, runId, generationNo: 1, status: "ABANDONED" } });
    await owner.auditRunPreparation.create({ data: { auditFirmId: FIRM, runId, generationNo: 2, status: "PREPARING" } });
    expect(await preparingCount(runId)).toBe(1);
    expect(await owner.auditRunPreparation.count({ where: { runId } })).toBe(2);
  });

  it("GM5: FAILED + PREPARING coexist (index permits; raw fixture)", async () => {
    const { runId } = await draftRun();
    await owner.auditRunPreparation.create({ data: { auditFirmId: FIRM, runId, generationNo: 1, status: "FAILED" } });
    await owner.auditRunPreparation.create({ data: { auditFirmId: FIRM, runId, generationNo: 2, status: "PREPARING" } });
    expect(await preparingCount(runId)).toBe(1);
  });

  it("GM6: multiple COMPLETE generations coexist (no uniqueness over total generations)", async () => {
    const { runId } = await draftRun();
    await owner.auditRunPreparation.create({ data: { auditFirmId: FIRM, runId, generationNo: 1, status: "COMPLETE" } });
    await owner.auditRunPreparation.create({ data: { auditFirmId: FIRM, runId, generationNo: 2, status: "COMPLETE" } });
    expect(await owner.auditRunPreparation.count({ where: { runId, status: "COMPLETE" } })).toBe(2);
    expect(await preparingCount(runId)).toBe(0);
  });

  it("GM7-live: a second PREPARING INSERT is rejected by the DB index (23505)", async () => {
    // The index authority itself (the migration-level dirty-upgrade proof is done
    // via psql; here we prove the deployed index rejects a raw duplicate).
    const { runId } = await draftRun();
    await owner.auditRunPreparation.create({ data: { auditFirmId: FIRM, runId, generationNo: 1, status: "PREPARING" } });
    await expect(
      owner.auditRunPreparation.create({ data: { auditFirmId: FIRM, runId, generationNo: 2, status: "PREPARING" } }),
    ).rejects.toMatchObject({ code: "P2002" });
    expect(await preparingCount(runId)).toBe(1);
  });

  it("GM11: unrelated unique violations are NOT translated as a preparation conflict", async () => {
    const mk = (target: unknown, modelName?: string) => ({ code: "P2002", meta: { target, ...(modelName ? { modelName } : {}) } });
    // Positive (our invariant): named index, field pairs, resolved ["runId"], and
    // the raw-index "(not available)" case scoped by modelName.
    expect(isActivePreparationConflict(mk("ux_prep_active_generation_per_run"))).toBe(true);
    expect(isActivePreparationConflict(mk(["runId", "generationNo"]))).toBe(true);
    expect(isActivePreparationConflict(mk("audit_run_preparations_runId_generationNo_key"))).toBe(true);
    expect(isActivePreparationConflict(mk(["runId"], "AuditRunPreparation"))).toBe(true);
    expect(isActivePreparationConflict(mk(undefined, "AuditRunPreparation"))).toBe(true); // "(not available)"
    // Negative (unrelated tables/constraints — no AuditRunPreparation scope):
    expect(isActivePreparationConflict(mk(["email"], "User"))).toBe(false);
    expect(isActivePreparationConflict(mk("users_email_key"))).toBe(false);
    expect(isActivePreparationConflict(mk(["auditFirmId", "key"], "AuditTest"))).toBe(false);
    expect(isActivePreparationConflict(mk(undefined, "AuditRunTestVersion"))).toBe(false);
    expect(isActivePreparationConflict({ code: "P2003" })).toBe(false);
    expect(isActivePreparationConflict(new Error("boom"))).toBe(false);
    expect(isActivePreparationConflict(null)).toBe(false);
  });

  it("GM12/GM15: a rejected second begin mutates no historical rows / scope data", async () => {
    const { runId, testKey, datasetId } = await draftRun();
    const g1 = await beginRunPreparation(actor, runId, beginInput(testKey, datasetId));
    await materializeAll(g1.prepId);
    await sealPreparation(FIRM, g1.prepId);
    const before = {
      prep: await owner.auditRunPreparation.findUniqueOrThrow({ where: { id: g1.prepId } }),
      members: await owner.auditRunScopeMember.count({ where: { preparationId: g1.prepId } }),
      resolutions: await owner.auditRunScopeResolution.findMany({ where: { preparationId: g1.prepId }, select: { eligiblePopulationFingerprint: true }, orderBy: { id: "asc" } }),
      runFreeze: (await owner.auditRun.findUniqueOrThrow({ where: { id: runId }, select: { freezeGeneration: true, status: true } })),
    };
    // gen1 COMPLETE, run PREPARING → a NEW begin is allowed (gen2). Then a THIRD
    // begin must be rejected (gen2 active) and must not touch gen1 or gen2 data.
    const g2 = await beginRunPreparation(actor, runId, beginInput(testKey, datasetId));
    await expect(beginRunPreparation(actor, runId, beginInput(testKey, datasetId))).rejects.toBeInstanceOf(RunStateError);
    const after = {
      prep: await owner.auditRunPreparation.findUniqueOrThrow({ where: { id: g1.prepId } }),
      members: await owner.auditRunScopeMember.count({ where: { preparationId: g1.prepId } }),
      resolutions: await owner.auditRunScopeResolution.findMany({ where: { preparationId: g1.prepId }, select: { eligiblePopulationFingerprint: true }, orderBy: { id: "asc" } }),
      runFreeze: (await owner.auditRun.findUniqueOrThrow({ where: { id: runId }, select: { freezeGeneration: true, status: true } })),
    };
    expect(after.prep).toEqual(before.prep);
    expect(after.members).toBe(before.members);
    expect(after.resolutions).toEqual(before.resolutions);
    expect(after.runFreeze).toEqual(before.runFreeze);
    expect(g2.generationNo).toBe(2);
  });

  it("GM13: locator reflects one/zero PREPARING correctly across seal", async () => {
    const { runId, testKey, datasetId } = await draftRun();
    const g1 = await beginRunPreparation(actor, runId, beginInput(testKey, datasetId));
    // Sort this run to the front of the locator's oldest-first window so the check
    // is robust to runnable rows accumulated by other suites (LIMIT 200 + per-firm
    // cap). updatedAt is freely mutable on a non-terminal run.
    await owner.$executeRawUnsafe(`UPDATE public."audit_runs" SET "updatedAt"='1999-01-01T00:00:00Z' WHERE "id"=$1`, runId);
    const seen = async () => {
      const rows = await owner.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL ROLE audit_dispatch");
        return tx.$queryRawUnsafe<Array<{ runId: string; workType: string }>>("SELECT * FROM app_locate_runnable_work()");
      });
      return rows.some((r) => r.runId === runId && r.workType === "PREPARATION");
    };
    expect(await seen()).toBe(true); // one PREPARING
    await materializeAll(g1.prepId);
    await sealPreparation(FIRM, g1.prepId);
    expect(await seen()).toBe(false); // zero PREPARING (COMPLETE, awaiting publish)
  });

  it("GM14: remediation never publishes — run never QUEUED, no freezeGeneration", async () => {
    const { runId, testKey, datasetId } = await draftRun();
    await beginRunPreparation(actor, runId, beginInput(testKey, datasetId));
    try { await beginRunPreparation(actor, runId, beginInput(testKey, datasetId)); } catch { /* expected 409 */ }
    const r = await owner.auditRun.findUniqueOrThrow({ where: { id: runId }, select: { status: true, freezeGeneration: true } });
    expect(r.status).toBe("PREPARING");
    expect(r.freezeGeneration).toBeNull();
  });

  it("GM-tenant: firm B cannot see or affect firm A preparation state (RLS)", async () => {
    const { runId } = await draftRun();
    await owner.auditRunPreparation.create({ data: { auditFirmId: FIRM, runId, generationNo: 1, status: "PREPARING" } });
    const seenByB = await withTenantContext("firmB", (t) => t.auditRunPreparation.findMany({ where: { runId }, select: { id: true } }));
    expect(seenByB).toHaveLength(0);
    const affected = await withTenantContext("firmB", (t) => t.$executeRawUnsafe(`UPDATE public."audit_run_preparations" SET "status"='COMPLETE' WHERE "runId"=$1`, runId));
    expect(affected).toBe(0);
    expect(await preparingCount(runId)).toBe(1);
  });
});
