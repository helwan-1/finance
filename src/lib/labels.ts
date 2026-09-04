import type {
  AnomalyRuleCode,
  AnomalySeverity,
  AnomalyStatus,
  DispositionActionKind,
  DispositionStateKind,
  DocumentStatus,
  DocumentType,
  ExceptionStatus,
  FindingStatus,
  MatterPriority,
  ReconMatchStatus,
} from "./ui-types";

/** Arabic display labels for enums used across the UI. */

export const SEVERITY_LABELS_AR: Record<AnomalySeverity, string> = {
  CRITICAL: "حرجة",
  HIGH: "عالية",
  MEDIUM: "متوسطة",
  LOW: "منخفضة",
  INFO: "معلومة",
};

export const STATUS_LABELS_AR: Record<AnomalyStatus, string> = {
  OPEN: "مفتوحة",
  IN_REVIEW: "قيد المراجعة",
  RESOLVED: "تمت المعالجة",
  DISMISSED: "مستبعدة",
  ESCALATED: "مُصعّدة",
};

export const RULE_LABELS_AR: Record<AnomalyRuleCode, string> = {
  BENFORD_DEVIATION: "انحراف قانون بنفورد",
  DUPLICATE_EXACT: "تكرار تام",
  DUPLICATE_NEAR: "تكرار تقريبي",
  OFF_HOURS_ENTRY: "قيد خارج الدوام",
  WEEKEND_ENTRY: "قيد في عطلة الأسبوع",
  VAT_DISCREPANCY: "فرق ضريبة القيمة المضافة",
  ROUND_AMOUNT: "مبلغ مُدوَّر",
  UNRECONCILED: "غير مطابَق",
  THRESHOLD_AVOIDANCE: "التفاف على حد الاعتماد",
  GAP_SEQUENCE: "فجوة في التسلسل",
  DENYLIST_PARTY: "طرف محظور",
  MISSING_FIELD: "حقل مفقود",
  BACKDATED_ENTRY: "قيد بأثر رجعي",
  CUSTOM_RULE: "قاعدة مخصّصة",
};

/** Tailwind classes for severity badges. */
export const SEVERITY_BADGE: Record<AnomalySeverity, string> = {
  CRITICAL: "bg-severity-critical/10 text-severity-critical ring-severity-critical/30",
  HIGH: "bg-severity-high/10 text-severity-high ring-severity-high/30",
  MEDIUM: "bg-severity-medium/10 text-severity-medium ring-severity-medium/30",
  LOW: "bg-severity-low/10 text-severity-low ring-severity-low/30",
  INFO: "bg-severity-info/10 text-severity-info ring-severity-info/30",
};

export const MATCH_STATUS_LABELS_AR: Record<ReconMatchStatus, string> = {
  MATCHED: "مطابَقة",
  PARTIAL: "مطابقة جزئية",
  UNMATCHED: "غير مطابَقة",
};

export const MATCH_STATUS_BADGE: Record<ReconMatchStatus, string> = {
  MATCHED: "bg-severity-low/10 text-severity-low ring-severity-low/30",
  PARTIAL: "bg-severity-medium/10 text-severity-medium ring-severity-medium/30",
  UNMATCHED: "bg-severity-critical/10 text-severity-critical ring-severity-critical/30",
};

export const RULE_CATEGORY_LABELS_AR: Record<string, string> = {
  NUMERIC: "حدود ومقارنات رقمية",
  PARTY: "أطراف وبيانات",
  TIMING: "توقيت وتواريخ",
  AGGREGATE: "تجميع وتكرار",
};

export const ROLE_LABELS_AR: Record<string, string> = {
  ADMIN: "مدير النظام",
  PARTNER: "شريك",
  MANAGER: "مدير مهمة",
  SENIOR: "مدقق أول",
  STAFF: "مدقق",
  REVIEWER: "مراجع",
};

export const DOCUMENT_TYPE_LABELS_AR: Record<DocumentType, string> = {
  INVOICE: "فاتورة",
  BANK_STATEMENT: "كشف حساب بنكي",
  VAT_RETURN: "إقرار ضريبة القيمة المضافة",
  GENERAL_LEDGER: "دفتر الأستاذ العام",
  PURCHASE_ORDER: "أمر شراء",
  RECEIPT: "سند قبض",
  OTHER: "أخرى",
};

export const DOCUMENT_STATUS_LABELS_AR: Record<DocumentStatus, string> = {
  UPLOADED: "تم الرفع",
  PROCESSING: "قيد المعالجة",
  PARSED: "تم التحليل",
  FAILED: "فشل",
  ARCHIVED: "مؤرشف",
};

export const DOCUMENT_STATUS_BADGE: Record<DocumentStatus, string> = {
  UPLOADED: "bg-severity-info/10 text-severity-info ring-severity-info/30",
  PROCESSING: "bg-severity-medium/10 text-severity-medium ring-severity-medium/30",
  PARSED: "bg-severity-low/10 text-severity-low ring-severity-low/30",
  FAILED: "bg-severity-critical/10 text-severity-critical ring-severity-critical/30",
  ARCHIVED: "bg-black/5 text-[rgb(var(--muted))] ring-black/10 dark:bg-white/5",
};

