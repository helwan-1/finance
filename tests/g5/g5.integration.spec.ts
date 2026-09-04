/**
 * G5 Phase C — professional disposition & findings (real PostgreSQL, G4_DB_TEST).
 * Proves the DB-enforced guarantees: RLS/tenant + cross-engagement + membership +
 * reviewer≠preparer rejection, append-only immutability, currency CHECK, event
 * sequencing + idempotency, stable matter identity vs derived membership, and
 * atomic TX rollback. Fixtures use the real G4 import→freeze→execute pipeline.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withTenantContext } from "@/lib/db/tenant";
import { startImport, confirmImport } from "@/lib/import/pipeline";
import { createDraftRun } from "@/lib/g4/run";
import { beginPreparation, materializePopulation, sealPreparation } from "@/lib/g4/preparation";
import { publishRun } from "@/lib/g4/publish";
import { executeRun } from "@/lib/g4/execution/execute";
import { recordResultDisposition } from "@/lib/g5/disposition";
import { createExceptionFromResult, linkResultToException, unlinkResultFromException } from "@/lib/g5/exception";
import { createFinding, reviseFinding, submitFinding, reviewFinding } from "@/lib/g5/finding";
import { IdempotencyConflictError, PreconditionError } from "@/lib/g5/errors";

const run = process.env.G4_DB_TEST ? describe : describe.skip;
const owner = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_DATABASE_URL } } });

async function mkUser(firm: string, role: "PARTNER" | "MANAGER" | "STAFF"): Promise<string> {
  const id = `u-${randomUUID()}`;
  await withTenantContext(firm, (t) => t.user.create({ data: { id, auditFirmId: firm, email: `${id}@x.co`, fullName: id, fullNameAr: id, role } }));
  return id;
}
async function addMember(firm: string, engagementId: string, userId: string) {
  await withTenantContext(firm, (t) => t.engagementMember.create({ data: { engagementId, userId } }));
}
async function mkEngagement(firm: string, clientId: string): Promise<string> {
  const id = `eng-${randomUUID()}`;
  await withTenantContext(firm, (t) => t.auditEngagement.create({ data: { id, auditFirmId: firm, clientCompanyId: clientId, title: id, titleAr: id, fiscalYear: 2024, periodStart: new Date("2024-01-01"), periodEnd: new Date("2024-12-31"), currency: "SAR" } }));
  return id;
}
/** Produce real AuditResults (AI_INVALID_DEBIT_CREDIT, one per both-sided line). */
async function produceResults(firm: string, engagementId: string, lines: number): Promise<Array<{ id: string; sem: string }>> {
  const n = randomUUID();
  let csv = "account,date,debit,credit,currency\n";
  for (let i = 0; i < lines; i++) csv += `${100 + i},2024-01-01,5.00,3.00,USD\n`; // both-sided → invalid
  const start = await startImport({ auditFirmId: firm, userId: null, engagementId, datasetKind: "GENERAL_LEDGER", fileName: `g5-${n}.csv`, mimeType: "text/csv", bytes: Buffer.from(csv, "utf8"), idempotencyKey: `g5-${n}`, acknowledgeDuplicate: true });
  await confirmImport(firm, null, start.batchId!);
  const key = `T-${n}`;
  const tv = await withTenantContext(firm, async (t) => {
    const test = await t.auditTest.create({ data: { auditFirmId: firm, key, name: "n", nameAr: "ن", testType: "ACCOUNTING_INTEGRITY" }, select: { id: true } });
    const v = await t.auditTestVersion.create({ data: { auditFirmId: firm, auditTestId: test.id, version: 1, testType: "ACCOUNTING_INTEGRITY", definitionJson: { kind: "INVALID_DEBIT_CREDIT" }, requirementsJson: { requiredDatasetKinds: ["GENERAL_LEDGER"] }, versionHash: `vh-${n}`, status: "ACTIVE" }, select: { id: true } });
    await t.auditTest.update({ where: { id: test.id }, data: { currentVersionId: v.id } });
    return v.id;
  });
  void tv;
  const { runId } = await createDraftRun(firm, { engagementId });
  const { prepId } = await beginPreparation(firm, { runId, tests: [{ testKey: key }], datasetIds: [start.datasetId!], batchSize: 500 });
  const chunks = await withTenantContext(firm, (t) => t.auditRunPrepChunk.findMany({ where: { preparationId: prepId }, select: { auditTestVersionId: true, datasetId: true } }));
  for (const c of chunks) await materializePopulation(firm, prepId, c.auditTestVersionId, c.datasetId, { batchSize: 500 });
  await sealPreparation(firm, prepId);
  await publishRun(firm, runId, prepId);
  expect((await executeRun(firm, runId, "w")).outcome).toBe("COMPLETED");
  return withTenantContext(firm, (t) => t.auditResult.findMany({ where: { runId, resultCode: "AI_INVALID_DEBIT_CREDIT" }, select: { id: true, resultSemanticFingerprint: true } })).then((rs) => rs.map((r) => ({ id: r.id, sem: r.resultSemanticFingerprint })));
}

