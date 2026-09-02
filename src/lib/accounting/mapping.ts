import type { TenantTx } from "@/lib/db/tenant";

/**
 * G3 account mapping (VERSIONED AUDIT INTERPRETATION — ADR-G3-04 / C5).
 *
 * Maps an immutable source-fact DatasetAccount to a client Account master.
 * Invariants: exactly one AccountMapping per DatasetAccount; exactly one current
 * version; monotonically increasing version; history immutable; supersession is
 * atomic (new version + prior `supersededAt` + pointer flip in one call). This
 * is an auditor action, NOT an import side effect, and never rewrites the
 * source snapshot (JournalLine → DatasetAccount stays fixed; no `accountId`
 * lives on the immutable line).
 */
export interface MapParams {
  auditFirmId: string;
  datasetAccountId: string;
  accountId: string;
  basis: "EXACT_CODE_IN_SCOPE" | "AUDITOR_ASSERTED" | "IMPORT_CONFIRMED";
  mappedById?: string | null;
}

export interface MapResult {
  accountMappingId: string;
  currentVersionId: string;
  version: number;
}

export async function mapDatasetAccount(tx: TenantTx, p: MapParams): Promise<MapResult> {
  let mapping = await tx.accountMapping.findUnique({
    where: { auditFirmId_datasetAccountId: { auditFirmId: p.auditFirmId, datasetAccountId: p.datasetAccountId } },
    select: { id: true },
  });
  if (!mapping) {
    mapping = await tx.accountMapping.create({
      data: { auditFirmId: p.auditFirmId, datasetAccountId: p.datasetAccountId },
      select: { id: true },
    });
  }

  const last = await tx.accountMappingVersion.findFirst({
    where: { accountMappingId: mapping.id }, orderBy: { version: "desc" },
    select: { id: true, version: true },
  });
  const nextVersion = (last?.version ?? 0) + 1;

  // Atomic supersession: stamp the prior current version, then append the new
  // one, then flip the pointer — all inside the caller's transaction.
  if (last) {
    await tx.accountMappingVersion.update({ where: { id: last.id }, data: { supersededAt: new Date() } });
  }
  const version = await tx.accountMappingVersion.create({
    data: {
      auditFirmId: p.auditFirmId, accountMappingId: mapping.id, version: nextVersion,
      accountId: p.accountId, basis: p.basis, mappedById: p.mappedById ?? null,
    },
    select: { id: true },
  });
  await tx.accountMapping.update({ where: { id: mapping.id }, data: { currentVersionId: version.id } });

  return { accountMappingId: mapping.id, currentVersionId: version.id, version: nextVersion };
}
