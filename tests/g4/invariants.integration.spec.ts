/**
 * G4 Phase A — persistence invariants (matrix H–R). Gated by G4_DB_TEST.
 * Immutability, uniqueness, typed-evidence CHECK, occurrence multiplicity,
 * authoritative-generation, set-once/terminal, RULE↔ruleVersion.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { withTenantContext } from "@/lib/db/tenant";
import { ensureSeed, seedDataset, seedRunGraph } from "./_seed";

const run = process.env.G4_DB_TEST ? describe : describe.skip;

run("G4 Phase A invariants", () => {
  beforeAll(async () => { await ensureSeed(); });
  afterAll(async () => { await prisma.$disconnect(); });

  it("H: immutable AuditTestVersion UPDATE is refused (permission denied)", async () => {
    const g = await seedRunGraph("firmA");
    await expect(
      withTenantContext("firmA", (t) => t.$executeRaw`UPDATE "audit_test_versions" SET "versionHash"='x' WHERE "id"=${g.testVersionId}`),
    ).rejects.toThrow(/permission denied/i);
  });

  it("I: immutable AuditResult UPDATE and DELETE are refused", async () => {
    const g = await seedRunGraph("firmA");
    await expect(
      withTenantContext("firmA", (t) => t.$executeRaw`UPDATE "audit_results" SET "score"=0 WHERE "id"=${g.resultId}`),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      withTenantContext("firmA", (t) => t.$executeRaw`DELETE FROM "audit_results" WHERE "id"=${g.resultId}`),
    ).rejects.toThrow(/permission denied/i);
  });

  it("J: result occurrence fingerprint is unique within a run; K: semantic fingerprint may repeat across runs", async () => {
    const g = await seedRunGraph("firmA");
    // J — duplicate occurrence fingerprint in the same run → rejected.
    await expect(
      withTenantContext("firmA", (t) => t.auditResult.create({ data: {
        auditFirmId: "firmA", runId: g.runId, auditRunTestVersionId: g.runTestVersionId,
        resultKind: "ANOMALY", resultCode: "TEST", severity: "LOW", score: "10.00", payloadJson: {},
        resultOccurrenceFingerprint: `occ-${g.nonce}`, // same as seeded result
        resultSemanticFingerprint: `other-${randomUUID()}`,
      } })),
    ).rejects.toThrow();
    // K — same semantic fingerprint in a DIFFERENT run → allowed.
    const g2 = await seedRunGraph("firmA");
    const shared = `shared-sem-${randomUUID()}`;
    await withTenantContext("firmA", (t) => t.auditResult.create({ data: {
      auditFirmId: "firmA", runId: g.runId, auditRunTestVersionId: g.runTestVersionId,
      resultKind: "ANOMALY", resultCode: "TEST", severity: "LOW", score: "10.00", payloadJson: {},
      resultOccurrenceFingerprint: `occA-${randomUUID()}`, resultSemanticFingerprint: shared,
    } }));
    const ok = await withTenantContext("firmA", (t) => t.auditResult.create({ data: {
      auditFirmId: "firmA", runId: g2.runId, auditRunTestVersionId: g2.runTestVersionId,
      resultKind: "ANOMALY", resultCode: "TEST", severity: "LOW", score: "10.00", payloadJson: {},
      resultOccurrenceFingerprint: `occB-${randomUUID()}`, resultSemanticFingerprint: shared,
    }, select: { id: true } }));
    expect(ok.id).toBeTruthy();
  });

  it("L: typed evidence CHECK — exactly one target must match evidenceType", async () => {
    const g = await seedRunGraph("firmA");
    const ds = await seedDataset();
    // Valid: JOURNAL_LINE with journalLineId only.
    const good = await withTenantContext("firmA", (t) => t.auditResultEvidence.create({ data: {
      auditFirmId: "firmA", auditResultId: g.resultId, evidenceType: "JOURNAL_LINE",
      journalLineId: ds.journalLineId, sourceRowNo: 1,
    }, select: { id: true } }));
    expect(good.id).toBeTruthy();
    // Invalid: evidenceType JOURNAL_LINE but importedRecordId populated (wrong target) → CHECK.
    await expect(
      withTenantContext("firmA", (t) => t.auditResultEvidence.create({ data: {
        auditFirmId: "firmA", auditResultId: g.resultId, evidenceType: "JOURNAL_LINE",
        importedRecordId: ds.importedRecordId,
      } })),
    ).rejects.toThrow();
    // Invalid: no target at all → CHECK.
    await expect(
      withTenantContext("firmA", (t) => t.auditResultEvidence.create({ data: {
        auditFirmId: "firmA", auditResultId: g.resultId, evidenceType: "DATASET",
      } })),
    ).rejects.toThrow();
  });

  it("M: two identical-content rows at different sourceRowNo are distinct members; duplicate sourceRowNo rejected", async () => {
    const g = await seedRunGraph("firmA");
    const ds = await seedDataset();
    const mk = (sourceRowNo: number) => withTenantContext("firmA", (t) => t.auditRunScopeMember.create({ data: {
      auditFirmId: "firmA", preparationId: g.prepId, auditTestVersionId: g.testVersionId,
      datasetId: ds.datasetId, sourceRowNo, evidenceType: "IMPORTED_RECORD",
      eoiFrameHash: `eoi-${sourceRowNo}`, contentHash: "SAME_CONTENT_HASH", // identical content
    }, select: { id: true } }));
    const m10 = await mk(10);
    const m11 = await mk(11); // same contentHash, different sourceRowNo → allowed
    expect(m10.id).not.toBe(m11.id);
    await expect(mk(10)).rejects.toThrow(); // duplicate (prep,testVersion,dataset,sourceRowNo)
  });

  it("N: generation number is unique per run; Q: job attemptNo unique; R: reviewSeq unique", async () => {
    const g = await seedRunGraph("firmA");
    // N
    await expect(
      withTenantContext("firmA", (t) => t.auditRunPreparation.create({ data: { auditFirmId: "firmA", runId: g.runId, generationNo: 1 } })),
    ).rejects.toThrow(); // gen 1 already exists from seedRunGraph
    // Q
    await withTenantContext("firmA", (t) => t.auditJob.create({ data: { auditFirmId: "firmA", runId: g.runId, attemptNo: 1 } }));
    await expect(
      withTenantContext("firmA", (t) => t.auditJob.create({ data: { auditFirmId: "firmA", runId: g.runId, attemptNo: 1 } })),
    ).rejects.toThrow();
    // R
    await withTenantContext("firmA", (t) => t.auditResultReview.create({ data: { auditFirmId: "firmA", auditResultId: g.resultId, reviewSeq: 1, state: "OPEN" } }));
    await expect(
      withTenantContext("firmA", (t) => t.auditResultReview.create({ data: { auditFirmId: "firmA", auditResultId: g.resultId, reviewSeq: 1, state: "RESOLVED" } })),
    ).rejects.toThrow();
  });

  it("O: freezeGeneration cannot point to another run's generation", async () => {
    const gA = await seedRunGraph("firmA"); // run A + its prep (gen1)
    const gB = await seedRunGraph("firmA"); // run B + its prep (gen1)
    // Point run B's freezeGeneration at run A's preparation → composite FK (firm,id,freezeGen)->(firm,runId,id) fails.
    await expect(
      withTenantContext("firmA", (t) => t.$executeRaw`UPDATE "audit_runs" SET "freezeGeneration"=${gA.prepId} WHERE "id"=${gB.runId}`),
    ).rejects.toThrow(/foreign key|violates/i);
    // Correct pinning to the run's OWN generation succeeds.
    await withTenantContext("firmA", (t) => t.$executeRaw`UPDATE "audit_runs" SET "freezeGeneration"=${gB.prepId} WHERE "id"=${gB.runId}`);
    const row = await withTenantContext("firmA", (t) => t.auditRun.findUnique({ where: { id: gB.runId }, select: { freezeGeneration: true } }));
    expect(row?.freezeGeneration).toBe(gB.prepId);
  });

  it("P: a PUBLISHED authoritative generation cannot be deleted or replaced", async () => {
    const g = await seedRunGraph("firmA");
    // publish: point run to its generation, mark generation PUBLISHED
    await withTenantContext("firmA", (t) => t.$executeRaw`UPDATE "audit_runs" SET "freezeGeneration"=${g.prepId} WHERE "id"=${g.runId}`);
    await withTenantContext("firmA", (t) => t.auditRunPreparation.update({ where: { id: g.prepId }, data: { status: "PUBLISHED" } }));
    // cannot delete (FK RESTRICT from audit_runs.freezeGeneration)
    await expect(
      withTenantContext("firmA", (t) => t.auditRunPreparation.delete({ where: { id: g.prepId } })),
    ).rejects.toThrow();
    // cannot mutate a PUBLISHED generation (trigger)
    await expect(
      withTenantContext("firmA", (t) => t.$executeRaw`UPDATE "audit_run_preparations" SET "preparationManifestHash"='x' WHERE "id"=${g.prepId}`),
    ).rejects.toThrow(/immutable/i);
    // cannot replace the authoritative pointer (set-once trigger)
    const other = await withTenantContext("firmA", (t) => t.auditRunPreparation.create({ data: { auditFirmId: "firmA", runId: g.runId, generationNo: 2 } , select: { id: true } }));
    await expect(
      withTenantContext("firmA", (t) => t.$executeRaw`UPDATE "audit_runs" SET "freezeGeneration"=${other.id} WHERE "id"=${g.runId}`),
    ).rejects.toThrow(/set-once/i);
  });

  it("S: set-once/terminal — a terminal AuditRun is frozen", async () => {
    const g = await seedRunGraph("firmA");
    await withTenantContext("firmA", (t) => t.auditRun.update({ where: { id: g.runId }, data: { status: "CANCELLED" } }));
    await expect(
      withTenantContext("firmA", (t) => t.auditRun.update({ where: { id: g.runId }, data: { label: "changed" } })),
    ).rejects.toThrow(/terminal/i);
  });

  it("RULE↔ruleVersion CHECK: a RULE-type run test version requires a rule version", async () => {
    const g = await seedRunGraph("firmA");
    // A distinct test version so the (prep, testVersion) unique does not mask the CHECK.
    const tv2 = await withTenantContext("firmA", async (t) => {
      const test = await t.auditTest.create({ data: { auditFirmId: "firmA", key: `TR-${randomUUID()}`, name: "r", nameAr: "ر", testType: "RULE" }, select: { id: true } });
      return t.auditTestVersion.create({ data: { auditFirmId: "firmA", auditTestId: test.id, version: 1, testType: "RULE", definitionJson: {}, requirementsJson: {}, versionHash: `vh-${randomUUID()}` }, select: { id: true } });
    });
    await expect(
      withTenantContext("firmA", (t) => t.auditRunTestVersion.create({ data: {
        auditFirmId: "firmA", preparationId: g.prepId, runId: g.runId, auditTestVersionId: tv2.id,
        testType: "RULE", auditRuleVersionId: null, effectiveParametersJson: {}, effectiveParametersHash: "h", orderIndex: 1,
      } })),
    ).rejects.toThrow();
  });
});
