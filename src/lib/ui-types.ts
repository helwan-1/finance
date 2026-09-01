/** Types shared between the API layer and client components. */

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

export type AnomalyStatus =
  | "OPEN"
  | "IN_REVIEW"
  | "RESOLVED"
  | "DISMISSED"
  | "ESCALATED";

/** DTO returned by GET /api/anomalies. */
export interface AnomalyDTO {
  id: string;
  ruleCode: AnomalyRuleCode;
  severity: AnomalySeverity;
  status: AnomalyStatus;
  title: string;
  titleAr: string;
  description: string;
  descriptionAr: string;
  score: string;
  detectedAt: string;
  reference: string | null;
  amount: string | null;
  counterparty: string | null;
}

export interface AnomaliesResponse {
  anomalies: AnomalyDTO[];
  total: number;
}

/** Filters accepted by the FilterBar / anomalies API. */
export interface AnomalyFilters {
  search: string;
  severity: AnomalySeverity | "ALL";
  ruleCode: AnomalyRuleCode | "ALL";
  status: AnomalyStatus | "ALL";
  from: string | null;
  to: string | null;
}

export interface EngagementSummary {
  id: string;
  titleAr: string;
  clientNameAr: string;
  fiscalYear: number;
}
