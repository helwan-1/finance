/**
 * G6 FINAL CLOSURE — real persisted PostgreSQL end-to-end acceptance.
 *
 * Drives the full professional audit workflow through the ACTUAL service layer
 * (the thin functions the API routes wrap) + the C3-3C background runtime, against
 * real PostgreSQL with audit_app RLS. Proves each durable artifact of the target
 * chain and cross-tenant isolation. Gated by G4_DB_TEST.
 *
 *   login-actor → client+engagement → upload CSV (source RETAINED) → import +
 *   canonicalize → create run → select datasets+tests → begin preparation →
 *   preparation completes → human publish (QUEUED) → background runtime executes →
 *   results appear → auditor dispositions → exception/finding created → evidence
 *   traceable to imported records → historical run reopened with frozen identity.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withTenantContext } from "@/lib/db/tenant";
import { startImport, confirmImport } from "@/lib/import/pipeline";
import { materializePopulation } from "@/lib/g4/preparation";
import { createRun, beginRunPreparation, sealRunPreparation, publishRunForActor, getRun, getRunResults, getRunJobs, RunAccessError, type RunActor } from "@/lib/g4/app/run-access";
import { runDispatcherTick } from "@/lib/g4/runtime";
import { recordResultDisposition } from "@/lib/g5/disposition";
import { createExceptionFromResult } from "@/lib/g5/exception";
import { createFinding } from "@/lib/g5/finding";
import type { Coordinate } from "@/lib/g4/dispatcher";

const run = process.env.G4_DB_TEST ? describe : describe.skip;
const owner = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_DATABASE_URL } } });
const FIRM = "firmA", ENG = "engA", U = "u-e2e";
const actor: RunActor = { userId: U, auditFirmId: FIRM };
const dispatchLocate = (): Promise<Coordinate[]> =>
  owner.$transaction(async (tx) => { await tx.$executeRawUnsafe("SET LOCAL ROLE audit_dispatch"); return tx.$queryRawUnsafe<Coordinate[]>("SELECT * FROM app_locate_runnable_work()"); });

run("G6 FINAL — end-to-end acceptance (real PostgreSQL)", () => {
  vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
  const PRIOR = process.env.AUDIT_ENGINE_BUILD;
  beforeAll(async () => {
    process.env.AUDIT_ENGINE_BUILD = "test-build-e2e";
    const s = await import("../g4/_seed"); await s.ensureSeed();
    await owner.user.upsert({ where: { id: U }, update: {}, create: { id: U, auditFirmId: FIRM, email: `${U}@t.example`, fullName: U, fullNameAr: "م", role: "MANAGER", passwordHash: "x" } });
    await owner.engagementMember.upsert({ where: { engagementId_userId: { engagementId: ENG, userId: U } }, update: {}, create: { engagementId: ENG, userId: U } });
    await owner.auditFindingCategoryRef.upsert({ where: { code: "COMPLIANCE" }, update: {}, create: { code: "COMPLIANCE", label: "Compliance", labelAr: "امتثال" } });
  }, 120_000);
  afterAll(async () => { if (PRIOR === undefined) delete process.env.AUDIT_ENGINE_BUILD; else process.env.AUDIT_ENGINE_BUILD = PRIOR; await owner.$disconnect(); await prisma.$disconnect(); });

  it("full workflow: upload→import→run→prepare→publish→execute→results→disposition→finding→evidence→reopen", async () => {
    const nonce = randomUUID();
    // ── 1. Upload CSV — source RETAINED (custody) ────────────────────────────
    const csv = "account,date,debit,currency\n" + Array.from({ length: 5 }, (_, i) => `70${i},2024-03-0${i + 1},${i + 1}.00,USD`).join("\n") + "\n";
    const start = await startImport({ auditFirmId: FIRM, userId: U, engagementId: ENG, datasetKind: "GENERAL_LEDGER", fileName: `e2e-${nonce}.csv`, mimeType: "text/csv", bytes: Buffer.from(csv, "utf8"), idempotencyKey: `e2e-${nonce}`, acknowledgeDuplicate: true });
    expect(start.sourceFileId).toBeTruthy();
    const custody = await withTenantContext(FIRM, (t) => t.sourceFile.findUniqueOrThrow({ where: { id: start.sourceFileId! }, select: { custodyStatus: true, sha256: true } }));
    expect(custody.custodyStatus).toBe("RETAINED");
    expect(custody.sha256).toBeTruthy();

    // ── 2. Import + canonicalize ─────────────────────────────────────────────
    await confirmImport(FIRM, U, start.batchId!);
    const ds = start.datasetId!;
    const dataset = await withTenantContext(FIRM, (t) => t.dataset.findUniqueOrThrow({ where: { id: ds }, select: { status: true, datasetHash: true } }));
    expect(["COMPLETED", "COMPLETED_WITH_ISSUES"]).toContain(dataset.status);
    expect(dataset.datasetHash).toBeTruthy();
    const jl = await withTenantContext(FIRM, (t) => t.journalLine.count({ where: { datasetId: ds } }));
    expect(jl).toBeGreaterThan(0); // canonical accounting produced

    // ── 3. Create audit run (authenticated actor + membership) ───────────────
    const testKey = `T-E2E-${nonce}`;
    const tvId = await withTenantContext(FIRM, async (t) => {
      const test = await t.auditTest.create({ data: { auditFirmId: FIRM, key: testKey, name: "n", nameAr: "ن", testType: "DATA_QUALITY" }, select: { id: true } });
      const tv = await t.auditTestVersion.create({ data: { auditFirmId: FIRM, auditTestId: test.id, version: 1, testType: "DATA_QUALITY", definitionJson: { dqKind: "POPULATION_MEMBER" }, requirementsJson: { requiredDatasetKinds: ["GENERAL_LEDGER"] }, versionHash: `vh-${nonce}`, status: "ACTIVE" }, select: { id: true } });
      await t.auditTest.update({ where: { id: test.id }, data: { currentVersionId: tv.id } });
      return tv.id;
    });
    const { runId } = await createRun(actor, { engagementId: ENG });
    expect((await getRun(actor, runId)).status).toBe("DRAFT");

    // ── 4. Select datasets+tests → begin preparation → complete → seal ───────
    const { prepId } = await beginRunPreparation(actor, runId, { tests: [{ testKey }], datasetIds: [ds], batchSize: 500 });
    await materializePopulation(FIRM, prepId, tvId, ds, { batchSize: 500 });
    const { manifestHash } = await sealRunPreparation(actor, runId, prepId);
    expect(manifestHash).toBeTruthy();

    // ── 5. Human publish → QUEUED + frozen identity ──────────────────────────
    const pub = await publishRunForActor(actor, runId, prepId);
    expect(pub.configFingerprint).toBeTruthy();
    const queued = await getRun(actor, runId);
    expect(queued.status).toBe("QUEUED");
    expect(queued.freezeGeneration).toBe(prepId);

    // ── 6. Background runtime executes the QUEUED run ─────────────────────────
    // Test isolation only: on a shared/accumulated DB the locator window (oldest-
    // first, capped) can be saturated by other suites' runnable runs; backdate this
    // run so it lands in the window. Does not affect the frozen identity/results.
    await owner.$executeRawUnsafe(`UPDATE public."audit_runs" SET "updatedAt"='1999-01-01T00:00:00Z' WHERE "id"=$1`, runId);
    const summary = await runDispatcherTick({ locate: dispatchLocate, maxCoordinatesPerCycle: 200, maxConcurrency: 4 });
    expect(summary.results.find((r) => r.runId === runId)?.outcome).toBe("DONE");
    expect((await getRun(actor, runId)).status).toBe("COMPLETED");

    // ── 7. Results + jobs visible through the authenticated boundary ─────────
    const results = await getRunResults(actor, runId);
    expect(results.length).toBeGreaterThan(0);
    const jobs = await getRunJobs(actor, runId);
    expect(jobs.some((j) => j.status === "SUCCEEDED")).toBe(true);

    // ── 8. Evidence traceability → imported records ──────────────────────────
    const evidence = await owner.auditResultEvidence.findMany({ where: { auditResultId: { in: results.map((r) => r.id) } }, select: { importedRecordId: true } });
    expect(evidence.length).toBeGreaterThan(0);
    const impIds = evidence.map((e) => e.importedRecordId).filter((x): x is string => !!x);
    expect(impIds.length).toBeGreaterThan(0);
    const tracedback = await owner.importedRecord.count({ where: { id: { in: impIds }, datasetId: ds } });
    expect(tracedback).toBe(impIds.length); // every evidence row traces to a real imported record in this dataset

    // ── 9. Auditor disposition ───────────────────────────────────────────────
    const disp = await recordResultDisposition(FIRM, { auditResultId: results[0]!.id, actorId: U, action: "REQUIRE_INVESTIGATION", idempotencyKey: `disp-${nonce}` });
    expect(disp.currentState).toBe("INVESTIGATING");

    // ── 10. Exception + finding (evidence-linked) ────────────────────────────
    const { exceptionId } = await createExceptionFromResult(FIRM, { engagementId: ENG, createdById: U, title: "E2E exception", firstResultId: results[0]!.id, idempotencyKey: `exc-${nonce}` });
    expect(exceptionId).toBeTruthy();
    const linked = await owner.auditExceptionResultLink.count({ where: { exceptionId } });
    expect(linked).toBeGreaterThan(0); // result linked to the matter (traceable)
    const { findingId } = await createFinding(FIRM, { exceptionId, engagementId: ENG, createdById: U, idempotencyKey: `fnd-${nonce}`, content: { category: "COMPLIANCE", condition: "c", criteria: "cr", cause: "ca", effect: "e", auditorConclusion: "concl" } });
    expect(findingId).toBeTruthy();

    // ── 11. Historical reproducibility — reopen with frozen identity ─────────
    const reopened = await getRun(actor, runId);
    expect(reopened.status).toBe("COMPLETED");
    expect(reopened.freezeGeneration).toBe(prepId);
    expect(reopened.configFingerprint).toBe(pub.configFingerprint);
    expect(reopened.engineBuildVersion).toBe("test-build-e2e");
    expect(reopened.frozenFirmLicenseNo).toBeTruthy();
    expect(reopened.frozenFiscalYear).not.toBeNull();
    expect(reopened.frozenClientSemanticKey).toBeTruthy();

    // ── 12. Cross-tenant isolation ───────────────────────────────────────────
    const foreign: RunActor = { userId: "intruder", auditFirmId: "firmB" };
    await expect(getRun(foreign, runId)).rejects.toBeInstanceOf(RunAccessError);
    await expect(getRunResults(foreign, runId)).rejects.toBeInstanceOf(RunAccessError);
  });
});
