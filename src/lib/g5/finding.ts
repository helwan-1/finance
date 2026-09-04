import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { TenantTx } from "@/lib/db/tenant";
import { withTenantContext } from "@/lib/db/tenant";
import { findingContentHash, type FindingContent } from "./fingerprints";
import { IdempotencyConflictError, PreconditionError, isUniqueLike } from "./errors";

export interface FindingContentInput {
  category: string; condition: string; criteria: string; cause: string; effect: string; auditorConclusion: string;
  recommendation?: string | null; observedAmount?: string | null; observedCurrency?: string | null;
  estimatedExposureAmount?: string | null; estimatedExposureCurrency?: string | null;
}

function content(i: FindingContentInput): FindingContent {
  return {
    category: i.category, condition: i.condition, criteria: i.criteria, cause: i.cause, effect: i.effect,
    auditorConclusion: i.auditorConclusion, recommendation: i.recommendation ?? null,
    observedAmount: i.observedAmount ?? null, observedCurrency: i.observedCurrency ?? null,
    estimatedExposureAmount: i.estimatedExposureAmount ?? null, estimatedExposureCurrency: i.estimatedExposureCurrency ?? null,
  };
}

async function insertVersion(tx: TenantTx, firm: string, findingId: string, versionNo: number, preparedById: string, c: FindingContent, idempotencyKey: string): Promise<{ id: string; hash: string }> {
  const id = randomUUID();
  const hash = findingContentHash(c);
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO "audit_finding_versions"
      ("id","auditFirmId","findingId","versionNo","category","condition","criteria","cause","effect","auditorConclusion","recommendation",
       "observedAmount","observedCurrency","estimatedExposureAmount","estimatedExposureCurrency","preparedById","preparedAt","contentHash","idempotencyKey","createdAt")
    VALUES (${id}, ${firm}, ${findingId}, ${versionNo}, ${c.category}, ${c.condition}, ${c.criteria}, ${c.cause}, ${c.effect}, ${c.auditorConclusion}, ${c.recommendation},
            ${c.observedAmount}::decimal, ${c.observedCurrency}, ${c.estimatedExposureAmount}::decimal, ${c.estimatedExposureCurrency}, ${preparedById}, now(), ${hash}, ${idempotencyKey}, now())`);
  return { id, hash };
}

async function lockFinding(tx: TenantTx, firm: string, findingId: string) {
  const rows = await tx.$queryRaw<Array<{ engagementId: string; currentStatus: string; currentVersionId: string | null; latestReviewSeq: number }>>(Prisma.sql`
    SELECT "engagementId","currentStatus","currentVersionId","latestReviewSeq" FROM "audit_findings"
    WHERE "auditFirmId"=${firm} AND "id"=${findingId} FOR UPDATE`);
  if (rows.length === 0) throw new PreconditionError(`finding ${findingId} not found`);
  return rows[0]!;
}

export interface CreateFindingInput {
  exceptionId: string; engagementId: string; createdById: string; content: FindingContentInput; idempotencyKey: string;
}

/** Idempotent-replay resolver for createFinding (compares v1 contentHash + creation fields). */
async function matchExistingFinding(tx: TenantTx, firm: string, i: CreateFindingInput, mustExist: boolean): Promise<{ findingId: string; versionId: string } | null> {
  const newHash = findingContentHash(content(i.content));
  const dup = await tx.$queryRaw<Array<{ id: string; exceptionId: string; engagementId: string; createdById: string; currentVersionId: string | null }>>(Prisma.sql`
    SELECT "id","exceptionId","engagementId","createdById","currentVersionId" FROM "audit_findings"
    WHERE "auditFirmId"=${firm} AND "creationIdempotencyKey"=${i.idempotencyKey}`);
  if (dup.length === 0) { if (mustExist) throw new PreconditionError("idempotency resolve: finding not found after conflict"); return null; }
  const f = dup[0]!;
  const v = await tx.$queryRaw<Array<{ id: string; contentHash: string }>>(Prisma.sql`SELECT "id","contentHash" FROM "audit_finding_versions" WHERE "auditFirmId"=${firm} AND "id"=${f.currentVersionId}`);
  if (f.exceptionId !== i.exceptionId || f.engagementId !== i.engagementId || f.createdById !== i.createdById || (v[0]?.contentHash ?? "") !== newHash) throw new IdempotencyConflictError();
  return { findingId: f.id, versionId: f.currentVersionId! };
}

/**
 * Create a Finding (v1) under an Exception with ≥1 active link. Idempotent by
 * creationIdempotencyKey sequentially AND under concurrency (the loser of the
 * creation-key UNIQUE rolls back, then resolves the winner in a fresh tx).
 */
export async function createFinding(auditFirmId: string, i: CreateFindingInput): Promise<{ findingId: string; versionId: string }> {
  try {
    return await withTenantContext(auditFirmId, (tx) => doCreateFinding(tx, auditFirmId, i));
  } catch (e) {
    if (isUniqueLike(e)) {
      const m = await withTenantContext(auditFirmId, (tx) => matchExistingFinding(tx, auditFirmId, i, false));
      if (m) return m;
    }
    throw e;
  }
}

async function doCreateFinding(tx: TenantTx, auditFirmId: string, i: CreateFindingInput): Promise<{ findingId: string; versionId: string }> {
  const fast = await matchExistingFinding(tx, auditFirmId, i, false);
  if (fast) return fast;
  const active = await tx.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`
    SELECT count(*)::bigint AS n FROM "audit_exception_result_links" WHERE "auditFirmId"=${auditFirmId} AND "exceptionId"=${i.exceptionId} AND "active"=true`);
  if (Number(active[0]!.n) === 0) throw new PreconditionError("finding requires an exception with at least one active result link");
  const findingId = randomUUID();
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO "audit_findings" ("id","auditFirmId","engagementId","exceptionId","currentStatus","currentVersionId","latestReviewSeq","version","createdById","creationIdempotencyKey","createdAt","updatedAt")
    VALUES (${findingId}, ${auditFirmId}, ${i.engagementId}, ${i.exceptionId}, 'DRAFT', NULL, 0, 0, ${i.createdById}, ${i.idempotencyKey}, now(), now())`);
  const v = await insertVersion(tx, auditFirmId, findingId, 1, i.createdById, content(i.content), `${i.idempotencyKey}:v1`);
  await tx.$executeRaw(Prisma.sql`UPDATE "audit_findings" SET "currentVersionId"=${v.id}, "version"="version"+1, "updatedAt"=now() WHERE "auditFirmId"=${auditFirmId} AND "id"=${findingId}`);
  return { findingId, versionId: v.id };
}

