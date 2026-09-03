import type { TenantTx } from "@/lib/db/tenant";
import type { ExecutionContext, TestPin } from "../context";
import type { TestExecutor, ExecPageResult, ResultDescriptor, EvidenceRef } from "../contracts";
import { fetchTBDuplicateGroups, fetchTBGroupRows } from "../population";
import { canonicalize } from "../canonical";
import { datasetAccountSemanticId } from "@/lib/g4/semantic-identity";

/** Fixed evidence cap per duplicate group — bounded regardless of group size. */
export const TB_DUP_EVIDENCE_K = 3;

/**
 * AI_TB_ACCOUNT_DUPLICATION (C2). One result per duplicate account group within a
 * TrialBalance (grouped by (trialBalanceId, accountSnapshotId) — same source code
 * under different datasets/contexts is a distinct DatasetAccount, never cross-
 * grouped). Group identity = g4da.1; occurrenceCount is the FULL group count;
 * evidence is bounded to the first K=3 rows by sourceRowNo. Memory O(batch).
 */
function tbDatasetIds(ctx: ExecutionContext): string[] {
  return ctx.datasetPins.filter((d) => d.datasetKind === "TRIAL_BALANCE").map((d) => d.datasetId);
}

export const tbAccountDuplicationExecutor: TestExecutor = {
  testType: "ACCOUNTING_INTEGRITY",
  kind: "TB_ACCOUNT_DUPLICATION",
  grain: "TB_ACCOUNT",
  supportedDatasetKinds: ["TRIAL_BALANCE"],
  validateFrozenConfig() { /* immutable trial_balance_rows; no external dependency */ },
  async executePage(tx: TenantTx, ctx: ExecutionContext, pin: TestPin, cursor: unknown, batchSize: number): Promise<ExecPageResult> {
    const dsIds = tbDatasetIds(ctx);
    if (dsIds.length === 0) return { descriptors: [], cursor: null, reachedEnd: true };
    const after = (cursor as { trialBalanceId: string; accountSnapshotId: string } | null) ?? null;
    const groups = await fetchTBDuplicateGroups(tx, ctx.preparationId, pin.auditTestVersionId, dsIds, after, batchSize);
    let last = after;
    const descriptors: ResultDescriptor[] = [];
    for (const g of groups) {
      last = { trialBalanceId: g.trialBalanceId, accountSnapshotId: g.accountSnapshotId };
      const accountId = datasetAccountSemanticId({
        datasetHash: g.datasetHash, sourceSystem: g.sourceSystem, sourceEntity: g.sourceEntity, sourceLedger: g.sourceLedger, sourceAccountCode: g.sourceAccountCode,
      });
      const repRows = await fetchTBGroupRows(tx, ctx.preparationId, pin.auditTestVersionId, g.trialBalanceId, g.accountSnapshotId, TB_DUP_EVIDENCE_K);
      const evidence: EvidenceRef[] = repRows.map((r) => ({
        evidenceType: "TRIAL_BALANCE_ROW", datasetId: g.datasetId, sourceRowNo: r.sourceRowNo, trialBalanceRowId: r.trialBalanceRowId, eoiFrameHash: r.eoiFrameHash, role: "member",
      }));
      descriptors.push({
        resultKind: "ACCOUNTING_INTEGRITY",
        resultCode: "AI_TB_ACCOUNT_DUPLICATION",
        severity: "MEDIUM",
        payload: canonicalize({ accountSourceCode: g.sourceAccountCode, occurrenceCount: g.occurrenceCount }),
        identityEOIs: [accountId], // group identity — independent of which K rows are attached
        evidence,
        consumedMappingSemanticHashes: [],
      });
    }
    return { descriptors, cursor: last, reachedEnd: groups.length < batchSize };
  },
};
