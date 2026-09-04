import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { withTenantContext } from "@/lib/db/tenant";
import { IdempotencyConflictError } from "./errors";

/**
 * Result-level disposition (append-only authoritative event + derived state).
 * The per-result AuditResultDispositionState row is the concurrency anchor and
 * the derived-state cache — NOT the frozen AuditResult, which is never locked or
 * mutated. eventSeq is allocated under the state row's FOR UPDATE.
 */
export type DispositionAction =
  | "MARK_UNDER_REVIEW" | "MARK_NOT_RELEVANT" | "MARK_FALSE_POSITIVE"
  | "MARK_EXPLAINED" | "REQUIRE_INVESTIGATION" | "LINK_TO_EXCEPTION" | "UNLINK_FROM_EXCEPTION";

const STATE_OF: Record<DispositionAction, string> = {
  MARK_UNDER_REVIEW: "UNDER_REVIEW",
  MARK_NOT_RELEVANT: "DISPOSED",
  MARK_FALSE_POSITIVE: "DISPOSED",
  MARK_EXPLAINED: "DISPOSED",
  REQUIRE_INVESTIGATION: "INVESTIGATING",
  LINK_TO_EXCEPTION: "LINKED",
  UNLINK_FROM_EXCEPTION: "INVESTIGATING",
};

export interface DispositionInput {
  auditResultId: string;
  actorId: string;
  action: DispositionAction;
  note?: string | null;
  exceptionId?: string | null;
  idempotencyKey: string;
}

export interface DispositionResult { eventId: string; eventSeq: number; currentState: string }

export function recordResultDisposition(auditFirmId: string, input: DispositionInput): Promise<DispositionResult> {
  return withTenantContext(auditFirmId, async (tx) => {
    // Lazy-create the anchor/projection, then lock it to allocate the sequence.
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "audit_result_disposition_states" ("id","auditFirmId","auditResultId","currentState","latestEventSeq","version","createdAt","updatedAt")
      VALUES (${randomUUID()}, ${auditFirmId}, ${input.auditResultId}, 'UNREVIEWED', 0, 0, now(), now())
      ON CONFLICT ("auditFirmId","auditResultId") DO NOTHING`);
    const locked = await tx.$queryRaw<Array<{ latestEventSeq: number }>>(Prisma.sql`
      SELECT "latestEventSeq" FROM "audit_result_disposition_states"
      WHERE "auditFirmId"=${auditFirmId} AND "auditResultId"=${input.auditResultId} FOR UPDATE`);
    // Idempotency: check-first UNDER the state-row lock (race-safe — a concurrent
    // same-key writer either committed before we acquired the lock, or waits for it).
    const dup = await tx.$queryRaw<Array<{ id: string; eventSeq: number; note: string | null; exceptionId: string | null }>>(Prisma.sql`
      SELECT "id","eventSeq","note","exceptionId" FROM "audit_result_disposition_events"
      WHERE "auditFirmId"=${auditFirmId} AND "auditResultId"=${input.auditResultId} AND "actorId"=${input.actorId}
        AND "action"=${input.action}::"AuditDispositionAction" AND "idempotencyKey"=${input.idempotencyKey}`);
    if (dup.length > 0) {
      const e = dup[0]!;
      if ((e.note ?? null) !== (input.note ?? null) || (e.exceptionId ?? null) !== (input.exceptionId ?? null)) throw new IdempotencyConflictError();
      const cur = await tx.$queryRaw<Array<{ currentState: string }>>(Prisma.sql`
        SELECT "currentState" FROM "audit_result_disposition_states" WHERE "auditFirmId"=${auditFirmId} AND "auditResultId"=${input.auditResultId}`);
      return { eventId: e.id, eventSeq: e.eventSeq, currentState: cur[0]!.currentState };
    }
    const seq = locked[0]!.latestEventSeq + 1;
    const state = STATE_OF[input.action];
    const id = randomUUID();
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "audit_result_disposition_events"
        ("id","auditFirmId","auditResultId","eventSeq","action","actorId","exceptionId","note","idempotencyKey","createdAt")
      VALUES (${id}, ${auditFirmId}, ${input.auditResultId}, ${seq}, ${input.action}::"AuditDispositionAction",
              ${input.actorId}, ${input.exceptionId ?? null}, ${input.note ?? null}, ${input.idempotencyKey}, now())`);
    await tx.$executeRaw(Prisma.sql`
      UPDATE "audit_result_disposition_states"
      SET "currentState"=${state}::"AuditResultDispositionKind", "latestEventSeq"=${seq}, "version"="version"+1, "updatedAt"=now()
      WHERE "auditFirmId"=${auditFirmId} AND "auditResultId"=${input.auditResultId}`);
    return { eventId: id, eventSeq: seq, currentState: state };
  });
}
