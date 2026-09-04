import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { TenantTx } from "@/lib/db/tenant";
import { withTenantContext } from "@/lib/db/tenant";
import { matterCorrelationKey, membershipFingerprint } from "./fingerprints";
import { IdempotencyConflictError, PreconditionError, isUniqueLike } from "./errors";

/** Recompute the derived membership fingerprint over the CURRENT active links. */
async function recomputeMembership(tx: TenantTx, firm: string, exceptionId: string): Promise<string> {
  const rows = await tx.$queryRaw<Array<{ fp: string }>>(Prisma.sql`
    SELECT ares."resultSemanticFingerprint" AS "fp"
    FROM "audit_exception_result_links" l
    JOIN "audit_results" ares ON ares."auditFirmId"=l."auditFirmId" AND ares."id"=l."auditResultId"
    WHERE l."auditFirmId"=${firm} AND l."exceptionId"=${exceptionId} AND l."active"=true
    ORDER BY ares."resultSemanticFingerprint" ASC`);
  return membershipFingerprint(rows.map((r) => r.fp));
}

async function resultSemantic(tx: TenantTx, firm: string, resultId: string): Promise<string> {
  const rows = await tx.$queryRaw<Array<{ fp: string }>>(Prisma.sql`
    SELECT ares."resultSemanticFingerprint" AS "fp"
    FROM "audit_results" ares JOIN "audit_runs" ar ON ar."id"=ares."runId"
    WHERE ares."id"=${resultId} AND ares."auditFirmId"=${firm}`);
  if (rows.length === 0) throw new PreconditionError(`audit result ${resultId} not found in firm`);
  return rows[0]!.fp;
}

async function lockException(tx: TenantTx, firm: string, exceptionId: string) {
  const rows = await tx.$queryRaw<Array<{ engagementId: string; latestEventSeq: number; currentStatus: string }>>(Prisma.sql`
    SELECT "engagementId","latestEventSeq","currentStatus" FROM "audit_exceptions"
    WHERE "auditFirmId"=${firm} AND "id"=${exceptionId} FOR UPDATE`);
  if (rows.length === 0) throw new PreconditionError(`exception ${exceptionId} not found`);
  return rows[0]!;
}

/** Check-first idempotency for an exception event (race-safe under the exception lock). */
async function existingExcEvent(tx: TenantTx, firm: string, exceptionId: string, actorId: string, eventType: string, key: string) {
  const rows = await tx.$queryRaw<Array<{ auditResultId: string | null; toStatus: string | null; note: string | null }>>(Prisma.sql`
    SELECT "auditResultId","toStatus","note" FROM "audit_exception_events"
    WHERE "auditFirmId"=${firm} AND "exceptionId"=${exceptionId} AND "actorId"=${actorId}
      AND "eventType"=${eventType}::"AuditExceptionEventType" AND "idempotencyKey"=${key}`);
  return rows[0] ?? null;
}

