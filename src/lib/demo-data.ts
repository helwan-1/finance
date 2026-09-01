import type { AnomalyDTO, EngagementSummary } from "./ui-types";

/**
 * In-memory demo dataset. Used by the anomalies API as a fallback when no
 * database is provisioned, so the dashboard renders end-to-end out of the box.
 * Mirrors the shape the seed script produces.
 */

export const DEMO_ENGAGEMENTS: EngagementSummary[] = [
  {
    id: "eng-nakheel-2025",
    titleAr: "المراجعة النظامية للسنة المالية 2025",
    clientNameAr: "شركة النخيل للتجزئة",
    fiscalYear: 2025,
  },
  {
    id: "eng-afaq-2024",
    titleAr: "مراجعة القوائم المالية 2024",
    clientNameAr: "شركة الأفق القابضة",
    fiscalYear: 2024,
  },
];

export const DEMO_ANOMALIES: AnomalyDTO[] = [
  {
    id: "an-001",
    ruleCode: "BENFORD_DEVIATION",
    severity: "HIGH",
    status: "OPEN",
    title: "Benford's Law deviation detected",
    titleAr: "انحراف عن قانون بنفورد",
    description:
      "First-digit distribution rejects Benford's Law (χ² = 34.11 > 15.507, n = 126).",
    descriptionAr:
      "توزيع الرقم الأول لا يتوافق مع قانون بنفورد (مربع كاي = 34.11 أكبر من 15.507، عدد العينات = 126).",
    score: "78.00",
    detectedAt: "2026-08-30T08:15:00Z",
    reference: null,
    amount: null,
    counterparty: null,
  },
  {
    id: "an-002",
    ruleCode: "DUPLICATE_EXACT",
    severity: "HIGH",
    status: "OPEN",
    title: "Exact duplicate transactions",
    titleAr: "معاملات مكررة تماماً",
    description:
      '2 transactions share the same amount, counterparty and reference "INV-7781".',
    descriptionAr:
      '2 معاملات لها نفس المبلغ والطرف المقابل والمرجع "INV-7781".',
    score: "85.00",
    detectedAt: "2026-08-30T08:15:03Z",
    reference: "INV-7781",
    amount: "48250.00",
    counterparty: "شركة الأفق للتجارة",
  },
  {
    id: "an-003",
    ruleCode: "OFF_HOURS_ENTRY",
    severity: "MEDIUM",
    status: "IN_REVIEW",
    title: "Off-hours entry",
    titleAr: "قيد خارج ساعات العمل",
    description:
      "Transaction JV-9001 was posted at 03:00, outside business hours (7:00–19:00).",
    descriptionAr:
      "تم تسجيل المعاملة JV-9001 الساعة 03:00، خارج ساعات العمل (7:00–19:00).",
    score: "55.00",
    detectedAt: "2026-08-30T08:15:05Z",
    reference: "JV-9001",
    amount: "275000.00",
    counterparty: "مؤسسة الإتقان",
  },
  {
    id: "an-004",
    ruleCode: "DUPLICATE_NEAR",
    severity: "MEDIUM",
    status: "OPEN",
    title: "Near-duplicate transactions",
    titleAr: "معاملات شبه مكررة",
    description:
      "Two transactions with identical amount and counterparty posted 24h apart with different references (INV-8010, INV-8044).",
    descriptionAr:
      "معاملتان بنفس المبلغ والطرف المقابل بفارق 24 ساعة بمرجعين مختلفين (INV-8010، INV-8044).",
    score: "65.00",
    detectedAt: "2026-08-30T08:15:04Z",
    reference: "INV-8010",
    amount: "19900.00",
    counterparty: "مصنع الرواد",
  },
  {
    id: "an-005",
    ruleCode: "WEEKEND_ENTRY",
    severity: "LOW",
    status: "RESOLVED",
    title: "Weekend entry",
    titleAr: "قيد في عطلة نهاية الأسبوع",
    description: "Transaction JV-9002 was posted on a weekend day.",
    descriptionAr: "تم تسجيل المعاملة JV-9002 في يوم عطلة نهاية الأسبوع.",
    score: "45.00",
    detectedAt: "2026-08-30T08:15:06Z",
    reference: "JV-9002",
    amount: "66000.00",
    counterparty: "شركة الخليج للخدمات",
  },
  {
    id: "an-006",
    ruleCode: "VAT_DISCREPANCY",
    severity: "CRITICAL",
    status: "ESCALATED",
    title: "VAT discrepancy",
    titleAr: "فرق في ضريبة القيمة المضافة",
    description:
      "Declared VAT does not match 15% of the taxable base for invoice INV-6620.",
    descriptionAr:
      "ضريبة القيمة المضافة المصرّح بها لا تطابق 15% من الوعاء الضريبي للفاتورة INV-6620.",
    score: "92.00",
    detectedAt: "2026-08-30T08:14:59Z",
    reference: "INV-6620",
    amount: "131500.00",
    counterparty: "مؤسسة النخبة",
  },
];
