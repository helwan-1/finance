import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isProduction } from "@/lib/security/env";

/**
 * Tenant-scoped database access (G1 — defense in depth).
 *
 * Every access to tenant-owned data must go through withTenantContext(). It
 * opens a transaction and, as its FIRST statement, binds the caller's audit
 * firm to the `app.audit_firm_id` GUC with is_local=true. PostgreSQL Row-Level
 * Security policies read that GUC via current_setting('app.audit_firm_id',
 * true), so:
 *
 *   * queries only ever see rows for the bound firm;
 *   * a missing context (unset GUC → NULL) matches no rows (fail-closed);
 *   * because the setting is transaction-local, it is reset at COMMIT/ROLLBACK
 *     and can never leak onto a pooled/reused physical connection.
 *
 * The audit firm id always originates from the verified session — never from a
 * client-supplied value.
 */
export type TenantTx = Prisma.TransactionClient;

/**
 * Production self-check: prove the connected DB role is actually subject to
 * RLS. RLS is ENABLEd (not FORCEd) so a superuser / BYPASSRLS / table-owner
 * connection would silently bypass it. Bind an impossible tenant and confirm a
 * tenant table returns zero rows; if not, the role is RLS-exempt and we refuse
 * to serve tenant data (fail-closed). Runs once, cached; production only.
 */
let rlsCheck: Promise<void> | null = null;
function ensureRlsEnforced(): Promise<void> {
  if (!isProduction()) return Promise.resolve();
  if (!rlsCheck) {
    rlsCheck = (async () => {
      const probe = `rls-probe-${randomUUID()}`;
      const rows = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.audit_firm_id', ${probe}, true)`;
        return tx.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM "audit_firms"`;
      });
      if (Number(rows[0]?.n ?? 0) > 0) {
        throw new Error(
          "Runtime DB role is RLS-exempt (owner/superuser/BYPASSRLS). " +
            "Refusing to serve tenant data — connect as the non-owner audit_app role.",
        );
      }
    })().catch((e) => {
      rlsCheck = null; // allow a later retry rather than caching the failure
      throw e;
    });
  }
  return rlsCheck;
}

export async function withTenantContext<T>(
  auditFirmId: string,
  fn: (tx: TenantTx) => Promise<T>,
): Promise<T> {
  if (!auditFirmId) {
    throw new Error("withTenantContext requires a non-empty auditFirmId");
  }
  await ensureRlsEnforced();
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.audit_firm_id', ${auditFirmId}, true)`;
    return fn(tx);
  });
}