interface ExcEvent {
  exceptionId: string; engagementId: string; seq: number;
  eventType: "CREATE" | "STATUS" | "OWNER" | "NARRATIVE" | "LINK" | "UNLINK" | "MERGE" | "SPLIT" | "REOPEN";
  actorId: string; auditResultId?: string | null; toStatus?: string | null; toOwnerId?: string | null;
  title?: string | null; titleAr?: string | null; description?: string | null; targetExceptionId?: string | null; note?: string | null; idempotencyKey: string;
}
async function insertExceptionEvent(tx: TenantTx, firm: string, e: ExcEvent): Promise<void> {
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO "audit_exception_events"
      ("id","auditFirmId","exceptionId","engagementId","eventSeq","eventType","actorId","auditResultId","toStatus","toOwnerId","title","titleAr","description","targetExceptionId","note","idempotencyKey","createdAt")
    VALUES (${randomUUID()}, ${firm}, ${e.exceptionId}, ${e.engagementId}, ${e.seq}, ${e.eventType}::"AuditExceptionEventType", ${e.actorId},
            ${e.auditResultId ?? null}, ${e.toStatus ?? null}::"AuditExceptionStatus", ${e.toOwnerId ?? null}, ${e.title ?? null}, ${e.titleAr ?? null},
            ${e.description ?? null}, ${e.targetExceptionId ?? null}, ${e.note ?? null}, ${e.idempotencyKey}, now())`);
}

export interface CreateExceptionInput {
  engagementId: string; createdById: string; title: string; titleAr?: string | null;
  description?: string | null; priority?: "LOW" | "MEDIUM" | "HIGH"; firstResultId: string; idempotencyKey: string;
}

/**
 * Idempotent-replay resolver: returns the prior matter for this creation key
 * (comparing canonical payload), or throws IdempotencyConflictError on a
 * different payload. `mustExist` is true when called after a rollback (the
 * winning row is guaranteed committed); false for the check-first fast path.
 */
async function matchExistingException(tx: TenantTx, firm: string, i: CreateExceptionInput, mustExist: boolean): Promise<{ exceptionId: string } | null> {
  const dup = await tx.$queryRaw<Array<{ id: string; engagementId: string; createdById: string; currentTitle: string; currentTitleAr: string | null; currentDescription: string | null; priority: string }>>(Prisma.sql`
    SELECT "id","engagementId","createdById","currentTitle","currentTitleAr","currentDescription","priority" FROM "audit_exceptions"
    WHERE "auditFirmId"=${firm} AND "creationIdempotencyKey"=${i.idempotencyKey}`);
  if (dup.length === 0) { if (mustExist) throw new PreconditionError("idempotency resolve: exception not found after conflict"); return null; }
  const e = dup[0]!;
  const fl = await tx.$queryRaw<Array<{ auditResultId: string | null }>>(Prisma.sql`
    SELECT "auditResultId" FROM "audit_exception_events" WHERE "auditFirmId"=${firm} AND "exceptionId"=${e.id} AND "eventType"='LINK' ORDER BY "eventSeq" ASC LIMIT 1`);
  const same = e.engagementId === i.engagementId && e.createdById === i.createdById && e.currentTitle === i.title
    && (e.currentTitleAr ?? null) === (i.titleAr ?? null) && (e.currentDescription ?? null) === (i.description ?? null)
    && e.priority === (i.priority ?? "MEDIUM") && (fl[0]?.auditResultId ?? null) === i.firstResultId;
  if (!same) throw new IdempotencyConflictError();
  return { exceptionId: e.id };
}

/**
 * TX1 — atomic create Exception + first Result link. Idempotent by
 * creationIdempotencyKey both sequentially (check-first) AND under concurrency:
 * the request that loses the creation-key UNIQUE rolls back completely, then
 * resolves the winner in a FRESH transaction (no query on an aborted tx).
 */
export async function createExceptionFromResult(auditFirmId: string, i: CreateExceptionInput): Promise<{ exceptionId: string }> {
  try {
    return await withTenantContext(auditFirmId, (tx) => doCreateException(tx, auditFirmId, i));
  } catch (e) {
    if (isUniqueLike(e)) {
      // Resolve in a FRESH transaction (the aborted one cannot be queried). A row
      // for this creation key proves it was the creation-key collision → replay
      // (same payload) or IdempotencyConflictError (different payload). No row →
      // the unique violation was unrelated → re-throw the original error.
      const m = await withTenantContext(auditFirmId, (tx) => matchExistingException(tx, auditFirmId, i, false));
      if (m) return m;
    }
    throw e;
  }
}

async function doCreateException(tx: TenantTx, auditFirmId: string, i: CreateExceptionInput): Promise<{ exceptionId: string }> {
  const fast = await matchExistingException(tx, auditFirmId, i, false);
  if (fast) return fast;
  {
    const semantic = await resultSemantic(tx, auditFirmId, i.firstResultId);
    const corr = matterCorrelationKey({ engagementId: i.engagementId, resultSemanticFingerprint: semantic });
    const exId = randomUUID();
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "audit_exceptions"
        ("id","auditFirmId","engagementId","matterCorrelationKey","currentStatus","currentOwnerId","currentTitle","currentTitleAr","currentDescription","priority","membershipFingerprint","latestEventSeq","version","createdById","creationIdempotencyKey","createdAt","updatedAt")
      VALUES (${exId}, ${auditFirmId}, ${i.engagementId}, ${corr}, 'UNDER_INVESTIGATION', ${i.createdById}, ${i.title}, ${i.titleAr ?? null}, ${i.description ?? null},
              ${(i.priority ?? "MEDIUM")}::"AuditMatterPriority", NULL, 0, 0, ${i.createdById}, ${i.idempotencyKey}, now(), now())`);
    await insertExceptionEvent(tx, auditFirmId, { exceptionId: exId, engagementId: i.engagementId, seq: 1, eventType: "CREATE", actorId: i.createdById, title: i.title, titleAr: i.titleAr ?? null, description: i.description ?? null, idempotencyKey: `${i.idempotencyKey}:create` });
    await insertExceptionEvent(tx, auditFirmId, { exceptionId: exId, engagementId: i.engagementId, seq: 2, eventType: "LINK", actorId: i.createdById, auditResultId: i.firstResultId, idempotencyKey: `${i.idempotencyKey}:link` });
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "audit_exception_result_links" ("id","auditFirmId","exceptionId","engagementId","auditResultId","active","lastEventSeq","createdAt","updatedAt")
      VALUES (${randomUUID()}, ${auditFirmId}, ${exId}, ${i.engagementId}, ${i.firstResultId}, true, 2, now(), now())`);
    const fp = await recomputeMembership(tx, auditFirmId, exId);
    await tx.$executeRaw(Prisma.sql`
      UPDATE "audit_exceptions" SET "latestEventSeq"=2, "membershipFingerprint"=${fp}, "version"="version"+1, "updatedAt"=now()
      WHERE "auditFirmId"=${auditFirmId} AND "id"=${exId}`);
    return { exceptionId: exId };
  }
}

export interface LinkInput { exceptionId: string; actorId: string; auditResultId: string; idempotencyKey: string }

async function linkOp(auditFirmId: string, i: LinkInput, eventType: "LINK" | "UNLINK", active: boolean): Promise<void> {
  await withTenantContext(auditFirmId, async (tx) => {
    const ex = await lockException(tx, auditFirmId, i.exceptionId);
    const prior = await existingExcEvent(tx, auditFirmId, i.exceptionId, i.actorId, eventType, i.idempotencyKey);
    if (prior) { if ((prior.auditResultId ?? null) !== i.auditResultId) throw new IdempotencyConflictError(); return; }
    const seq = ex.latestEventSeq + 1;
    await insertExceptionEvent(tx, auditFirmId, { exceptionId: i.exceptionId, engagementId: ex.engagementId, seq, eventType, actorId: i.actorId, auditResultId: i.auditResultId, idempotencyKey: i.idempotencyKey });
    if (eventType === "LINK") {
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "audit_exception_result_links" ("id","auditFirmId","exceptionId","engagementId","auditResultId","active","lastEventSeq","createdAt","updatedAt")
        VALUES (${randomUUID()}, ${auditFirmId}, ${i.exceptionId}, ${ex.engagementId}, ${i.auditResultId}, true, ${seq}, now(), now())
        ON CONFLICT ("auditFirmId","exceptionId","auditResultId") DO UPDATE SET "active"=true, "lastEventSeq"=${seq}, "updatedAt"=now()`);
    } else {
      await tx.$executeRaw(Prisma.sql`
        UPDATE "audit_exception_result_links" SET "active"=false, "lastEventSeq"=${seq}, "updatedAt"=now()
        WHERE "auditFirmId"=${auditFirmId} AND "exceptionId"=${i.exceptionId} AND "auditResultId"=${i.auditResultId}`);
    }
    void active;
    const fp = await recomputeMembership(tx, auditFirmId, i.exceptionId);
    await tx.$executeRaw(Prisma.sql`UPDATE "audit_exceptions" SET "latestEventSeq"=${seq}, "membershipFingerprint"=${fp}, "version"="version"+1, "updatedAt"=now() WHERE "auditFirmId"=${auditFirmId} AND "id"=${i.exceptionId}`);
  });
}
export const linkResultToException = (firm: string, i: LinkInput) => linkOp(firm, i, "LINK", true);
export const unlinkResultFromException = (firm: string, i: LinkInput) => linkOp(firm, i, "UNLINK", false);

