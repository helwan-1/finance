/**
 * Reconciliation engine — public entry point.
 */

import type { DetectedAnomaly } from "../audit/types";
import type { ReconResult, ReconcilableTxn } from "./reconcile";

export * from "./reconcile";

/** Look up a transaction's reference by id, for anomaly messages. */
export type ReferenceLookup = (id: string) => ReconcilableTxn | undefined;

/**
 * Turn unmatched source entries into UNRECONCILED anomalies. Unmatched target
 * entries are reported symmetrically by swapping the arguments at the call site.
 */
export function reconciliationAnomalies(
  result: ReconResult,
  lookup: ReferenceLookup,
): DetectedAnomaly[] {
  return result.unmatchedSourceIds.map((id) => {
    const txn = lookup(id);
    const ref = txn?.reference ?? id;
    return {
      ruleCode: "UNRECONCILED",
      severity: "MEDIUM",
      score: 60,
      title: "Unreconciled transaction",
      titleAr: "معاملة غير مطابَقة",
      description: `Transaction ${ref} could not be matched to any counterparty entry within the tolerance window.`,
      descriptionAr: `تعذّر مطابقة المعاملة ${ref} مع أي قيد مقابل ضمن نطاق التفاوت المسموح.`,
      transactionIds: [id],
      evidence: {
        amount: txn?.amount ?? null,
        valueDate: txn?.valueDate ?? null,
      },
    } satisfies DetectedAnomaly;
  });
}
