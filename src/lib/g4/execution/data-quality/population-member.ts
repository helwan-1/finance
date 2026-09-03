import type { TenantTx } from "@/lib/db/tenant";
import type { ExecutionContext, TestPin } from "../context";
import type { TestExecutor, ExecPageResult, ResultDescriptor } from "../contracts";
import { fetchMemberPage, type Keyset } from "../population";
import { canonicalize } from "../canonical";
import { DQ_POPULATION_MEMBER_CODE } from "../tests/dq-population-member";

/**
 * C1 DQ_POPULATION_MEMBER, re-registered through the C2 registry with BYTE-
 * IDENTICAL frozen semantics: same resultKind/resultCode/severity/payload,
 * identity EOI = the member's g4eoi.1, one IMPORTED_RECORD evidence. Fingerprints
 * are unchanged, so C1 reproducibility (V1/V2) holds.
 */
export const populationMemberExecutor: TestExecutor = {
  testType: "DATA_QUALITY",
  kind: "POPULATION_MEMBER",
  grain: "IMPORTED_RECORD",
  supportedDatasetKinds: ["GENERAL_LEDGER", "TRIAL_BALANCE", "BANK", "OTHER"],
  validateFrozenConfig() { /* no external dependency; always executable */ },
  async executePage(tx: TenantTx, _ctx: ExecutionContext, pin: TestPin, cursor: unknown, batchSize: number): Promise<ExecPageResult> {
    const after = (cursor as Keyset | null) ?? null;
    const page = await fetchMemberPage(tx, _ctx.preparationId, pin.auditTestVersionId, after, batchSize);
    let last = after;
    const descriptors: ResultDescriptor[] = page.map((m) => {
      last = { datasetId: m.datasetId, sourceRowNo: m.sourceRowNo };
      return {
        resultKind: "DATA_QUALITY",
        resultCode: DQ_POPULATION_MEMBER_CODE,
        severity: "LOW",
        payload: canonicalize({ sourceRowNo: m.sourceRowNo, contentHash: m.contentHash }),
        identityEOIs: [m.eoiFrameHash],
        evidence: [{ evidenceType: "IMPORTED_RECORD", datasetId: m.datasetId, sourceRowNo: m.sourceRowNo, importedRecordId: m.importedRecordId, eoiFrameHash: m.eoiFrameHash, role: "subject" }],
        consumedMappingSemanticHashes: [],
      };
    });
    return { descriptors, cursor: last, reachedEnd: page.length < batchSize };
  },
};