async function transition(auditFirmId: string, exceptionId: string, actorId: string, toStatus: string, note: string | null, idempotencyKey: string, eventType: "STATUS" | "REOPEN"): Promise<void> {
  await withTenantContext(auditFirmId, async (tx) => {
    const ex = await lockException(tx, auditFirmId, exceptionId);
    const prior = await existingExcEvent(tx, auditFirmId, exceptionId, actorId, eventType, idempotencyKey);
    if (prior) { if ((prior.toStatus ?? null) !== toStatus || (prior.note ?? null) !== (note ?? null)) throw new IdempotencyConflictError(); return; }
    const seq = ex.latestEventSeq + 1;
    await insertExceptionEvent(tx, auditFirmId, { exceptionId, engagementId: ex.engagementId, seq, eventType, actorId, toStatus, note, idempotencyKey });
    await tx.$executeRaw(Prisma.sql`UPDATE "audit_exceptions" SET "currentStatus"=${toStatus}::"AuditExceptionStatus", "latestEventSeq"=${seq}, "version"="version"+1, "updatedAt"=now() WHERE "auditFirmId"=${auditFirmId} AND "id"=${exceptionId}`);
  });
}

export function dismissException(auditFirmId: string, i: { exceptionId: string; actorId: string; rationale: string; idempotencyKey: string }): Promise<void> {
  if (!i.rationale || i.rationale.trim().length === 0) throw new PreconditionError("dismissal requires a rationale");
  return transition(auditFirmId, i.exceptionId, i.actorId, "CLOSED_NO_FINDING", i.rationale, i.idempotencyKey, "STATUS");
}

