import type { Locale } from "./config";

/**
 * UI message catalog. Arabic is the source of truth; English mirrors it key-for-key.
 * Phase 1 covers the application shell (navigation, header, screen titles). Screen
 * bodies are migrated to these keys screen-by-screen in later phases.
 *
 * Keys are dotted for grouping only; there is no nesting. A missing key falls back
 * to the key string itself (see `use-t.ts`), so an untranslated string is visible
 * rather than silently blank.
 */
const ar = {
  // Brand
  "brand.name": "مدقق مالي",
  "brand.tagline": "لوحة التدقيق الذكية",
  "brand.version": "الإصدار 0.1.0 — نسخة تجريبية (MVP)",

  // Language switcher
  "lang.label": "اللغة",
  "lang.switchTo": "التبديل إلى الإنجليزية",

  // Sidebar navigation
  "nav.dashboard": "لوحة التحكم",
  "nav.documents": "المستندات",
  "nav.reconciliation": "المطابقة",
  "nav.rules": "قواعد التدقيق",
  "nav.anomalies": "الحالات الشاذة",
  "nav.auditTests": "اختبارات التدقيق",
  "nav.runs": "عمليات التدقيق",
  "nav.auditResults": "مؤشّرات التدقيق",
  "nav.findings": "نتائج التدقيق",
  "nav.analytics": "التحليلات",
  "nav.auditLog": "سجل التدقيق",
  "nav.settings": "الإعدادات",
  "nav.guide": "دليل الاستخدام",
  "nav.comingSoon": "قريباً",
  "nav.primary": "التنقل الرئيسي",

  // Header
  "header.toggleSidebar": "تبديل القائمة الجانبية",
  "header.search": "بحث سريع...",
  "header.notifications": "الإشعارات",

  // Screen titles + subtitles
  "page.dashboard.title": "لوحة التدقيق",
  "page.dashboard.subtitle": "رصد الحالات الشاذة في القيود والمعاملات المالية لحظياً.",
  "page.documents.title": "المستندات",
  "page.documents.subtitle": "رفع المستندات المالية وتحليلها آلياً (OCR) لاستخراج الحركات.",
  "page.reconciliation.title": "المطابقة",
  "page.reconciliation.subtitle": "مطابقة الحركات البنكية مع قيود دفتر الأستاذ وإبراز غير المطابَق.",
  "page.rules.title": "قواعد التدقيق",
  "page.rules.subtitle": "محرّك قواعد حتمي: عرّف القوانين والإجراءات، ثم شغّل التدقيق لتطبيقها على المعاملات — بدون ذكاء اصطناعي، وكل نتيجة قابلة للتفسير.",
  "page.anomalies.title": "الحالات الشاذة",
  "page.anomalies.subtitle": "جميع الحالات الشاذة المرصودة مع الفلترة والتصدير والمعالجة.",
  "page.auditTests.title": "اختبارات التدقيق",
  "page.auditTests.subtitle": "أنشئ اختبارات التدقيق التي يطبّقها المحرّك على البيانات المستوردة، وفعّلها لتصبح متاحة للاختيار عند تجهيز نطاق الفحص في عملية التدقيق.",
  "page.runs.title": "عمليات التدقيق",
  "page.runs.subtitle": "أنشئ عملية تدقيق، اختر البيانات المستوردة واختبارات التدقيق، ابدأ تجهيز نطاق الفحص، ثم اعتمد وأرسل للتنفيذ في الخلفية، وراجع المؤشّرات.",
  "page.auditResults.title": "مؤشّرات التدقيق",
  "page.auditResults.subtitle": "مؤشّرات محرّك التدقيق (G4) مع حالتها المهنية — سجّل حكمًا على أي مؤشّر أو حوّله إلى مسألة تدقيق مباشرةً.",
  "page.findings.title": "نتائج التدقيق",
  "page.findings.subtitle": "إدارة مسائل التدقيق وتحويلها إلى نتائج تدقيق موثّقة، مع دورة إعداد ومراجعة واعتماد.",
  "page.analytics.title": "التحليلات",
  "page.analytics.subtitle": "تحليل قانون بنفورد لتوزيع الأرقام الأولى في قيم المعاملات.",
  "page.auditLog.title": "سجل التدقيق",
  "page.auditLog.subtitle": "سجل زمني غير قابل للتعديل لكل إجراءات المستخدمين على المهمة.",
  "page.settings.title": "الإعدادات",
  "page.settings.subtitle": "معلومات المكتب ومعاملات التدقيق الافتراضية.",
  "page.guide.title": "دليل الاستخدام",
  "page.guide.subtitle": "جولة كاملة عبر جميع وحدات النظام، مرتّبة حسب دورة عمل التدقيق — من إدخال البيانات إلى اعتماد النتائج.",
} as const;

