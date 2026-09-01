/**
 * Duplicate transaction detection.
 *
 *   * Exact duplicates: same amount + same counterparty + same reference.
 *   * Near duplicates: same amount + same counterparty, posted within a
 *     configurable time window, but with a different reference (a classic
 *     double-payment / split-entry pattern).
 */

import { toMinorUnits } from "./money";
import type {
  AnalyzableTransaction,
  DetectedAnomaly,
} from "./types";

export interface DuplicateOptions {
  /** Time window for near-duplicate grouping, in hours. Default 72h. */
  nearWindowHours: number;
}

const DEFAULT_OPTIONS: DuplicateOptions = {
  nearWindowHours: 72,
};

interface NormalizedTxn {
  txn: AnalyzableTransaction;
  amountMinor: number;
  counterparty: string;
  reference: string;
  postedMs: number;
}

function normalize(txn: AnalyzableTransaction): NormalizedTxn {
  return {
    txn,
    amountMinor: toMinorUnits(txn.amount),
    counterparty: (txn.counterparty ?? "").trim().toLowerCase(),
    reference: txn.reference.trim().toLowerCase(),
    postedMs: new Date(txn.postedAt).getTime(),
  };
}

/** Group key ignoring reference — used for both exact and near passes. */
function amountPartyKey(n: NormalizedTxn): string {
  return `${n.amountMinor}::${n.counterparty}`;
}

export function detectDuplicates(
  transactions: readonly AnalyzableTransaction[],
  options: Partial<DuplicateOptions> = {},
): DetectedAnomaly[] {
  const opts: DuplicateOptions = { ...DEFAULT_OPTIONS, ...options };
  const windowMs = opts.nearWindowHours * 60 * 60 * 1000;

  const normalized = transactions
    .map(normalize)
    .filter((n) => n.amountMinor !== 0);

  const groups = new Map<string, NormalizedTxn[]>();
  for (const n of normalized) {
    const key = amountPartyKey(n);
    const bucket = groups.get(key);
    if (bucket) bucket.push(n);
    else groups.set(key, [n]);
  }

  const anomalies: DetectedAnomaly[] = [];

  for (const bucket of groups.values()) {
    if (bucket.length < 2) continue;

    // ---- Exact duplicates: identical reference within the group ----
    const byReference = new Map<string, NormalizedTxn[]>();
    for (const n of bucket) {
      const list = byReference.get(n.reference);
      if (list) list.push(n);
      else byReference.set(n.reference, [n]);
    }

    for (const [reference, list] of byReference) {
      if (list.length < 2) continue;
      const first = list[0]!;
      anomalies.push({
        ruleCode: "DUPLICATE_EXACT",
        severity: "HIGH",
        score: 85,
        title: "Exact duplicate transactions",
        titleAr: "معاملات مكررة تماماً",
        description: `${list.length} transactions share the same amount, counterparty and reference "${reference}".`,
        descriptionAr: `${list.length} معاملات لها نفس المبلغ والطرف المقابل والمرجع "${reference}".`,
        transactionIds: list.map((n) => n.txn.id),
        evidence: {
          amount: first.txn.amount,
          counterparty: first.txn.counterparty ?? null,
          reference,
          count: list.length,
        },
      });
    }

    // ---- Near duplicates: same amount + party, close in time, different ref ----
    // Same-reference pairs are already reported as exact duplicates above, so
    // they are skipped here; an entry can still be a near-match of a
    // differently-referenced one nearby.
    const candidates = [...bucket].sort((a, b) => a.postedMs - b.postedMs);

    for (let i = 0; i < candidates.length; i += 1) {
      const a = candidates[i]!;
      for (let j = i + 1; j < candidates.length; j += 1) {
        const b = candidates[j]!;
        const delta = b.postedMs - a.postedMs;
        if (delta > windowMs) break; // sorted: no further match possible
        if (a.reference === b.reference) continue;

        const hours = Math.round(delta / (60 * 60 * 1000));
        anomalies.push({
          ruleCode: "DUPLICATE_NEAR",
          severity: "MEDIUM",
          score: 65,
          title: "Near-duplicate transactions",
          titleAr: "معاملات شبه مكررة",
          description: `Two transactions with identical amount and counterparty posted ${hours}h apart with different references (${a.txn.reference}, ${b.txn.reference}).`,
          descriptionAr: `معاملتان بنفس المبلغ والطرف المقابل بفارق ${hours} ساعة بمرجعين مختلفين (${a.txn.reference}، ${b.txn.reference}).`,
          transactionIds: [a.txn.id, b.txn.id],
          evidence: {
            amount: a.txn.amount,
            counterparty: a.txn.counterparty ?? null,
            hoursApart: hours,
            references: [a.txn.reference, b.txn.reference],
          },
        });
      }
    }
  }

  return anomalies;
}