export function concludeException(auditFirmId: string, i: { exceptionId: string; actorId: string; idempotencyKey: string }): Promise<void> {
  return withTenantContext(auditFirmId, async (tx) => {
    const ex = await lockException(tx, auditFirmId, i.exceptionId);
    const prior = await existingExcEvent(tx, auditFirmId, i.exceptionId, i.actorId, "STATUS", i.idempotencyKey);
    if (prior) { if ((prior.toStatus ?? null) !== "CONCLUDED_WITH_FINDING") throw new IdempotencyConflictError(); return; }
    const cnt = await tx.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`SELECT count(*)::bigint AS n FROM "audit_findings" WHERE "auditFirmId"=${auditFirmId} AND "exceptionId"=${i.exceptionId} AND "currentStatus"='CONCLUDED'`);
    if (Number(cnt[0]!.n) === 0) throw new PreconditionError("conclude requires at least one CONCLUDED finding");
    const seq = ex.latestEventSeq + 1;
    await insertExceptionEvent(tx, auditFirmId, { exceptionId: i.exceptionId, engagementId: ex.engagementId, seq, eventType: "STATUS", actorId: i.actorId, toStatus: "CONCLUDED_WITH_FINDING", idempotencyKey: i.idempotencyKey });
    await tx.$executeRaw(Prisma.sql`UPDATE "audit_exceptions" SET "currentStatus"='CONCLUDED_WITH_FINDING', "latestEventSeq"=${seq}, "version"="version"+1, "updatedAt"=now() WHERE "auditFirmId"=${auditFirmId} AND "id"=${i.exceptionId}`);
  });
}

export function reopenException(auditFirmId: string, i: { exceptionId: string; actorId: string; reason: string; idempotencyKey: string }): Promise<void> {
  return transition(auditFirmId, i.exceptionId, i.actorId, "UNDER_INVESTIGATION", i.reason, i.idempotencyKey, "REOPEN");
}
