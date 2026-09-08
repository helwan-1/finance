/** auditResults message dictionary. Arabic source of truth; English mirrors key-for-key. */
export const auditResultsAr = {
  "auditResults.loadError": "فشل تحميل مؤشّرات التدقيق",
  "auditResults.detailLoadError": "فشل تحميل تفاصيل المؤشّر",
  "auditResults.allStates": "كل الحالات",
  "auditResults.dispositionError": "فشل تسجيل الحكم",
  "auditResults.filterByState": "تصفية حسب الحالة",
  "auditResults.resultCount": "{count} مؤشّر",
  "auditResults.selectEngagement": "اختر ارتباطًا من الأعلى لعرض المؤشّرات.",
  "auditResults.loading": "جارٍ التحميل…",
  "auditResults.loadFailed": "تعذّر تحميل البيانات. حاول مرة أخرى.",
  "auditResults.noResults":
    "لا توجد مؤشّرات تدقيق مطابقة. شغّل محرّك التدقيق (G4) لإنتاج مؤشّرات.",

  // Result row
  "auditResults.hideDetails": "إخفاء التفاصيل",
  "auditResults.showDetails": "عرض التفاصيل",
  "auditResults.row.score": "درجة {score}",
  "auditResults.details": "التفاصيل",
  "auditResults.recordJudgment": "تسجيل حكم",
  "auditResults.judgmentPlaceholder": "— حكم —",
  "auditResults.alreadyLinked": "مرتبطة بمسألة تدقيق بالفعل",
  "auditResults.openMatter": "فتح مسألة تدقيق",

  // Result detail
  "auditResults.detail.type": "النوع: {kind}",
  "auditResults.detail.severity": "الخطورة: {severity}",
  "auditResults.detail.score": "الدرجة: {score}",
  "auditResults.detail.fingerprint": "البصمة: {fp}…",
  "auditResults.detail.loadingEvidence": "جارٍ تحميل الدليل…",
  "auditResults.detail.loadFailed": "تعذّر تحميل التفاصيل.",
  "auditResults.detail.noEvidence": "لا يوجد دليل مرتبط بهذا المؤشّر.",
  "auditResults.detail.evidenceHeading": "الدليل — السجلات المصدرية ({count})",
  "auditResults.detail.row": "صف {n}",
  "auditResults.detail.noCells": "لا تتوفّر خلايا مصدرية لهذا الدليل.",
} as const;

export const auditResultsEn: Record<keyof typeof auditResultsAr, string> = {
  "auditResults.loadError": "Failed to load audit indicators",
  "auditResults.detailLoadError": "Failed to load indicator details",
  "auditResults.allStates": "All states",
  "auditResults.dispositionError": "Failed to record the judgment",
  "auditResults.filterByState": "Filter by state",
  "auditResults.resultCount": "{count} indicators",
  "auditResults.selectEngagement": "Select an engagement above to view indicators.",
  "auditResults.loading": "Loading…",
  "auditResults.loadFailed": "Could not load data. Try again.",
  "auditResults.noResults":
    "No matching audit indicators. Run the audit engine (G4) to produce indicators.",

  "auditResults.hideDetails": "Hide details",
  "auditResults.showDetails": "Show details",
  "auditResults.row.score": "Score {score}",
  "auditResults.details": "Details",
  "auditResults.recordJudgment": "Record a judgment",
  "auditResults.judgmentPlaceholder": "— Judgment —",
  "auditResults.alreadyLinked": "Already linked to an audit matter",
  "auditResults.openMatter": "Open audit matter",

  "auditResults.detail.type": "Type: {kind}",
  "auditResults.detail.severity": "Severity: {severity}",
  "auditResults.detail.score": "Score: {score}",
  "auditResults.detail.fingerprint": "Fingerprint: {fp}…",
  "auditResults.detail.loadingEvidence": "Loading evidence…",
  "auditResults.detail.loadFailed": "Could not load details.",
  "auditResults.detail.noEvidence": "No evidence linked to this indicator.",
  "auditResults.detail.evidenceHeading": "Evidence — source records ({count})",
  "auditResults.detail.row": "row {n}",
  "auditResults.detail.noCells": "No source cells available for this evidence.",
};