export function reviseFinding(auditFirmId: string, i: { findingId: string; preparedById: string; content: FindingContentInput; idempotencyKey: string }): Promise<{ versionId: string; versionNo: number }> {
  return withTenantContext(auditFirmId, async (tx) => {
    const f = await lockFinding(tx, auditFirmId, i.findingId);
    const newHash = findingContentHash(content(i.content));
    const dup = await tx.$queryRaw<Array<{ id: string; versionNo: number; contentHash: string }>>(Prisma.sql`
      SELECT "id","versionNo","contentHash" FROM "audit_finding_versions" WHERE "auditFirmId"=${auditFirmId} AND "findingId"=${i.findingId} AND "idempotencyKey"=${i.idempotencyKey}`);
    if (dup.length > 0) { if (dup[0]!.contentHash !== newHash) throw new IdempotencyConflictError(); return { versionId: dup[0]!.id, versionNo: dup[0]!.versionNo }; }
    if (f.currentStatus !== "DRAFT") throw new PreconditionError(`cannot revise a finding in status ${f.currentStatus}`);
    const mx = await tx.$queryRaw<Array<{ v: number | null }>>(Prisma.sql`SELECT max("versionNo") AS v FROM "audit_finding_versions" WHERE "auditFirmId"=${auditFirmId} AND "findingId"=${i.findingId}`);
    const versionNo = (mx[0]!.v ?? 0) + 1;
    const v = await insertVersion(tx, auditFirmId, i.findingId, versionNo, i.preparedById, content(i.content), i.idempotencyKey);
    await tx.$executeRaw(Prisma.sql`UPDATE "audit_findings" SET "currentVersionId"=${v.id}, "currentStatus"='DRAFT', "version"="version"+1, "updatedAt"=now() WHERE "auditFirmId"=${auditFirmId} AND "id"=${i.findingId}`);
    return { versionId: v.id, versionNo };
  });
}

