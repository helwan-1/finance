/**
 * Shared input/output types for the audit algorithms engine.
 *
 * The engine is intentionally decoupled from Prisma models: it accepts plain
 * records so it can be unit-tested and reused from a Python bridge / worker.
 */

/** Minimal transaction shape the analyzers need. Amounts are decimal strings. */
export interface AnalyzableTransaction {
  id: string;
  reference: string;
  description: string;
  /**
   * Decimal string, e.g. "1234.50". Treated as the taxable base (net amount)
   * for VAT analysis. Converted to minor units internally.
   */
  amount: string;
  /** Declared VAT/tax amount as a decimal string, when known. */
  vatAmount?: string | null;
  counterparty?: string | null;
  account?: string | null;
  /** ISO timestamp of when the entry was posted. */
  postedAt: string;
}

export type AnomalyRuleCode =
  | "BENFORD_DEVIATION"
  | "DUPLICATE_EXACT"
  | "DUPLICATE_NEAR"
  | "OFF_HOURS_ENTRY"
  | "WEEKEND_ENTRY"
  | "VAT_DISCREPANCY"
  | "ROUND_AMOUNT"
  | "UNRECONCILED";

export type AnomalySeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";

/** A detected anomaly, engine-side (before persistence). */
export interface DetectedAnomaly {
  ruleCode: AnomalyRuleCode;
  severity: AnomalySeverity;
  /** 0-100 ranking score. */
  score: number;
  title: string;
  titleAr: string;
  description: string;
  descriptionAr: string;
  /** Transactions implicated by this finding. */
  transactionIds: string[];
  /** Structured evidence, serialized to JSON on persist. */
  evidence: Record<string, unknown>;
}
