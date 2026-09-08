/** anomalies message dictionary. Arabic source of truth; English mirrors key-for-key. */
export const anomaliesAr = {
  // Feed (anomalies-feed.tsx)
  "anomalies.feed.loading": "جارٍ تحميل الحالات الشاذة...",
  "anomalies.feed.error": "تعذّر تحميل البيانات. حاول مرة أخرى.",
  "anomalies.feed.empty": "لا توجد حالات شاذة مطابقة للمرشحات الحالية.",
  "anomalies.feed.count": "{count} حالة شاذة",

  // Card (anomaly-card.tsx)
  "anomalies.card.reference": "المرجع:",
  "anomalies.card.amount": "المبلغ:",
  "anomalies.card.counterparty": "الطرف المقابل:",
  "anomalies.card.details": "التفاصيل",
  "anomalies.card.score": "الدرجة",

  // Resolution actions (shared: resolution-actions.tsx + anomaly-detail-dialog.tsx)
  "anomalies.action.resolve": "معالجة",
  "anomalies.action.dismiss": "استبعاد",
  "anomalies.action.escalate": "تصعيد",
  "anomalies.action.updateError": "تعذّر التحديث",

  // Detail dialog (anomaly-detail-dialog.tsx)
  "anomalies.detail.title": "تفاصيل الحالة الشاذة",
  "anomalies.detail.loading": "جارٍ التحميل…",
  "anomalies.detail.loadError": "تعذّر تحميل التفاصيل.",
  "anomalies.detail.updateError": "تعذّر تحديث الحالة",
  "anomalies.detail.score": "الدرجة:",
  "anomalies.detail.detectedAt": "اكتُشفت:",
  "anomalies.detail.sectionTransaction": "المعاملة المرتبطة",
  "anomalies.detail.sectionEvidence": "الأدلة",
  "anomalies.detail.sectionResolution": "المعالجة",
  "anomalies.detail.fieldReference": "المرجع",
  "anomalies.detail.fieldDescription": "الوصف",
  "anomalies.detail.fieldAmount": "المبلغ",
  "anomalies.detail.fieldVat": "ضريبة القيمة المضافة",
  "anomalies.detail.fieldType": "النوع",
  "anomalies.detail.fieldSource": "المصدر",
  "anomalies.detail.fieldCounterparty": "الطرف المقابل",
  "anomalies.detail.fieldAccount": "الحساب",
  "anomalies.detail.fieldPostedAt": "تاريخ القيد",
  "anomalies.detail.fieldValueDate": "تاريخ القيمة",
  "anomalies.detail.fieldBy": "بواسطة",
  "anomalies.detail.fieldDate": "التاريخ",
  "anomalies.detail.fieldNote": "ملاحظة",

  // Export buttons (export-buttons.tsx)
  "anomalies.export.excel": "تصدير Excel",
  "anomalies.export.pdf": "تصدير PDF",
  "anomalies.export.error": "تعذّر التصدير",

  // Filter bar (filter-bar.tsx)
  "anomalies.filter.search": "بحث",
  "anomalies.filter.searchPlaceholder": "المرجع، الوصف، الطرف المقابل...",
  "anomalies.filter.severity": "الخطورة",
  "anomalies.filter.all": "الكل",
  "anomalies.filter.ruleType": "نوع القاعدة",
  "anomalies.filter.status": "الحالة",
  "anomalies.filter.fromDate": "من تاريخ",
  "anomalies.filter.toDate": "إلى تاريخ",
  "anomalies.filter.reset": "إعادة تعيين",

  // Stat cards (stat-cards.tsx)
  "anomalies.stat.critical": "حالات حرجة",
  "anomalies.stat.high": "خطورة عالية",
  "anomalies.stat.open": "قيد المتابعة",
  "anomalies.stat.resolved": "تمت المعالجة",
} as const;

export const anomaliesEn: Record<keyof typeof anomaliesAr, string> = {
  "anomalies.feed.loading": "Loading anomalies...",
  "anomalies.feed.error": "Failed to load data. Please try again.",
  "anomalies.feed.empty": "No anomalies match the current filters.",
  "anomalies.feed.count": "{count} anomalies",

  "anomalies.card.reference": "Reference:",
  "anomalies.card.amount": "Amount:",
  "anomalies.card.counterparty": "Counterparty:",
  "anomalies.card.details": "Details",
  "anomalies.card.score": "Score",

  "anomalies.action.resolve": "Resolve",
  "anomalies.action.dismiss": "Dismiss",
  "anomalies.action.escalate": "Escalate",
  "anomalies.action.updateError": "Update failed",

  "anomalies.detail.title": "Anomaly details",
  "anomalies.detail.loading": "Loading…",
  "anomalies.detail.loadError": "Failed to load details.",
  "anomalies.detail.updateError": "Failed to update the case.",
  "anomalies.detail.score": "Score:",
  "anomalies.detail.detectedAt": "Detected:",
  "anomalies.detail.sectionTransaction": "Related transaction",
  "anomalies.detail.sectionEvidence": "Evidence",
  "anomalies.detail.sectionResolution": "Resolution",
  "anomalies.detail.fieldReference": "Reference",
  "anomalies.detail.fieldDescription": "Description",
  "anomalies.detail.fieldAmount": "Amount",
  "anomalies.detail.fieldVat": "VAT",
  "anomalies.detail.fieldType": "Type",
  "anomalies.detail.fieldSource": "Source",
  "anomalies.detail.fieldCounterparty": "Counterparty",
  "anomalies.detail.fieldAccount": "Account",
  "anomalies.detail.fieldPostedAt": "Posting date",
  "anomalies.detail.fieldValueDate": "Value date",
  "anomalies.detail.fieldBy": "By",
  "anomalies.detail.fieldDate": "Date",
  "anomalies.detail.fieldNote": "Note",

  "anomalies.export.excel": "Export Excel",
  "anomalies.export.pdf": "Export PDF",
  "anomalies.export.error": "Export failed",

  "anomalies.filter.search": "Search",
  "anomalies.filter.searchPlaceholder": "Reference, description, counterparty...",
  "anomalies.filter.severity": "Severity",
  "anomalies.filter.all": "All",
  "anomalies.filter.ruleType": "Rule type",
  "anomalies.filter.status": "Status",
  "anomalies.filter.fromDate": "From date",
  "anomalies.filter.toDate": "To date",
  "anomalies.filter.reset": "Reset",

  "anomalies.stat.critical": "Critical cases",
  "anomalies.stat.high": "High severity",
  "anomalies.stat.open": "In progress",
  "anomalies.stat.resolved": "Resolved",
};
