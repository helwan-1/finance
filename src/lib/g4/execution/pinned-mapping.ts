import type { TenantTx } from "@/lib/db/tenant";
import { UnpinnedDependencyError } from "./errors";

export interface PinnedMapping {
  accountMappingVersionId: string;
  mappingSemanticHash: string;
}

/**
 * Pinned-mapping resolver (ADR-G4-C1-05). Reads ONLY AuditRunAccountMappingPin
 * for the authoritative generation. There is NO fallback to
 * AccountMapping.currentVersion, "latest" mappings, or a live master lookup: a
 * dependency that was not pinned during preparation fails closed
 * (UNPINNED_DEPENDENCY). The C1 trivial test consumes no mapping, but the
 * boundary is established here for every later gate.
 */
export function makePinnedMappingResolver(tx: TenantTx, preparationId: string) {
  return {
    async resolve(datasetAccountId: string): Promise<PinnedMapping> {
      const pin = await tx.auditRunAccountMappingPin.findFirst({
        where: { preparationId, datasetAccountId },
        select: { accountMappingVersionId: true, mappingSemanticHash: true },
      });
      if (!pin) throw new UnpinnedDependencyError(datasetAccountId);
      return pin;
    },
  };
}

export type PinnedMappingResolver = ReturnType<typeof makePinnedMappingResolver>;
