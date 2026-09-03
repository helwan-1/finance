import { prisma } from "@/lib/prisma";
import type { TenantTx } from "@/lib/db/tenant";

/**
 * Bounded execution-unit transaction (ADR-G4-C1-12). Every lock-holding
 * execution transaction runs here so its lock-hold is bounded on THREE layers
 * (design §3/§8):
 *   1. short bounded units (the caller pages a small batch);
 *   2. DB-side: SET LOCAL statement_timeout + idle_in_transaction_session_timeout
 *      — either aborts a runaway/stalled unit and releases its locks;
 *   3. client-side: an explicit Prisma interactive-transaction timeout, set just
 *      ABOVE the DB bound so the DB aborts first with a precise error.
 * The tenant GUC is bound as the first statement (G1 RLS), exactly as
 * withTenantContext does. MAX_UNIT_TX_TIME = min(these) < LEASE_TTL (design §4).
 */
export const STATEMENT_TIMEOUT_MS = 8000;
export const IDLE_IN_TX_TIMEOUT_MS = 8000;
export const UNIT_TX_TIMEOUT_MS = 10000; // Prisma client-side, above the DB bounds
export const UNIT_TX_MAXWAIT_MS = 2000;
/** Upper bound on how long a unit can hold a lock. Must stay < LEASE_TTL_MS. */
export const MAX_UNIT_TX_TIME_MS = Math.min(STATEMENT_TIMEOUT_MS, IDLE_IN_TX_TIMEOUT_MS, UNIT_TX_TIMEOUT_MS);

export async function withExecutionUnit<T>(auditFirmId: string, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
  if (!auditFirmId) throw new Error("withExecutionUnit requires a non-empty auditFirmId");
  return prisma.$transaction(
    async (tx) => {
      // Tenant context first (RLS), then bound the lock-hold on the DB side.
      await tx.$executeRaw`SELECT set_config('app.audit_firm_id', ${auditFirmId}, true)`;
      // SET LOCAL cannot be parameterized; the value is a trusted internal constant.
      await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`);
      await tx.$executeRawUnsafe(`SET LOCAL idle_in_transaction_session_timeout = ${IDLE_IN_TX_TIMEOUT_MS}`);
      return fn(tx);
    },
    { timeout: UNIT_TX_TIMEOUT_MS, maxWait: UNIT_TX_MAXWAIT_MS },
  );
}