/** A minimal real AuditResult row (valid FK chain, no journal lines) — for the
 *  cross-tenant fixture, so firmB stays journal-line-free (a G3 RLS invariant). */
async function fabricateResult(firm: string, engagementId: string): Promise<{ id: string; sem: string }> {
  const n = randomUUID();
  const test = await owner.auditTest.create({ data: { auditFirmId: firm, key: `FT-${n}`, name: "n", nameAr: "ن", testType: "ACCOUNTING_INTEGRITY" }, select: { id: true } });
  const tv = await owner.auditTestVersion.create({ data: { auditFirmId: firm, auditTestId: test.id, version: 1, testType: "ACCOUNTING_INTEGRITY", definitionJson: {}, requirementsJson: {}, versionHash: `vh-${n}`, status: "ACTIVE" }, select: { id: true } });
  const rn = await owner.auditRun.create({ data: { auditFirmId: firm, engagementId, status: "COMPLETED" }, select: { id: true } });
  const prep = await owner.auditRunPreparation.create({ data: { auditFirmId: firm, runId: rn.id, generationNo: 1, status: "PUBLISHED" }, select: { id: true } });
  const artv = await owner.auditRunTestVersion.create({ data: { auditFirmId: firm, preparationId: prep.id, runId: rn.id, auditTestVersionId: tv.id, testType: "ACCOUNTING_INTEGRITY", effectiveParametersJson: {}, effectiveParametersHash: `ph-${n}`, orderIndex: 0 }, select: { id: true } });
  const sem = `sem-${n}`;
  const res = await owner.auditResult.create({ data: { auditFirmId: firm, runId: rn.id, auditRunTestVersionId: artv.id, resultKind: "ACCOUNTING_INTEGRITY", resultCode: "AI_INVALID_DEBIT_CREDIT", severity: "HIGH", score: "0.00", payloadJson: {}, resultOccurrenceFingerprint: `occ-${n}`, resultSemanticFingerprint: sem }, select: { id: true } });
  return { id: res.id, sem };
}

let uPrep = "", uRev = "", uNon = "", engA2 = "", uB = "";
let rA: Array<{ id: string; sem: string }> = [], rA2: Array<{ id: string; sem: string }> = [], rB: Array<{ id: string; sem: string }> = [];