async function existingReview(tx: TenantTx, firm: string, findingId: string, actorId: string, action: string, key: string) {
  const rows = await tx.$queryRaw<Array<{ findingVersionId: string; note: string | null }>>(Prisma.sql`
    SELECT "findingVersionId","note" FROM "audit_finding_review_events"
    WHERE "auditFirmId"=${firm} AND "findingId"=${findingId} AND "actorId"=${actorId} AND "action"=${action}::"AuditFindingReviewAction" AND "idempotencyKey"=${key}`);
  return rows[0] ?? null;
}
async function appendReview(tx: TenantTx, firm: string, findingId: string, findingVersionId: string, seq: number, action: string, actorId: string, note: string | null, idempotencyKey: string): Promise<void> {
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO "audit_finding_review_events" ("id","auditFirmId","findingId","findingVersionId","eventSeq","action","actorId","note","idempotencyKey","createdAt")
    VALUES (${randomUUID()}, ${firm}, ${findingId}, ${findingVersionId}, ${seq}, ${action}::"AuditFindingReviewAction", ${actorId}, ${note ?? null}, ${idempotencyKey}, now())`);
}

export function submitFinding(auditFirmId: string, i: { findingId: string; actorId: string; idempotencyKey: string }): Promise<void> {
  return withTenantContext(auditFirmId, async (tx) => {
    const f = await lockFinding(tx, auditFirmId, i.findingId);
    const prior = await existingReview(tx, auditFirmId, i.findingId, i.actorId, "SUBMIT", i.idempotencyKey);
    if (prior) return;
    if (f.currentStatus !== "DRAFT") throw new PreconditionError(`only a DRAFT finding may be submitted (is ${f.currentStatus})`);
    if (!f.currentVersionId) throw new PreconditionError("finding has no version to submit");
    const seq = f.latestReviewSeq + 1;
    await appendReview(tx, auditFirmId, i.findingId, f.currentVersionId, seq, "SUBMIT", i.actorId, null, i.idempotencyKey);
    await tx.$executeRaw(Prisma.sql`UPDATE "audit_findings" SET "currentStatus"='IN_REVIEW', "latestReviewSeq"=${seq}, "version"="version"+1, "updatedAt"=now() WHERE "auditFirmId"=${auditFirmId} AND "id"=${i.findingId}`);
  });
}

/** Review the CURRENT submitted version. APPROVE→CONCLUDED, RETURN→DRAFT. reviewer≠preparer is DB-enforced. */
export function reviewFinding(auditFirmId: string, i: { findingId: string; actorId: string; action: "APPROVE" | "RETURN"; findingVersionId: string; note?: string | null; idempotencyKey: string }): Promise<void> {
  return withTenantContext(auditFirmId, async (tx) => {
    const f = await lockFinding(tx, auditFirmId, i.findingId);
    const prior = await existingReview(tx, auditFirmId, i.findingId, i.actorId, i.action, i.idempotencyKey);
    if (prior) { if (prior.findingVersionId !== i.findingVersionId) throw new IdempotencyConflictError(); return; }
    if (f.currentStatus !== "IN_REVIEW") throw new PreconditionError(`finding is not in review (status ${f.currentStatus})`);
    if (f.currentVersionId !== i.findingVersionId) throw new PreconditionError("review must target the current submitted version");
    const seq = f.latestReviewSeq + 1;
    await appendReview(tx, auditFirmId, i.findingId, i.findingVersionId, seq, i.action, i.actorId, i.note ?? null, i.idempotencyKey);
    const status = i.action === "APPROVE" ? "CONCLUDED" : "DRAFT";
    await tx.$executeRaw(Prisma.sql`UPDATE "audit_findings" SET "currentStatus"=${status}::"AuditFindingStatus", "latestReviewSeq"=${seq}, "version"="version"+1, "updatedAt"=now() WHERE "auditFirmId"=${auditFirmId} AND "id"=${i.findingId}`);
  });
}
