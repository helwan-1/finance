import type { TenantTx } from "@/lib/db/tenant";
import type { ExecutionContext, TestPin } from "../context";
import type { TestExecutor, ExecPageResult, ResultDescriptor } from "../contracts";
import { fetchEligibleJEPage } from "../population";
import { canonicalize, dec } from "../canonical";
import { journalEntryEOI } from "@/lib/g4/semantic-identity";

/**
 * AI_UNBALANCED_JOURNAL_ENTRY (C2). JournalEntry grain. Uses the immutable,
 * import-time-computed balanceStatus (integer-micros; never JS float). Emits one
 * result per JE with balanceStatus='UNBALANCED'; BALANCED and NOT_EVALUABLE
 * (incl. multicurrency) never fire. Partial JEs fail closed inside fetchEligibleJEPage.
 */
function glDatasetIds(ctx: ExecutionContext): string[] {
  return ctx.datasetPins.filter((d) => d.datasetKind === "GENERAL_LEDGER").map((d) => d.datasetId);
}

export const unbalancedJournalEntryExecutor: TestExecutor = {
  testType: "ACCOUNTING_INTEGRITY",
  kind: "UNBALANCED_JE",
  grain: "JOURNAL_ENTRY",
  supportedDatasetKinds: ["GENERAL_LEDGER"],
  validateFrozenConfig() { /* immutable journal_entries; no external dependency */ },
  async executePage(tx: TenantTx, ctx: ExecutionContext, pin: TestPin, cursor: unknown, batchSize: number): Promise<ExecPageResult> {
    const dsIds = glDatasetIds(ctx);
    if (dsIds.length === 0) return { descriptors: [], cursor: null, reachedEnd: true };
    const afterId = (cursor as { jeId: string } | null)?.jeId ?? null;
    const page = await fetchEligibleJEPage(tx, ctx.preparationId, pin.auditTestVersionId, dsIds, afterId, batchSize);
    let last = afterId ? { jeId: afterId } : null;
    const descriptors: ResultDescriptor[] = [];
    for (const je of page) {
      last = { jeId: je.journalEntryId };
      if (je.balanceStatus !== "UNBALANCED") continue; // skip BALANCED / NOT_EVALUABLE
      const eoi = journalEntryEOI({ datasetHash: je.datasetHash, sourceEntryId: je.sourceEntryId });
      descriptors.push({
        resultKind: "ACCOUNTING_INTEGRITY",
        resultCode: "AI_UNBALANCED_JOURNAL_ENTRY",
        severity: "HIGH",
        payload: canonicalize({
          sourceEntryId: je.sourceEntryId,
          debitTotal: je.debitTotal == null ? null : dec(je.debitTotal),
          creditTotal: je.creditTotal == null ? null : dec(je.creditTotal),
          difference: je.difference == null ? null : dec(je.difference),
          currency: je.balanceCurrency,
        }),
        identityEOIs: [eoi],
        evidence: [{ evidenceType: "JOURNAL_ENTRY", datasetId: je.datasetId, journalEntryId: je.journalEntryId, sourceEntryId: je.sourceEntryId, eoiFrameHash: eoi, role: "subject" }],
        consumedMappingSemanticHashes: [],
      });
    }
    return { descriptors, cursor: last, reachedEnd: page.length < batchSize };
  },
};