run("G5 professional disposition & findings", () => {
  const PRIOR = process.env.AUDIT_ENGINE_BUILD;
  beforeAll(async () => {
    process.env.AUDIT_ENGINE_BUILD = "test-build-g5";
    const s = await import("../g4/_seed"); await s.ensureSeed();
    uPrep = await mkUser("firmA", "STAFF");
    uRev = await mkUser("firmA", "MANAGER");
    uNon = await mkUser("firmA", "STAFF"); // never a member
    engA2 = await mkEngagement("firmA", "clientA");
    await addMember("firmA", "engA", uPrep); await addMember("firmA", "engA", uRev);
    await addMember("firmA", engA2, uPrep); await addMember("firmA", engA2, uRev);
    uB = await mkUser("firmB", "MANAGER"); await addMember("firmB", "engB", uB);
    rA = await produceResults("firmA", "engA", 2);
    rA2 = await produceResults("firmA", engA2, 1);
    rB = [await fabricateResult("firmB", "engB")]; // no journal lines → preserves G3 firmB-empty invariant
    expect(rA.length).toBe(2); expect(rA2.length).toBe(1); expect(rB.length).toBe(1);
  }, 120_000);
  afterAll(async () => { if (PRIOR === undefined) delete process.env.AUDIT_ENGINE_BUILD; else process.env.AUDIT_ENGINE_BUILD = PRIOR; await owner.$disconnect(); await prisma.$disconnect(); });

  const newExc = (createdById = uPrep, firstResultId = rA[0]!.id, engagementId = "engA") =>
    createExceptionFromResult("firmA", { engagementId, createdById, title: "matter", firstResultId, idempotencyKey: randomUUID() });

  it("H: non-member actor rejected at DB level (disposition + exception)", async () => {
    await expect(recordResultDisposition("firmA", { auditResultId: rA[0]!.id, actorId: uNon, action: "MARK_UNDER_REVIEW", idempotencyKey: randomUUID() })).rejects.toThrow(/member/i);
    await expect(createExceptionFromResult("firmA", { engagementId: "engA", createdById: uNon, title: "x", firstResultId: rA[0]!.id, idempotencyKey: randomUUID() })).rejects.toThrow(/member/i);
  });

  it("member disposition succeeds; AB idempotent retry; AC key-reuse conflict", async () => {
    const k = randomUUID();
    const a = await recordResultDisposition("firmA", { auditResultId: rA[0]!.id, actorId: uPrep, action: "MARK_FALSE_POSITIVE", note: "payroll", idempotencyKey: k });
    const b = await recordResultDisposition("firmA", { auditResultId: rA[0]!.id, actorId: uPrep, action: "MARK_FALSE_POSITIVE", note: "payroll", idempotencyKey: k });
    expect(b.eventId).toBe(a.eventId); // same committed event (idempotent)
    await expect(recordResultDisposition("firmA", { auditResultId: rA[0]!.id, actorId: uPrep, action: "MARK_FALSE_POSITIVE", note: "DIFFERENT", idempotencyKey: k })).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  it("idempotency per command class: create/link/review replay + conflict", async () => {
    // createException: same key → same matter; different payload → conflict
    const k1 = randomUUID();
    const a = await createExceptionFromResult("firmA", { engagementId: "engA", createdById: uPrep, title: "t", firstResultId: rA[0]!.id, idempotencyKey: k1 });
    const b = await createExceptionFromResult("firmA", { engagementId: "engA", createdById: uPrep, title: "t", firstResultId: rA[0]!.id, idempotencyKey: k1 });
    expect(b.exceptionId).toBe(a.exceptionId); // idempotent replay
    await expect(createExceptionFromResult("firmA", { engagementId: "engA", createdById: uPrep, title: "DIFFERENT", firstResultId: rA[0]!.id, idempotencyKey: k1 })).rejects.toBeInstanceOf(IdempotencyConflictError);
    // link: same key → no-op replay (one active link); different result → conflict
    const k2 = randomUUID();
    await linkResultToException("firmA", { exceptionId: a.exceptionId, actorId: uPrep, auditResultId: rA[1]!.id, idempotencyKey: k2 });
    await linkResultToException("firmA", { exceptionId: a.exceptionId, actorId: uPrep, auditResultId: rA[1]!.id, idempotencyKey: k2 }); // replay
    await expect(linkResultToException("firmA", { exceptionId: a.exceptionId, actorId: uPrep, auditResultId: rA[0]!.id, idempotencyKey: k2 })).rejects.toBeInstanceOf(IdempotencyConflictError);
    const linkEvents = await withTenantContext("firmA", (t) => t.auditExceptionEvent.count({ where: { exceptionId: a.exceptionId, eventType: "LINK", idempotencyKey: k2 } }));
    expect(linkEvents).toBe(1); // replay did not append a second event
    // review: same key → no-op replay
    const f = await createFinding("firmA", { exceptionId: a.exceptionId, engagementId: "engA", createdById: uPrep, content: baseContent(), idempotencyKey: randomUUID() });
    await submitFinding("firmA", { findingId: f.findingId, actorId: uPrep, idempotencyKey: randomUUID() });
    const k3 = randomUUID();
    await reviewFinding("firmA", { findingId: f.findingId, actorId: uRev, action: "APPROVE", findingVersionId: f.versionId, idempotencyKey: k3 });
    await reviewFinding("firmA", { findingId: f.findingId, actorId: uRev, action: "APPROVE", findingVersionId: f.versionId, idempotencyKey: k3 }); // replay no-op (already CONCLUDED)
    const revs = await withTenantContext("firmA", (t) => t.auditFindingReviewEvent.count({ where: { findingId: f.findingId, action: "APPROVE", idempotencyKey: k3 } }));
    expect(revs).toBe(1);
  });

  it("C1/C2: concurrent same-key createException — one object, both callers resolve; diff payload → one conflict", async () => {
    // C1: same key + same payload, two independent concurrent transactions
    const k1 = randomUUID();
    const p1 = { engagementId: "engA", createdById: uPrep, title: "conc", firstResultId: rA[0]!.id, idempotencyKey: k1 };
    const [a, b] = await Promise.allSettled([createExceptionFromResult("firmA", { ...p1 }), createExceptionFromResult("firmA", { ...p1 })]);
    expect(a.status).toBe("fulfilled"); expect(b.status).toBe("fulfilled");
    const id1 = (a as PromiseFulfilledResult<{ exceptionId: string }>).value.exceptionId;
    const id2 = (b as PromiseFulfilledResult<{ exceptionId: string }>).value.exceptionId;
    expect(id1).toBe(id2); // both callers resolve to the SAME object; no retry needed
    expect(await withTenantContext("firmA", (t) => t.auditException.count({ where: { creationIdempotencyKey: k1 } }))).toBe(1);
    expect(await withTenantContext("firmA", (t) => t.auditExceptionEvent.count({ where: { exceptionId: id1, eventType: "CREATE" } }))).toBe(1);
    expect(await withTenantContext("firmA", (t) => t.auditExceptionResultLink.count({ where: { exceptionId: id1 } }))).toBe(1);
    // C2: same key + different payload
    const k2 = randomUUID();
    const res = await Promise.allSettled([
      createExceptionFromResult("firmA", { engagementId: "engA", createdById: uPrep, title: "PayA", firstResultId: rA[0]!.id, idempotencyKey: k2 }),
      createExceptionFromResult("firmA", { engagementId: "engA", createdById: uPrep, title: "PayB", firstResultId: rA[0]!.id, idempotencyKey: k2 }),
    ]);
    expect(res.filter((r) => r.status === "fulfilled").length).toBe(1);
    const rej = res.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(rej.length).toBe(1);
    expect(rej[0]!.reason).toBeInstanceOf(IdempotencyConflictError);
    expect(await withTenantContext("firmA", (t) => t.auditException.count({ where: { creationIdempotencyKey: k2 } }))).toBe(1);
  }, 30_000);

  it("C3/C4: concurrent same-key createFinding — one Finding/v1, both resolve; diff content → one conflict", async () => {
    const { exceptionId } = await newExc();
    const k3 = randomUUID();
    const fp = { exceptionId, engagementId: "engA", createdById: uPrep, content: baseContent(), idempotencyKey: k3 };
    const [a, b] = await Promise.allSettled([createFinding("firmA", { ...fp }), createFinding("firmA", { ...fp })]);
    expect(a.status).toBe("fulfilled"); expect(b.status).toBe("fulfilled");
    const f1 = (a as PromiseFulfilledResult<{ findingId: string }>).value.findingId;
    const f2 = (b as PromiseFulfilledResult<{ findingId: string }>).value.findingId;
    expect(f1).toBe(f2);
    expect(await withTenantContext("firmA", (t) => t.auditFinding.count({ where: { creationIdempotencyKey: k3 } }))).toBe(1);
    expect(await withTenantContext("firmA", (t) => t.auditFindingVersion.count({ where: { findingId: f1 } }))).toBe(1);
    // C4: same key + different content
    const ex2 = await newExc();
    const k4 = randomUUID();
    const res = await Promise.allSettled([
      createFinding("firmA", { exceptionId: ex2.exceptionId, engagementId: "engA", createdById: uPrep, content: baseContent({ auditorConclusion: "X" }), idempotencyKey: k4 }),
      createFinding("firmA", { exceptionId: ex2.exceptionId, engagementId: "engA", createdById: uPrep, content: baseContent({ auditorConclusion: "Y" }), idempotencyKey: k4 }),
    ]);
    expect(res.filter((r) => r.status === "fulfilled").length).toBe(1);
    const rej = res.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(rej.length).toBe(1);
    expect(rej[0]!.reason).toBeInstanceOf(IdempotencyConflictError);
    expect(await withTenantContext("firmA", (t) => t.auditFinding.count({ where: { creationIdempotencyKey: k4 } }))).toBe(1);
  }, 30_000);

  it("M/N: per-result eventSeq deterministic; different results independent", async () => {
    const r = rA[1]!.id;
    const e1 = await recordResultDisposition("firmA", { auditResultId: r, actorId: uPrep, action: "MARK_UNDER_REVIEW", idempotencyKey: randomUUID() });
    const e2 = await recordResultDisposition("firmA", { auditResultId: r, actorId: uPrep, action: "REQUIRE_INVESTIGATION", idempotencyKey: randomUUID() });
    expect(e2.eventSeq).toBe(e1.eventSeq + 1);
    const other = await recordResultDisposition("firmA", { auditResultId: rA[0]!.id, actorId: uPrep, action: "MARK_UNDER_REVIEW", idempotencyKey: randomUUID() });
    expect(other.eventSeq).toBeGreaterThanOrEqual(1); // separate anchor, independent sequence
  });

  it("U/AD: exception create with bogus result rolls back atomically (no matter, no events)", async () => {
    const before = await withTenantContext("firmA", (t) => t.auditException.count());
    await expect(createExceptionFromResult("firmA", { engagementId: "engA", createdById: uPrep, title: "x", firstResultId: "does-not-exist", idempotencyKey: randomUUID() })).rejects.toBeInstanceOf(PreconditionError);
    expect(await withTenantContext("firmA", (t) => t.auditException.count())).toBe(before);
  });

  it("S7: cross-tenant result link rejected at DB level", async () => {
    const { exceptionId } = await newExc();
    await expect(linkResultToException("firmA", { exceptionId, actorId: uPrep, auditResultId: rB[0]!.id, idempotencyKey: randomUUID() })).rejects.toThrow();
  });

  it("S8/S15: same-firm cross-engagement result link rejected at DB level", async () => {
    const { exceptionId } = await newExc(); // engA exception
    await expect(linkResultToException("firmA", { exceptionId, actorId: uPrep, auditResultId: rA2[0]!.id, idempotencyKey: randomUUID() })).rejects.toThrow(/cross-engagement/i);
  });

  it("O/P/Q/R/S: unified timeline, link/unlink/relink history, membership vs stable identity", async () => {
    const { exceptionId } = await newExc(); // seq1 CREATE, seq2 LINK(rA0)
    const before = await withTenantContext("firmA", (t) => t.auditException.findFirstOrThrow({ where: { id: exceptionId }, select: { matterCorrelationKey: true, membershipFingerprint: true } }));
    await linkResultToException("firmA", { exceptionId, actorId: uPrep, auditResultId: rA[1]!.id, idempotencyKey: randomUUID() });     // seq3 LINK
    const twoLinks = await withTenantContext("firmA", (t) => t.auditException.findFirstOrThrow({ where: { id: exceptionId }, select: { matterCorrelationKey: true, membershipFingerprint: true } }));
    await unlinkResultFromException("firmA", { exceptionId, actorId: uPrep, auditResultId: rA[1]!.id, idempotencyKey: randomUUID() }); // seq4 UNLINK
    await linkResultToException("firmA", { exceptionId, actorId: uPrep, auditResultId: rA[1]!.id, idempotencyKey: randomUUID() });     // seq5 LINK (relink)
    const events = await withTenantContext("firmA", (t) => t.auditExceptionEvent.findMany({ where: { exceptionId }, orderBy: { eventSeq: "asc" }, select: { eventSeq: true, eventType: true } }));
    expect(events.map((e) => e.eventSeq)).toEqual([1, 2, 3, 4, 5]);            // one deterministic timeline
    expect(events.map((e) => e.eventType)).toEqual(["CREATE", "LINK", "LINK", "UNLINK", "LINK"]); // full history preserved
    const link = await withTenantContext("firmA", (t) => t.auditExceptionResultLink.findFirstOrThrow({ where: { exceptionId, auditResultId: rA[1]!.id }, select: { active: true } }));
    expect(link.active).toBe(true); // relink → active
    expect(before.matterCorrelationKey).toBe(twoLinks.matterCorrelationKey);   // S: identity stable
    expect(before.membershipFingerprint).not.toBe(twoLinks.membershipFingerprint); // R: membership derived, changes
  });

  it("T: same correlation key may coexist across separate matters (no auto-merge)", async () => {
    const a = await newExc(uPrep, rA[0]!.id, "engA");
    const b = await newExc(uPrep, rA[0]!.id, "engA");
    expect(a.exceptionId).not.toBe(b.exceptionId);
    const rows = await withTenantContext("firmA", (t) => t.auditException.findMany({ where: { id: { in: [a.exceptionId, b.exceptionId] } }, select: { matterCorrelationKey: true } }));
    expect(rows[0]!.matterCorrelationKey).toBe(rows[1]!.matterCorrelationKey);
  });

  it("V: finding requires an exception with an active result link", async () => {
    const { exceptionId } = await newExc();
    await unlinkResultFromException("firmA", { exceptionId, actorId: uPrep, auditResultId: rA[0]!.id, idempotencyKey: randomUUID() });
    await expect(createFinding("firmA", { exceptionId, engagementId: "engA", createdById: uPrep, content: baseContent(), idempotencyKey: randomUUID() })).rejects.toBeInstanceOf(PreconditionError);
  });

  it("I/W/X: reviewer≠preparer, approval binds to exact version, double-approval blocked", async () => {
    const { exceptionId } = await newExc();
    const f = await createFinding("firmA", { exceptionId, engagementId: "engA", createdById: uPrep, content: baseContent(), idempotencyKey: randomUUID() });
    await submitFinding("firmA", { findingId: f.findingId, actorId: uPrep, idempotencyKey: randomUUID() });
    // I: reviewer == preparer rejected at DB level
    await expect(reviewFinding("firmA", { findingId: f.findingId, actorId: uPrep, action: "APPROVE", findingVersionId: f.versionId, idempotencyKey: randomUUID() })).rejects.toThrow(/segregation|preparer/i);
    // W: approving a non-current version rejected → RETURN then revise to v2, approve v1 fails, v2 ok
    await reviewFinding("firmA", { findingId: f.findingId, actorId: uRev, action: "RETURN", findingVersionId: f.versionId, idempotencyKey: randomUUID() });
    const v2 = await reviseFinding("firmA", { findingId: f.findingId, preparedById: uPrep, content: baseContent({ auditorConclusion: "v2" }), idempotencyKey: randomUUID() });
    await submitFinding("firmA", { findingId: f.findingId, actorId: uPrep, idempotencyKey: randomUUID() });
    await expect(reviewFinding("firmA", { findingId: f.findingId, actorId: uRev, action: "APPROVE", findingVersionId: f.versionId, idempotencyKey: randomUUID() })).rejects.toBeInstanceOf(PreconditionError); // v1 not current
    await reviewFinding("firmA", { findingId: f.findingId, actorId: uRev, action: "APPROVE", findingVersionId: v2.versionId, idempotencyKey: randomUUID() });
    // X: second approval blocked (status no longer IN_REVIEW)
    await expect(reviewFinding("firmA", { findingId: f.findingId, actorId: uRev, action: "APPROVE", findingVersionId: v2.versionId, idempotencyKey: randomUUID() })).rejects.toBeInstanceOf(PreconditionError);
    const fin = await withTenantContext("firmA", (t) => t.auditFinding.findFirstOrThrow({ where: { id: f.findingId }, select: { currentStatus: true, currentVersionId: true } }));
    expect(fin.currentStatus).toBe("CONCLUDED"); expect(fin.currentVersionId).toBe(v2.versionId);
  });

  it("Y: currency-pair CHECK — amount without currency rejected", async () => {
    const { exceptionId } = await newExc();
    await expect(createFinding("firmA", { exceptionId, engagementId: "engA", createdById: uPrep, content: baseContent({ observedAmount: "100.00", observedCurrency: null }), idempotencyKey: randomUUID() })).rejects.toThrow();
  });

  it("Z/K/L: FindingVersion + events immutable (UPDATE/DELETE rejected)", async () => {
    const { exceptionId } = await newExc();
    const f = await createFinding("firmA", { exceptionId, engagementId: "engA", createdById: uPrep, content: baseContent(), idempotencyKey: randomUUID() });
    await expect(withTenantContext("firmA", (t) => t.$executeRaw(Prisma.sql`UPDATE "audit_finding_versions" SET "cause"='x' WHERE "id"=${f.versionId}`))).rejects.toThrow();
    await expect(withTenantContext("firmA", (t) => t.$executeRaw(Prisma.sql`DELETE FROM "audit_finding_versions" WHERE "id"=${f.versionId}`))).rejects.toThrow();
    const d = await recordResultDisposition("firmA", { auditResultId: rA[0]!.id, actorId: uPrep, action: "MARK_EXPLAINED", idempotencyKey: randomUUID() });
    await expect(withTenantContext("firmA", (t) => t.$executeRaw(Prisma.sql`DELETE FROM "audit_result_disposition_events" WHERE "id"=${d.eventId}`))).rejects.toThrow();
  });

  it("E/AE: RLS — firmB cannot see firmA exceptions; audit_app cannot UPDATE frozen audit_results", async () => {
    const { exceptionId } = await newExc();
    const seenByB = await withTenantContext("firmB", (t) => t.auditException.findMany({ where: { id: exceptionId } }));
    expect(seenByB.length).toBe(0); // RLS tenant isolation
    await expect(withTenantContext("firmA", (t) => t.$executeRaw(Prisma.sql`UPDATE "audit_results" SET "score"=1 WHERE "id"=${rA[0]!.id}`))).rejects.toThrow(); // G4 immutability preserved
  });

  it("AG: existing G2/G3/G4 composite FK preserved after G5 migration", async () => {
    const rows = await owner.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`SELECT count(*)::bigint AS n FROM pg_constraint WHERE conname='ares_run_tfkey'`);
    expect(Number(rows[0]!.n)).toBe(1);
  });
});

function baseContent(o: Record<string, unknown> = {}) {
  return { category: "FS_MISSTATEMENT", condition: "c", criteria: "cr", cause: "ca", effect: "e", auditorConclusion: "concl", ...o } as {
    category: string; condition: string; criteria: string; cause: string; effect: string; auditorConclusion: string;
    recommendation?: string | null; observedAmount?: string | null; observedCurrency?: string | null; estimatedExposureAmount?: string | null; estimatedExposureCurrency?: string | null;
  };
}
