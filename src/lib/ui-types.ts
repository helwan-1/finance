/** Types shared between the API layer and client components. */

export type AnomalyRuleCode =
  | "BENFORD_DEVIATION"
  | "DUPLICATE_EXACT"
  | "DUPLICATE_NEAR"
  | "OFF_HOURS_ENTRY"
  | "WEEKEND_ENTRY"
  | "VAT_DISCREPANCY"
  | "ROUND_AMOUNT"
  | "UNRECONCILED"
  | "THRESHOLD_AVOIDANCE"
  | "GAP_SEQUENCE"
  | "DENYLIST_PARTY"
  | "MISSING_FIELD"
  | "BACKDATED_ENTRY"
  | "CUSTOM_RULE";

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

// ---- Audit rules ----

export type RuleCategory = "NUMERIC" | "PARTY" | "TIMING" | "AGGREGATE";
export type RuleScope = "FIRM" | "ENGAGEMENT";

export interface RuleDTO {
  id: string;
  code: string;
  nameAr: string;
  category: RuleCategory;
  severity: AnomalySeverity;
  enabled: boolean;
  scope: RuleScope;
  descriptionAr: string | null;
  /** Opaque rule definition (discriminated union), for display/editing. */
  definition: Record<string, unknown>;
}

export interface RulesResponse {
  rules: RuleDTO[];
}

export interface RunRulesResponse {
  evaluated: number;
  findings: number;
}

// ---- Settings ----

export interface FirmSettings {
  vatRatePct: number;
  businessStartHour: number;
  businessEndHour: number;
  weekendDays: number[];
  timeZone: string;
}

export interface SettingsResponse {
  firmNameAr: string;
  licenseNo: string;
  userNameAr: string | null;
  role: string | null;
  canEdit: boolean;
  settings: FirmSettings;
}

// ---- G5: Professional dispositions & findings ----

export type MatterPriority = "LOW" | "MEDIUM" | "HIGH";

export type ExceptionStatus =
  | "OPEN"
  | "UNDER_INVESTIGATION"
  | "CONCLUDED_WITH_FINDING"
  | "CLOSED_NO_FINDING";

export type FindingStatus = "DRAFT" | "IN_REVIEW" | "CONCLUDED" | "WITHDRAWN";

/** IMRAD-style finding content (one version). */
export interface FindingContentDTO {
  category: string;
  condition: string;
  criteria: string;
  cause: string;
  effect: string;
  auditorConclusion: string;
  recommendation: string | null;
  observedAmount: string | null;
  observedCurrency: string | null;
  estimatedExposureAmount: string | null;
  estimatedExposureCurrency: string | null;
}

export interface FindingVersionDTO extends FindingContentDTO {
  id: string;
  versionNo: number;
  preparedById: string;
  preparedAt: string;
}

export interface FindingDTO {
  id: string;
  status: FindingStatus;
  currentVersionId: string | null;
  createdById: string;
  createdAt: string;
  currentVersion: FindingVersionDTO | null;
}

export interface ExceptionDTO {
  id: string;
  status: ExceptionStatus;
  priority: MatterPriority;
  title: string;
  titleAr: string | null;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  linkedResultCount: number;
  findingCount: number;
}

export interface ExceptionsResponse {
  exceptions: ExceptionDTO[];
  total: number;
}

export interface ExceptionDetailDTO extends ExceptionDTO {
  linkedResultIds: string[];
  findings: FindingDTO[];
}

export interface ExceptionDetailResponse {
  exception: ExceptionDetailDTO;
}

/** An audit result (G4) that an exception can be created from. */
export interface AuditResultDTO {
  id: string;
  resultKind: string;
  resultCode: string;
  severity: AnomalySeverity;
  score: string;
  createdAt: string;
  dispositionState: string;
}

export interface AuditResultsResponse {
  results: AuditResultDTO[];
}

export interface FindingCategoryDTO {
  code: string;
  labelAr: string;
}

export interface FindingCategoriesResponse {
  categories: FindingCategoryDTO[];
}
