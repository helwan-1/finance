/** G5 professional-disposition domain errors (distinct from DB-enforced RAISEs). */
export class G5Error extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "G5Error";
  }
}

/** Same idempotency key replayed with a materially different payload. */
export class IdempotencyConflictError extends G5Error {
  constructor(message = "idempotency key reused with a different payload") {
    super("IDEMPOTENCY_CONFLICT", message);
    this.name = "IdempotencyConflictError";
  }
}

/** A precondition for a professional command was not met. */
export class PreconditionError extends G5Error {
  constructor(message: string) {
    super("PRECONDITION", message);
    this.name = "PreconditionError";
  }
}

/** True for a Postgres unique-violation surfaced through Prisma. */
export function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
}

/**
 * True for a UNIQUE-violation surfaced by Prisma, via either surface:
 *   - model ops → P2002,
 *   - raw INSERTs → P2010 wrapping PostgreSQL 23505 (constraint name is NOT
 *     surfaced by Prisma for $executeRaw — message is "N/A").
 * Because the raw path cannot tell us WHICH unique index collided, callers must
 * discriminate by outcome: attempt to resolve by the creation-idempotency key —
 * a matching row proves it was that collision (return/replay or conflict);
 * otherwise the original error is re-thrown. FK (23503), CHECK (23514) and RLS
 * are NOT unique violations and are excluded here, so they always propagate.
 */
export function isUniqueLike(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  const err = e as { code?: string; meta?: unknown; message?: string };
  if (err.code === "P2002") return true;
  const blob = JSON.stringify({ meta: err.meta, message: err.message ?? "" });
  return blob.includes("23505") || /unique constraint/i.test(blob);
}
