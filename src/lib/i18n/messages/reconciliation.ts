/** reconciliation message dictionary. Arabic source of truth; English mirrors key-for-key. */
export const reconciliationAr = {
  // Matches table column headers
  "reconciliation.col.sourceRef": "مرجع المصدر",
  "reconciliation.col.amount": "المبلغ",
  "reconciliation.col.targetRef": "مرجع الطرف المقابل",
  "reconciliation.col.status": "الحالة",
  "reconciliation.col.confidence": "الثقة",
  "reconciliation.col.delta": "الفرق",

  // View states
  "reconciliation.loading": "جارٍ تحميل جلسات المطابقة...",
  "reconciliation.error.generic": "تعذّر تحميل البيانات. حاول مرة أخرى.",
  "reconciliation.empty": "لا توجد جلسات مطابقة لهذه المهمة بعد.",

  // Session card
  "reconciliation.metric.matched": "مطابَقة",
  "reconciliation.metric.partial": "جزئية",
  "reconciliation.metric.unmatched": "غير مطابَقة",
  "reconciliation.matchRate": "نسبة المطابقة",
} as const;

export const reconciliationEn: Record<keyof typeof reconciliationAr, string> = {
  "reconciliation.col.sourceRef": "Source reference",
  "reconciliation.col.amount": "Amount",
  "reconciliation.col.targetRef": "Counterparty reference",
  "reconciliation.col.status": "Status",
  "reconciliation.col.confidence": "Confidence",
  "reconciliation.col.delta": "Difference",

  "reconciliation.loading": "Loading reconciliation sessions...",
  "reconciliation.error.generic": "Could not load the data. Please try again.",
  "reconciliation.empty": "No reconciliation sessions for this engagement yet.",

  "reconciliation.metric.matched": "Matched",
  "reconciliation.metric.partial": "Partial",
  "reconciliation.metric.unmatched": "Unmatched",
  "reconciliation.matchRate": "Match rate",
};
