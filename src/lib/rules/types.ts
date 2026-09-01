/**
 * Deterministic audit rules engine — type definitions.
 *
 * A rule is pure data (a `RuleDefinition`) that the engine evaluates against
 * transaction records. No AI at runtime: every finding is fully explained by
 * the rule and the values that triggered it.
 */

export type RuleSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";

export type RuleCategory = "NUMERIC" | "PARTY" | "TIMING" | "AGGREGATE";

/** Normalized transaction record the engine evaluates. */
export interface RuleRecord {
  id: string;
  reference: string;
  description: string;
  /** Decimal string, e.g. "1234.50". */
  amount: string;
  /** Declared VAT as a decimal string, when known. */
  vatAmount?: string | null;
  counterparty?: string | null;
  account?: string | null;
  /** ISO timestamp the entry was posted. */
  postedAt: string;
  /** ISO value/accounting date, when known. */
  valueDate?: string | null;
  /** Whether a source document is linked. */
  hasDocument?: boolean;
}

/** Numeric fields available to comparison rules. */
export type NumericField =
  | "amount"
  | "vatAmount"
  | "hour" // 0-23 in the configured timezone
  | "weekday" // 0 = Sunday .. 6 = Saturday
  | "vatRatioPct" // vatAmount / amount * 100
  | "valueVsPostedDays"; // postedAt - valueDate, in days (negative = future-dated)

export type CompareOp = "gt" | "gte" | "lt" | "lte" | "eq" | "neq" | "between";

export interface FieldCompareDef {
  type: "field_compare";
  field: NumericField;
  op: CompareOp;
  value: number;
  /** Upper bound for `between`. */
  value2?: number;
}

export interface RoundAmountDef {
  type: "round_amount";
  /** Flag amounts that are an exact multiple of 10^minTrailingZeros. */
  minTrailingZeros: number;
}

export interface ThresholdAvoidanceDef {
  type: "threshold_avoidance";
  /** Authorization limit being avoided. */
  limit: number;
  /** Flag amounts within this % below the limit (e.g. 5 → [95%, 100%)). */
  marginPct: number;
}

export interface ValueListDef {
  type: "value_list";
  field: "counterparty" | "account";
  /** deny → flag when the value IS in the list; allow → flag when it is NOT. */
  mode: "deny" | "allow";
  values: string[];
}

export interface MissingFieldDef {
  type: "missing_field";
  field: "counterparty" | "account" | "vatAmount" | "document" | "valueDate";
}

export interface TimeWindowDef {
  type: "time_window";
  kind: "off_hours" | "weekend";
  businessStartHour?: number; // default 7
  businessEndHour?: number; // default 19
  weekendDays?: number[]; // default [5, 6] (Fri, Sat)
  timeZone?: string; // default Asia/Riyadh
}

export interface AggregateDef {
  type: "aggregate";
  /** Group records by these fields, then test the aggregate. */
  groupBy: Array<"counterparty" | "account" | "amount" | "reference">;
  agg: "count" | "sum";
  op: CompareOp;
  value: number;
  value2?: number;
  /** Optional: only group records whose postedAt falls within this many days. */
  windowDays?: number;
}

export type RuleDefinition =
  | FieldCompareDef
  | RoundAmountDef
  | ThresholdAvoidanceDef
  | ValueListDef
  | MissingFieldDef
  | TimeWindowDef
  | AggregateDef;

/** A rule as stored / passed to the engine. */
export interface AuditRuleSpec {
  id: string;
  code: string;
  nameAr: string;
  category: RuleCategory;
  severity: RuleSeverity;
  definition: RuleDefinition;
}

/** A finding produced by evaluating a rule. */
export interface RuleFinding {
  ruleId: string;
  code: string;
  category: RuleCategory;
  severity: RuleSeverity;
  titleAr: string;
  descriptionAr: string;
  transactionIds: string[];
  evidence: Record<string, unknown>;
}
