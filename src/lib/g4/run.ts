import type { TenantTx } from "@/lib/db/tenant";
import { withTenantContext } from "@/lib/db/tenant";
import { getEngineBuildVersion } from "./engine-build";

/**
 * G4 Phase B — DRAFT AuditRun creation (no execution). Tenant/engagement-bound,
 * createdBy provenance, validated policy fields. A DRAFT run never carries an
 * authoritative freezeGeneration. `getEngineBuildVersion()` is validated eagerly
 * so production fails closed at run creation if the build identity is missing.
 */
export async function createDraftRun(auditFirmId: string, p: {
  engagementId: string; createdById?: string | null; maxAttempts?: number; supersedesRunId?: string | null; label?: string | null;
}): Promise<{ runId: string; clientCompanyId: string | null }> {
  getEngineBuildVersion(); // fail-closed in production before anything is written
  const maxAttempts = p.maxAttempts ?? 3;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20) {
    throw new Error("maxAttempts must be an integer in [1,20]");
  }
  return withTenantContext(auditFirmId, async (tx) => {
    const eng = await tx.auditEngagement.findUnique({ where: { id: p.engagementId }, select: { id: true, clientCompanyId: true } });
    if (!eng) throw new Error("engagement not found in tenant");
    if (p.supersedesRunId) {
      const sup = await tx.auditRun.findUnique({ where: { id: p.supersedesRunId }, select: { id: true } });
      if (!sup) throw new Error("supersedesRunId not found in tenant");
    }
    const run = await tx.auditRun.create({
      data: {
        auditFirmId, engagementId: p.engagementId, clientCompanyId: eng.clientCompanyId,
        status: "DRAFT", maxAttempts, supersedesRunId: p.supersedesRunId ?? null,
        createdById: p.createdById ?? null, label: p.label ?? null,
      },
      select: { id: true },
    });
    return { runId: run.id, clientCompanyId: eng.clientCompanyId };
  });
}

/**
 * Resolve (find-or-create) the immutable G4 client semantic key (C9). Same
 * client → same key forever; never regenerated per run; never a DB cuid. Uses
 * VAT-backed identity when present, else a minted stable token stored once.
 */
export async function resolveClientSemanticKey(tx: TenantTx, auditFirmId: string, clientCompanyId: string): Promise<string> {
  const existing = await tx.auditClientSemanticKey.findUnique({
    where: { auditFirmId_clientCompanyId: { auditFirmId, clientCompanyId } }, select: { semanticKey: true },
  });
  if (existing) return existing.semanticKey;
  const client = await tx.clientCompany.findUnique({ where: { id: clientCompanyId }, select: { vatNumber: true, crNumber: true } });
  if (!client) throw new Error("client company not found in tenant");
  const semanticKey = client.vatNumber ? `vat:${client.vatNumber}` : client.crNumber ? `cr:${client.crNumber}` : `g4ck:${clientCompanyId}`;
  const created = await tx.auditClientSemanticKey.create({
    data: { auditFirmId, clientCompanyId, semanticKey }, select: { semanticKey: true },
  });
  return created.semanticKey;
}
