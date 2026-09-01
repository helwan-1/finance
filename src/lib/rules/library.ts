import type { RuleCategory, RuleDefinition, RuleSeverity } from "./types";

/**
 * A starter library of professional, deterministic audit rules based on
 * established practice — computer-assisted audit techniques (CAATs), ISA 240
 * journal-entry testing, and common forensic/analytical tests. These are seeded
 * as firm-wide rules; auditors can disable, edit, or add their own.
 */
export interface RuleTemplate {
  code: string;
  name: string;
  nameAr: string;
  category: RuleCategory;
  severity: RuleSeverity;
  descriptionAr: string;
  definition: RuleDefinition;
}

export const PROFESSIONAL_RULES: RuleTemplate[] = [
  {
    code: "LARGE-ITEMS",
    name: "Large transactions",
    nameAr: "معاملات كبيرة القيمة",
    category: "NUMERIC",
    severity: "HIGH",
    descriptionAr:
      "اختبار البنود الكبيرة: مراجعة المعاملات التي تتجاوز حد الأهمية النسبية (100,000).",
    definition: { type: "field_compare", field: "amount", op: "gte", value: 100000 },
  },
  {
    code: "THRESHOLD-AVOID",
    name: "Authorization-limit avoidance (structuring)",
    nameAr: "الالتفاف على حد الاعتماد",
    category: "NUMERIC",
    severity: "HIGH",
    descriptionAr:
      "مبالغ أقل بقليل من حد الاعتماد (10,000) بهامش 5% — نمط تقسيم شائع لتفادي الموافقات (ISA 240).",
    definition: { type: "threshold_avoidance", limit: 10000, marginPct: 5 },
  },
  {
    code: "ROUND-AMOUNTS",
    name: "Round-number amounts",
    nameAr: "مبالغ مُدوَّرة",
    category: "NUMERIC",
    severity: "MEDIUM",
    descriptionAr:
      "مبالغ من مضاعفات 1,000 بالضبط — قد تدل على تقديرات يدوية أو قيود مُفتعَلة.",
    definition: { type: "round_amount", minTrailingZeros: 3 },
  },
  {
    code: "VAT-UNDER",
    name: "VAT ratio below standard",
    nameAr: "نسبة ضريبة أقل من المعياري",
    category: "NUMERIC",
    severity: "MEDIUM",
    descriptionAr:
      "نسبة ضريبة القيمة المضافة أقل من 14.5% من الوعاء — احتمال نقص في التصريح الضريبي (ZATCA).",
    definition: { type: "field_compare", field: "vatRatioPct", op: "lt", value: 14.5 },
  },
  {
    code: "OFF-HOURS",
    name: "Off-hours postings",
    nameAr: "قيود خارج ساعات العمل",
    category: "TIMING",
    severity: "MEDIUM",
    descriptionAr:
      "قيود مُسجَّلة خارج ساعات العمل (7ص–7م) — أحد مؤشرات تجاوز الضوابط في اختبار القيود.",
    definition: { type: "time_window", kind: "off_hours" },
  },
  {
    code: "WEEKEND",
    name: "Weekend postings",
    nameAr: "قيود في عطلة نهاية الأسبوع",
    category: "TIMING",
    severity: "LOW",
    descriptionAr: "قيود مُسجَّلة أيام الجمعة/السبت — تُراجَع ضمن اختبار توقيت القيود.",
    definition: { type: "time_window", kind: "weekend" },
  },
  {
    code: "FUTURE-DATE",
    name: "Future-dated value date",
    nameAr: "تاريخ قيمة مستقبلي",
    category: "TIMING",
    severity: "HIGH",
    descriptionAr:
      "تاريخ القيمة يسبق تاريخ القيد (قيمة مستقبلية) — مؤشر على قيود غير نظامية.",
    definition: { type: "field_compare", field: "valueVsPostedDays", op: "lt", value: 0 },
  },
  {
    code: "BACKDATED",
    name: "Backdated entries",
    nameAr: "قيود بأثر رجعي",
    category: "TIMING",
    severity: "MEDIUM",
    descriptionAr:
      "قيد مُسجَّل بعد أكثر من 30 يوماً من تاريخ القيمة — احتمال تأخير أو تلاعب بالتواريخ.",
    definition: { type: "field_compare", field: "valueVsPostedDays", op: "gt", value: 30 },
  },
  {
    code: "MISSING-DOC",
    name: "Missing supporting document",
    nameAr: "مستند داعم مفقود",
    category: "PARTY",
    severity: "MEDIUM",
    descriptionAr: "معاملة بلا مستند داعم مرتبط — نقص في اكتمال الأدلة.",
    definition: { type: "missing_field", field: "document" },
  },
  {
    code: "MISSING-CP",
    name: "Missing counterparty",
    nameAr: "طرف مقابل مفقود",
    category: "PARTY",
    severity: "MEDIUM",
    descriptionAr: "قيد بلا طرف مقابل — يعيق تتبّع المعاملة والتحقق منها.",
    definition: { type: "missing_field", field: "counterparty" },
  },
  {
    code: "DUP-PAYMENTS",
    name: "Duplicate payments",
    nameAr: "مدفوعات مكررة",
    category: "AGGREGATE",
    severity: "HIGH",
    descriptionAr:
      "معاملتان أو أكثر بنفس المبلغ ونفس الطرف المقابل — اختبار الدفع المزدوج (CAAT).",
    definition: {
      type: "aggregate",
      groupBy: ["amount", "counterparty"],
      agg: "count",
      op: "gte",
      value: 2,
    },
  },
  {
    code: "SPLIT-PAY",
    name: "Split payments to one party",
    nameAr: "مدفوعات مُقسَّمة لطرف واحد",
    category: "AGGREGATE",
    severity: "HIGH",
    descriptionAr:
      "مجموع مدفوعات نفس الطرف يتجاوز 50,000 خلال يوم واحد — نمط تقسيم لتجاوز حدود الاعتماد.",
    definition: {
      type: "aggregate",
      groupBy: ["counterparty"],
      agg: "sum",
      op: "gte",
      value: 50000,
      windowDays: 1,
    },
  },
];
