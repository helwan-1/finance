/**
 * Deterministic audit rules engine.
 *
 * Evaluates data-defined rules against transaction records and returns fully
 * explained findings. Pure and dependency-free (money handled in integer minor
 * units — never JS floats).
 */

import { toMinorUnits, minorUnitsToString } from "../audit/money";
import { zonedParts } from "../audit/offHours";
import type {
  AggregateDef,
  AuditRuleSpec,
  CompareOp,
  FieldCompareDef,
  MissingFieldDef,
  NumericField,
  RoundAmountDef,
  RuleFinding,
  RuleRecord,
  ThresholdAvoidanceDef,
  TimeWindowDef,
  ValueListDef,
} from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TZ = "Asia/Riyadh";

/** Compare a number against a rule value using the given operator. */
function cmp(op: CompareOp, a: number, value: number, value2?: number): boolean {
  switch (op) {
    case "gt":
      return a > value;
    case "gte":
      return a >= value;
    case "lt":
      return a < value;
    case "lte":
      return a <= value;
    case "eq":
      return a === value;
    case "neq":
      return a !== value;
    case "between":
      return value2 !== undefined && a >= value && a <= value2;
    default:
      return false;
  }
}

const OP_LABEL_AR: Record<CompareOp, string> = {
  gt: "أكبر من",
  gte: "أكبر من أو يساوي",
  lt: "أقل من",
  lte: "أقل من أو يساوي",
  eq: "يساوي",
  neq: "لا يساوي",
  between: "بين",
};

const FIELD_LABEL_AR: Record<NumericField, string> = {
  amount: "المبلغ",
  vatAmount: "ضريبة القيمة المضافة",
  hour: "ساعة القيد",
  weekday: "يوم الأسبوع",
  vatRatioPct: "نسبة الضريبة %",
  valueVsPostedDays: "الفارق بين تاريخ القيد وتاريخ القيمة (أيام)",
};

/** Resolve a numeric field for a record. Amounts are returned in minor units. */
function numericValue(record: RuleRecord, field: NumericField): number | null {
  switch (field) {
    case "amount":
      return toMinorUnits(record.amount);
    case "vatAmount":
      return record.vatAmount ? toMinorUnits(record.vatAmount) : null;
    case "hour":
      return zonedParts(record.postedAt, DEFAULT_TZ).hour;
    case "weekday":
      return zonedParts(record.postedAt, DEFAULT_TZ).weekday;
    case "vatRatioPct": {
      const amt = toMinorUnits(record.amount);
      if (amt === 0 || !record.vatAmount) return null;
      return (toMinorUnits(record.vatAmount) / amt) * 100;
    }
    case "valueVsPostedDays": {
      if (!record.valueDate) return null;
      const posted = new Date(record.postedAt).getTime();
      const value = new Date(record.valueDate).getTime();
      return Math.round((posted - value) / DAY_MS);
    }
    default:
      return null;
  }
}

/** Amount fields are compared in minor units, so scale the rule value ×100. */
function scaleForField(field: NumericField, value: number): number {
  return field === "amount" || field === "vatAmount"
    ? Math.round(value * 100)
    : value;
}

function displayFieldValue(field: NumericField, minorOrPlain: number): string {
  return field === "amount" || field === "vatAmount"
    ? minorUnitsToString(minorOrPlain)
    : String(Math.round(minorOrPlain * 100) / 100);
}

function evalFieldCompare(
  rule: AuditRuleSpec,
  def: FieldCompareDef,
  records: readonly RuleRecord[],
): RuleFinding[] {
  const findings: RuleFinding[] = [];
  const value = scaleForField(def.field, def.value);
  const value2 =
    def.value2 !== undefined ? scaleForField(def.field, def.value2) : undefined;

  for (const r of records) {
    const actual = numericValue(r, def.field);
    if (actual === null) continue;
    if (!cmp(def.op, actual, value, value2)) continue;

    const bound =
      def.op === "between"
        ? `${def.value} و ${def.value2}`
        : `${def.value}`;
    findings.push({
      ruleId: rule.id,
      code: rule.code,
      category: rule.category,
      severity: rule.severity,
      titleAr: rule.nameAr,
      descriptionAr: `${r.reference}: ${FIELD_LABEL_AR[def.field]} (${displayFieldValue(def.field, actual)}) ${OP_LABEL_AR[def.op]} ${bound}.`,
      transactionIds: [r.id],
      evidence: { field: def.field, op: def.op, threshold: def.value, actual: displayFieldValue(def.field, actual) },
    });
  }
  return findings;
}

