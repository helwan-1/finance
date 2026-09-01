/**
 * Smart reconciliation engine.
 *
 * Matches transactions between two sources (e.g. BANK vs LEDGER) by amount,
 * value-date proximity, and reference/counterparty similarity, producing a set
 * of matches with a confidence score, plus the residual unmatched entries.
 *
 * Matching is greedy on descending confidence: the strongest candidate pair is
 * committed first, and each transaction is used at most once. All monetary
 * comparisons are in integer minor units.
 */

import { absMinor, toMinorUnits } from "../audit/money";

/** Minimal transaction shape the reconciler needs. */
export interface ReconcilableTxn {
  id: string;
  reference: string;
  /** Decimal string. */
  amount: string;
  counterparty?: string | null;
  /** ISO value/accounting date. */
  valueDate: string;
}

export type MatchStatus = "MATCHED" | "PARTIAL" | "UNMATCHED";

export interface ReconMatch {
  sourceId: string;
  targetId: string | null;
  status: MatchStatus;
  /** 0..1 confidence. */
  confidence: number;
  /** source − target in minor units, when a target is assigned. */
  amountDeltaMinor: number | null;
}

export interface ReconResult {
  matches: ReconMatch[];
  matchedCount: number;
  partialCount: number;
  unmatchedSourceIds: string[];
  unmatchedTargetIds: string[];
  totalCount: number;
}

export interface ReconOptions {
  /** Max |value-date| difference to consider a candidate, in days. Default 5. */
  dateWindowDays: number;
  /**
   * Max |amount| difference (minor units) still eligible as a PARTIAL match.
   * 0 (default) means only exact-amount matches are allowed.
   */
  amountToleranceMinor: number;
  /** Minimum confidence to commit a match. Default 0.5. */
  minConfidence: number;
}

const DEFAULT_OPTIONS: ReconOptions = {
  dateWindowDays: 5,
  amountToleranceMinor: 0,
  minConfidence: 0.5,
};

const DAY_MS = 24 * 60 * 60 * 1000;

interface Prepared {
  txn: ReconcilableTxn;
  amountMinor: number;
  counterparty: string;
  timeMs: number;
}

function prepare(txn: ReconcilableTxn): Prepared {
  return {
    txn,
    amountMinor: toMinorUnits(txn.amount),
    counterparty: (txn.counterparty ?? "").trim().toLowerCase(),
    timeMs: new Date(txn.valueDate).getTime(),
  };
}

interface Candidate {
  sourceIdx: number;
  targetIdx: number;
  confidence: number;
  amountDeltaMinor: number;
  exact: boolean;
}

function scoreCandidate(
  s: Prepared,
  t: Prepared,
  opts: ReconOptions,
): Candidate | null {
  const amountDeltaMinor = s.amountMinor - t.amountMinor;
  const absDelta = absMinor(amountDeltaMinor);
  if (absDelta > opts.amountToleranceMinor) return null;

  const daysApart = Math.abs(s.timeMs - t.timeMs) / DAY_MS;
  if (daysApart > opts.dateWindowDays) return null;

  const exact = absDelta === 0;
  // Amount component: 1.0 when exact, degrading toward the tolerance edge.
  const amountScore =
    opts.amountToleranceMinor === 0 || exact
      ? 1
      : 1 - (absDelta / opts.amountToleranceMinor) * 0.4;
  // Date component: 1.0 same day, degrading toward the window edge.
  const dateScore = 1 - (daysApart / opts.dateWindowDays) * 0.4;
  // Small bonus when references or counterparties agree.
  const refMatch =
    s.txn.reference.trim().toLowerCase() ===
    t.txn.reference.trim().toLowerCase();
  const partyMatch =
    s.counterparty.length > 0 && s.counterparty === t.counterparty;
  const bonus = (refMatch ? 0.1 : 0) + (partyMatch ? 0.05 : 0);

  const confidence = Math.min(
    1,
    amountScore * 0.6 + dateScore * 0.3 + bonus,
  );
  return { sourceIdx: -1, targetIdx: -1, confidence, amountDeltaMinor, exact };
}

export function reconcile(
  sourceTxns: readonly ReconcilableTxn[],
  targetTxns: readonly ReconcilableTxn[],
  options: Partial<ReconOptions> = {},
): ReconResult {
  const opts: ReconOptions = { ...DEFAULT_OPTIONS, ...options };
  const sources = sourceTxns.map(prepare);
  const targets = targetTxns.map(prepare);

  // Build all eligible candidate pairs.
  const candidates: Candidate[] = [];
  for (let i = 0; i < sources.length; i += 1) {
    for (let j = 0; j < targets.length; j += 1) {
      const scored = scoreCandidate(sources[i]!, targets[j]!, opts);
      if (scored && scored.confidence >= opts.minConfidence) {
        candidates.push({ ...scored, sourceIdx: i, targetIdx: j });
      }
    }
  }

  // Greedy: strongest first, then earliest to keep the result deterministic.
  candidates.sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    if (a.sourceIdx !== b.sourceIdx) return a.sourceIdx - b.sourceIdx;
    return a.targetIdx - b.targetIdx;
  });

  const usedSource = new Set<number>();
  const usedTarget = new Set<number>();
  const matches: ReconMatch[] = [];
  let matchedCount = 0;
  let partialCount = 0;

  for (const c of candidates) {
    if (usedSource.has(c.sourceIdx) || usedTarget.has(c.targetIdx)) continue;
    usedSource.add(c.sourceIdx);
    usedTarget.add(c.targetIdx);
    const status: MatchStatus = c.exact ? "MATCHED" : "PARTIAL";
    if (status === "MATCHED") matchedCount += 1;
    else partialCount += 1;
    matches.push({
      sourceId: sources[c.sourceIdx]!.txn.id,
      targetId: targets[c.targetIdx]!.txn.id,
      status,
      confidence: Math.round(c.confidence * 10000) / 10000,
      amountDeltaMinor: c.amountDeltaMinor,
    });
  }

  const unmatchedSourceIds: string[] = [];
  for (let i = 0; i < sources.length; i += 1) {
    if (usedSource.has(i)) continue;
    unmatchedSourceIds.push(sources[i]!.txn.id);
    matches.push({
      sourceId: sources[i]!.txn.id,
      targetId: null,
      status: "UNMATCHED",
      confidence: 0,
      amountDeltaMinor: null,
    });
  }

  const unmatchedTargetIds: string[] = [];
  for (let j = 0; j < targets.length; j += 1) {
    if (!usedTarget.has(j)) unmatchedTargetIds.push(targets[j]!.txn.id);
  }

  return {
    matches,
    matchedCount,
    partialCount,
    unmatchedSourceIds,
    unmatchedTargetIds,
    totalCount: sources.length,
  };
}
