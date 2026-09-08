/** analytics message dictionary. Arabic source of truth; English mirrors key-for-key. */
export const analyticsAr = {
  // View states
  "analytics.loading": "جارٍ حساب توزيع بنفورد...",
  "analytics.error.generic": "تعذّر تحميل البيانات.",

  // Verdict banner
  "analytics.verdict.reject": "انحراف دال عن قانون بنفورد",
  "analytics.verdict.ok": "التوزيع متوافق مع قانون بنفورد",
  "analytics.benford.stats":
    "مربع كاي = {chiSquare} مقابل القيمة الحرجة {criticalValue} (ثقة 95%، درجات حرية 8) — حجم العينة {sampleSize}.",
  "analytics.benford.adviceReview": " يُنصح بمراجعة تفصيلية للقيود.",
  "analytics.benford.adviceOk": " لا يوجد مؤشر إحصائي على تلاعب في الأرقام.",
  "analytics.firstDigit.title": "توزيع الرقم الأول",

  // Chart
  "analytics.chart.ariaLabel": "مخطط توزيع الرقم الأول مقارنة بقانون بنفورد",
  "analytics.tip.expected": "المتوقع: {value}%",
  "analytics.tip.observed": "الملاحظ: {value}% ({count})",
  "analytics.legend.observed": "الملاحظ",
  "analytics.legend.expected": "المتوقع (بنفورد)",
} as const;

export const analyticsEn: Record<keyof typeof analyticsAr, string> = {
  "analytics.loading": "Computing Benford distribution...",
  "analytics.error.generic": "Could not load the data.",

  "analytics.verdict.reject": "Significant deviation from Benford's Law",
  "analytics.verdict.ok": "Distribution conforms to Benford's Law",
  "analytics.benford.stats":
    "Chi-square = {chiSquare} versus the critical value {criticalValue} (95% confidence, 8 degrees of freedom) — sample size {sampleSize}.",
  "analytics.benford.adviceReview": " A detailed review of the entries is advised.",
  "analytics.benford.adviceOk": " No statistical indication of number manipulation.",
  "analytics.firstDigit.title": "First-digit distribution",

  "analytics.chart.ariaLabel": "First-digit distribution chart compared with Benford's Law",
  "analytics.tip.expected": "Expected: {value}%",
  "analytics.tip.observed": "Observed: {value}% ({count})",
  "analytics.legend.observed": "Observed",
  "analytics.legend.expected": "Expected (Benford)",
};
