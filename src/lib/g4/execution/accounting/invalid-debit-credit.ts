import type { TenantTx } from "@/lib/db/tenant";
import type { ExecutionContext, TestPin } from "../context";
import type { TestExecutor, ExecPageResult, ResultDescriptor } from "../contracts";
import { fetchMemberLinePage, type Keyset } from "../population";
import { canonicalize, dec } from "../canonical";
import { decimalToMicros } from "@/lib/accounting/decimal";

/**
 * AI_INVALID_DEBIT_CREDIT (C2). JournalLine grain (member 1:1 line). Flags a line
 * with a negative debit, a negative credit, or both sides positive. Comparison is
 * exact integer micro-units (never JS float). `reason` is a canonical ordered set
 * so multiple simultaneously-true predicates yield a deterministic value.
 */
function sign(v: string | null): bigint | null {
  if (v == null) return null;
  return decimalToMicros(v);
}

export const invalidDebitCreditExecutor: TestExecutor = {
  testType: "ACCOUNTING_INTEGRITY",
  kind: "INVALID_DEBIT_CREDIT",
  grain: "JOURNAL_LINE",
  supportedDatasetKinds: ["GENERAL_LEDGER"],
  validateFrozenConfig() { /* immutable journal_lines; no external dependency */ },
  async executePage(tx: TenantTx, ctx: ExecutionContext, pin: TestPin, cursor: unknown, batchSize: number): Promise<ExecPageResult> {
    const after = (cursor as Keyset | null) ?? null;
    const page = await fetchMemberLinePage(tx, ctx.preparationId, pin.auditTestVersionId, after, batchSize);
    let last = after;
    const descriptors: ResultDescriptor[] = [];
    for (const l of page) {
      last = { datasetId: l.datasetId, sourceRowNo: l.sourceRowNo };
      const d = sign(l.transactionDebit);
      const c = sign(l.transactionCredit);
      const reasons: string[] = [];
      if (d !== null && d < 0n) reasons.push("NEGATIVE_DEBIT");
      if (c !== null && c < 0n) reasons.push("NEGATIVE_CREDIT");
      if (d !== null && c !== null && d > 0n && c > 0n) reasons.push("BOTH_SIDED");
      if (reasons.length === 0) continue; // valid single-sided / both-null / both-zero
      descriptors.push({
        resultKind: "ACCOUNTING_INTEGRITY",
        resultCode: "AI_INVALID_DEBIT_CREDIT",
        severity: "HIGH",
        payload: canonicalize({
          sourceRowNo: l.sourceRowNo,
          transactionDebit: l.transactionDebit == null ? null : dec(l.transactionDebit),
          transactionCredit: l.transactionCredit == null ? null : dec(l.transactionCredit),
          reason: reasons.join(","),
        }),
        identityEOIs: [l.eoiFrameHash],
        evidence: [{ evidenceType: "JOURNAL_LINE", datasetId: l.datasetId, sourceRowNo: l.sourceRowNo, journalLineId: l.journalLineId, lineNo: l.lineNo, eoiFrameHash: l.eoiFrameHash, role: "subject" }],
        consumedMappingSemanticHashes: [],
      });
    }
    return { descriptors, cursor: last, reachedEnd: page.length < batchSize };
  },
};