/** Arabic labels for audit-trail action codes. */
export const AUDIT_ACTION_LABELS_AR: Record<string, string> = {
  VIEW_DOCUMENT: "عرض مستند",
  DOWNLOAD_DOCUMENT: "تنزيل مستند",
  RESOLVE_ANOMALY: "معالجة حالة شاذة",
  DISMISS_ANOMALY: "استبعاد حالة شاذة",
  ESCALATE_ANOMALY: "تصعيد حالة شاذة",
  EXPORT_DATA: "تصدير بيانات",
  RUN_RECONCILIATION: "تشغيل المطابقة",
  RUN_ANALYSIS: "تشغيل التحليل",
  LOGIN: "تسجيل دخول",
  LOGOUT: "تسجيل خروج",
};

export const SEVERITY_BAR: Record<AnomalySeverity, string> = {
  CRITICAL: "bg-severity-critical",
  HIGH: "bg-severity-high",
  MEDIUM: "bg-severity-medium",
  LOW: "bg-severity-low",
  INFO: "bg-severity-info",
};

// ---- G5: exceptions (matters), findings & priorities ----

export const EXCEPTION_STATUS_LABELS_AR: Record<ExceptionStatus, string> = {
  OPEN: "مفتوحة",
  UNDER_INVESTIGATION: "قيد الفحص",
  CONCLUDED_WITH_FINDING: "منتهية بنتيجة",
  CLOSED_NO_FINDING: "مغلقة بلا نتيجة",
};

export const EXCEPTION_STATUS_BADGE: Record<ExceptionStatus, string> = {
  OPEN: "bg-severity-info/10 text-severity-info ring-severity-info/30",
  UNDER_INVESTIGATION:
    "bg-severity-medium/10 text-severity-medium ring-severity-medium/30",
  CONCLUDED_WITH_FINDING:
    "bg-severity-critical/10 text-severity-critical ring-severity-critical/30",
  CLOSED_NO_FINDING:
    "bg-black/5 text-[rgb(var(--muted))] ring-black/10 dark:bg-white/5",
};

export const FINDING_STATUS_LABELS_AR: Record<FindingStatus, string> = {
  DRAFT: "مسودة",
  IN_REVIEW: "قيد المراجعة",
  CONCLUDED: "معتمدة",
  WITHDRAWN: "مسحوبة",
};

export const FINDING_STATUS_BADGE: Record<FindingStatus, string> = {
  DRAFT: "bg-black/5 text-[rgb(var(--muted))] ring-black/10 dark:bg-white/5",
  IN_REVIEW: "bg-severity-medium/10 text-severity-medium ring-severity-medium/30",
  CONCLUDED: "bg-severity-low/10 text-severity-low ring-severity-low/30",
  WITHDRAWN: "bg-severity-critical/10 text-severity-critical ring-severity-critical/30",
};

export const MATTER_PRIORITY_LABELS_AR: Record<MatterPriority, string> = {
  LOW: "منخفضة",
  MEDIUM: "متوسطة",
  HIGH: "عالية",
};

export const MATTER_PRIORITY_BADGE: Record<MatterPriority, string> = {
  LOW: "bg-severity-low/10 text-severity-low ring-severity-low/30",
  MEDIUM: "bg-severity-medium/10 text-severity-medium ring-severity-medium/30",
  HIGH: "bg-severity-high/10 text-severity-high ring-severity-high/30",
};

// ---- G5: audit-result professional dispositions ----

export const DISPOSITION_STATE_LABELS_AR: Record<DispositionStateKind, string> = {
  UNREVIEWED: "لم تُراجَع",
  UNDER_REVIEW: "قيد المراجعة",
  DISPOSED: "تم البتّ فيها",
  INVESTIGATING: "قيد الفحص",
  LINKED: "مرتبطة بمسألة",
};

export const DISPOSITION_STATE_BADGE: Record<DispositionStateKind, string> = {
  UNREVIEWED: "bg-black/5 text-[rgb(var(--muted))] ring-black/10 dark:bg-white/5",
  UNDER_REVIEW: "bg-severity-medium/10 text-severity-medium ring-severity-medium/30",
  DISPOSED: "bg-severity-low/10 text-severity-low ring-severity-low/30",
  INVESTIGATING: "bg-severity-high/10 text-severity-high ring-severity-high/30",
  LINKED: "bg-severity-info/10 text-severity-info ring-severity-info/30",
};

export const DISPOSITION_ACTION_LABELS_AR: Record<DispositionActionKind, string> = {
  MARK_UNDER_REVIEW: "وضعها قيد المراجعة",
  MARK_NOT_RELEVANT: "غير ذات صلة",
  MARK_FALSE_POSITIVE: "إيجابية كاذبة",
  MARK_EXPLAINED: "مُفسَّرة",
  REQUIRE_INVESTIGATION: "تتطلّب فحصًا",
};