function evalRoundAmount(
  rule: AuditRuleSpec,
  def: RoundAmountDef,
  records: readonly RuleRecord[],
): RuleFinding[] {
  // A "round" amount is an exact multiple of 10^n currency units → 10^(n+2) minor.
  const modulus = Math.pow(10, def.minTrailingZeros + 2);
  const findings: RuleFinding[] = [];
  for (const r of records) {
    const minor = toMinorUnits(r.amount);
    if (minor === 0 || minor % modulus !== 0) continue;
    findings.push({
      ruleId: rule.id,
      code: rule.code,
      category: rule.category,
      severity: rule.severity,
      titleAr: rule.nameAr,
      descriptionAr: `${r.reference}: مبلغ مُدوَّر (${minorUnitsToString(minor)}) بأصفار تتبع لا تقل عن ${def.minTrailingZeros}.`,
      transactionIds: [r.id],
      evidence: { amount: r.amount, minTrailingZeros: def.minTrailingZeros },
    });
  }
  return findings;
}

function evalThresholdAvoidance(
  rule: AuditRuleSpec,
  def: ThresholdAvoidanceDef,
  records: readonly RuleRecord[],
): RuleFinding[] {
  const limit = Math.round(def.limit * 100);
  const lower = Math.round(limit * (1 - def.marginPct / 100));
  const findings: RuleFinding[] = [];
  for (const r of records) {
    const minor = toMinorUnits(r.amount);
    if (minor >= lower && minor < limit) {
      findings.push({
        ruleId: rule.id,
        code: rule.code,
        category: rule.category,
        severity: rule.severity,
        titleAr: rule.nameAr,
        descriptionAr: `${r.reference}: المبلغ (${minorUnitsToString(minor)}) أقل بقليل من حد الاعتماد (${def.limit}) — قد يشير لتقسيم/التفاف على الحد.`,
        transactionIds: [r.id],
        evidence: { amount: r.amount, limit: def.limit, marginPct: def.marginPct },
      });
    }
  }
  return findings;
}

function evalValueList(
  rule: AuditRuleSpec,
  def: ValueListDef,
  records: readonly RuleRecord[],
): RuleFinding[] {
  const set = new Set(def.values.map((v) => v.trim().toLowerCase()));
  const findings: RuleFinding[] = [];
  for (const r of records) {
    const raw = (def.field === "counterparty" ? r.counterparty : r.account) ?? "";
    const val = raw.trim().toLowerCase();
    const inList = set.has(val);
    const flag = def.mode === "deny" ? inList : !inList;
    if (!flag) continue;
    findings.push({
      ruleId: rule.id,
      code: rule.code,
      category: rule.category,
      severity: rule.severity,
      titleAr: rule.nameAr,
      descriptionAr:
        def.mode === "deny"
          ? `${r.reference}: ${def.field === "counterparty" ? "الطرف المقابل" : "الحساب"} "${raw || "—"}" ضمن القائمة المحظورة.`
          : `${r.reference}: ${def.field === "counterparty" ? "الطرف المقابل" : "الحساب"} "${raw || "—"}" غير مُدرَج في القائمة المعتمدة.`,
      transactionIds: [r.id],
      evidence: { field: def.field, mode: def.mode, value: raw },
    });
  }
  return findings;
}

function evalMissingField(
  rule: AuditRuleSpec,
  def: MissingFieldDef,
  records: readonly RuleRecord[],
): RuleFinding[] {
  const label: Record<MissingFieldDef["field"], string> = {
    counterparty: "الطرف المقابل",
    account: "الحساب",
    vatAmount: "قيمة الضريبة",
    document: "المستند الداعم",
    valueDate: "تاريخ القيمة",
  };
  const isMissing = (r: RuleRecord): boolean => {
    switch (def.field) {
      case "counterparty":
        return !r.counterparty || r.counterparty.trim() === "";
      case "account":
        return !r.account || r.account.trim() === "";
      case "vatAmount":
        return r.vatAmount === null || r.vatAmount === undefined;
      case "document":
        return r.hasDocument === false;
      case "valueDate":
        return !r.valueDate;
      default:
        return false;
    }
  };
  const findings: RuleFinding[] = [];
  for (const r of records) {
    if (!isMissing(r)) continue;
    findings.push({
      ruleId: rule.id,
      code: rule.code,
      category: rule.category,
      severity: rule.severity,
      titleAr: rule.nameAr,
      descriptionAr: `${r.reference}: ${label[def.field]} مفقود.`,
      transactionIds: [r.id],
      evidence: { field: def.field },
    });
  }
  return findings;
}