export type MessageKey = keyof typeof ar;

const en: Record<MessageKey, string> = {
  "brand.name": "Financial Auditor",
  "brand.tagline": "Smart Audit Dashboard",
  "brand.version": "Version 0.1.0 — Preview (MVP)",

  "lang.label": "Language",
  "lang.switchTo": "Switch to Arabic",

  "nav.dashboard": "Dashboard",
  "nav.documents": "Documents",
  "nav.reconciliation": "Reconciliation",
  "nav.rules": "Audit Rules",
  "nav.anomalies": "Anomalies",
  "nav.auditTests": "Audit Tests",
  "nav.runs": "Audit Runs",
  "nav.auditResults": "Audit Indicators",
  "nav.findings": "Audit Findings",
  "nav.analytics": "Analytics",
  "nav.auditLog": "Audit Log",
  "nav.settings": "Settings",
  "nav.guide": "User Guide",
  "nav.comingSoon": "Coming soon",
  "nav.primary": "Primary navigation",

  "header.toggleSidebar": "Toggle sidebar",
  "header.search": "Quick search...",
  "header.notifications": "Notifications",

  "page.dashboard.title": "Audit Dashboard",
  "page.dashboard.subtitle": "Real-time detection of anomalies in financial entries and transactions.",
  "page.documents.title": "Documents",
  "page.documents.subtitle": "Upload financial documents and analyze them automatically (OCR) to extract transactions.",
  "page.reconciliation.title": "Reconciliation",
  "page.reconciliation.subtitle": "Match bank transactions against general-ledger entries and surface the unmatched.",
  "page.rules.title": "Audit Rules",
  "page.rules.subtitle": "A deterministic rules engine: define rules and actions, then run the audit to apply them to transactions — no AI, and every result is explainable.",
  "page.anomalies.title": "Anomalies",
  "page.anomalies.subtitle": "All detected anomalies with filtering, export, and resolution.",
  "page.auditTests.title": "Audit Tests",
  "page.auditTests.subtitle": "Create the audit tests the engine applies to imported data, and activate them so they can be selected when scoping an audit run.",
  "page.runs.title": "Audit Runs",
  "page.runs.subtitle": "Create an audit run, choose the imported data and audit tests, start scoping, then approve and dispatch for background execution, and review the indicators.",
  "page.auditResults.title": "Audit Indicators",
  "page.auditResults.subtitle": "Indicators from the audit engine (G4) with their professional state — record a judgment on any indicator or turn it into an audit matter directly.",
  "page.findings.title": "Audit Findings",
  "page.findings.subtitle": "Manage audit matters and turn them into documented audit findings, through a prepare–review–approve cycle.",
  "page.analytics.title": "Analytics",
  "page.analytics.subtitle": "Benford's Law analysis of the leading-digit distribution of transaction values.",
  "page.auditLog.title": "Audit Log",
  "page.auditLog.subtitle": "An immutable, time-ordered record of every user action on the engagement.",
  "page.settings.title": "Settings",
  "page.settings.subtitle": "Firm information and default audit parameters.",
  "page.guide.title": "User Guide",
  "page.guide.subtitle": "A full tour of every module, ordered by the audit workflow — from data entry to approved findings.",
};

export const messages: Record<Locale, Record<MessageKey, string>> = { ar, en };
