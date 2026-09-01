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

export type ReconMatchStatus = "MATCHED" | "PARTIAL" | "UNMATCHED";

export interface ReconMatchDTO {
  id: string;
  sourceRef: string;
  sourceAmount: string;
  targetRef: string | null;
  status: ReconMatchStatus;
  /** 0..1 as a decimal string. */
  confidence: string;
  amountDelta: string | null;
}

export interface ReconSessionDTO {
  id: string;
  name: string;
  status: string;
  sourceA: string;
  sourceB: string;
  matchedCount: number;
  partialCount: number;
  unmatchedCount: number;
  totalCount: number;
  matches: ReconMatchDTO[];
}

export interface ReconciliationResponse {
  sessions: ReconSessionDTO[];
}

// ---- Documents ----

export type DocumentType =
  | "INVOICE"
  | "BANK_STATEMENT"
  | "VAT_RETURN"
  | "GENERAL_LEDGER"
  | "PURCHASE_ORDER"
  | "RECEIPT"
  | "OTHER";

export type DocumentStatus =
  | "UPLOADED"
  | "PROCESSING"
  | "PARSED"
  | "FAILED"
  | "ARCHIVED";

export interface DocumentDTO {
  id: string;
  type: DocumentType;
  status: DocumentStatus;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  pageCount: number | null;
  uploadedAt: string;
  parsedAt: string | null;
  /** Number of transactions extracted from this document, when parsed. */
  extractedCount: number | null;
}

export interface DocumentsResponse {
  documents: DocumentDTO[];
}

// ---- Analytics (Benford) ----

export interface BenfordDigitDTO {
  digit: number;
  observedCount: number;
  observedProportion: number;
  expectedProportion: number;
}

export interface AnalyticsResponse {
  sampleSize: number;
  chiSquare: number;
  criticalValue: number;
  rejectsBenford: boolean;
  digits: BenfordDigitDTO[];
}

// ---- Audit log ----

export interface AuditLogDTO {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  userNameAr: string;
  createdAt: string;
  metadata: Record<string, unknown> | null;
}

export interface AuditLogResponse {
  logs: AuditLogDTO[];
}