function evalTimeWindow(
  rule: AuditRuleSpec,
  def: TimeWindowDef,
  records: readonly RuleRecord[],
): RuleFinding[] {
  const tz = def.timeZone ?? DEFAULT_TZ;
  const start = def.businessStartHour ?? 7;
  const end = def.businessEndHour ?? 19;
  const weekend = new Set(def.weekendDays ?? [5, 6]);
  const findings: RuleFinding[] = [];
  for (const r of records) {
    const { hour, weekday } = zonedParts(r.postedAt, tz);
    const hit =
      def.kind === "weekend"
        ? weekend.has(weekday)
        : hour < start || hour >= end;
    if (!hit) continue;
    findings.push({
      ruleId: rule.id,
      code: rule.code,
      category: rule.category,
      severity: rule.severity,
      titleAr: rule.nameAr,
      descriptionAr:
        def.kind === "weekend"
          ? `${r.reference}: قيد في عطلة نهاية الأسبوع.`
          : `${r.reference}: قيد الساعة ${hour.toString().padStart(2, "0")}:00 خارج ساعات العمل (${start}:00–${end}:00).`,
      transactionIds: [r.id],
      evidence: { kind: def.kind, hour, weekday },
    });
  }
  return findings;
}

function groupKey(
  r: RuleRecord,
  fields: AggregateDef["groupBy"],
): string {
  return fields
    .map((f) => {
      switch (f) {
        case "counterparty":
          return (r.counterparty ?? "").trim().toLowerCase();
        case "account":
          return (r.account ?? "").trim().toLowerCase();
        case "amount":
          return String(toMinorUnits(r.amount));
        case "reference":
          return r.reference.trim().toLowerCase();
        default:
          return "";
      }
    })
    .join("::");
}

function evalAggregate(
  rule: AuditRuleSpec,
  def: AggregateDef,
  records: readonly RuleRecord[],
): RuleFinding[] {
  const groups = new Map<string, RuleRecord[]>();
  for (const r of records) {
    const key = groupKey(r, def.groupBy);
    const bucket = groups.get(key);
    if (bucket) bucket.push(r);
    else groups.set(key, [r]);
  }

  const windowMs = def.windowDays ? def.windowDays * DAY_MS : null;
  const findings: RuleFinding[] = [];

  for (const bucket of groups.values()) {
    // Optionally restrict to records within a rolling time window.
    let members = bucket;
    if (windowMs !== null && bucket.length > 1) {
      const sorted = [...bucket].sort(
        (a, b) => new Date(a.postedAt).getTime() - new Date(b.postedAt).getTime(),
      );
      const first = new Date(sorted[0]!.postedAt).getTime();
      members = sorted.filter(
        (r) => new Date(r.postedAt).getTime() - first <= windowMs,
      );
    }

    const aggValue =
      def.agg === "count"
        ? members.length
        : members.reduce((sum, r) => sum + toMinorUnits(r.amount), 0);
    const threshold = def.agg === "sum" ? Math.round(def.value * 100) : def.value;
    const threshold2 =
      def.value2 !== undefined
        ? def.agg === "sum"
          ? Math.round(def.value2 * 100)
          : def.value2
        : undefined;

    if (!cmp(def.op, aggValue, threshold, threshold2)) continue;

    const shown =
      def.agg === "sum" ? minorUnitsToString(aggValue) : String(aggValue);
    findings.push({
      ruleId: rule.id,
      code: rule.code,
      category: rule.category,
      severity: rule.severity,
      titleAr: rule.nameAr,
      descriptionAr: `مجموعة (${def.groupBy.join("، ")}): ${def.agg === "sum" ? "المجموع" : "العدد"} = ${shown} ${OP_LABEL_AR[def.op]} ${def.value}${def.windowDays ? ` خلال ${def.windowDays} يوم` : ""}.`,
      transactionIds: members.map((m) => m.id),
      evidence: { agg: def.agg, groupBy: def.groupBy, value: shown, count: members.length },
    });
  }
  return findings;
}

/** Evaluate a single rule against the records. */
export function evaluateRule(
  rule: AuditRuleSpec,
  records: readonly RuleRecord[],
): RuleFinding[] {
  switch (rule.definition.type) {
    case "field_compare":
      return evalFieldCompare(rule, rule.definition, records);
    case "round_amount":
      return evalRoundAmount(rule, rule.definition, records);
    case "threshold_avoidance":
      return evalThresholdAvoidance(rule, rule.definition, records);
    case "value_list":
      return evalValueList(rule, rule.definition, records);
    case "missing_field":
      return evalMissingField(rule, rule.definition, records);
    case "time_window":
      return evalTimeWindow(rule, rule.definition, records);
    case "aggregate":
      return evalAggregate(rule, rule.definition, records);
    default:
      return [];
  }
}

/** Evaluate every rule and return all findings. */
export function evaluateRules(
  records: readonly RuleRecord[],
  rules: readonly AuditRuleSpec[],
): RuleFinding[] {
  const findings: RuleFinding[] = [];
  for (const rule of rules) {
    findings.push(...evaluateRule(rule, records));
  }
  return findings;
}
