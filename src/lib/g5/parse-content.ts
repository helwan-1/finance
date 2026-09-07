import type { FindingContentInput } from "./finding";

/**
 * Parse & validate an untrusted request payload into a FindingContentInput.
 * Returns null when a required IMRAD field is missing (category, condition,
 * criteria, cause, effect, auditorConclusion). Optional fields normalize empty
 * strings to null. Money amounts stay strings (validated by the DB CHECKs).
 */
export function parseFindingContent(raw: unknown): FindingContentInput | null {
  if (typeof raw !== "object" || raw === null) return null;
  const c = raw as Record<string, unknown>;
  const str = (k: string): string => (typeof c[k] === "string" ? (c[k] as string).trim() : "");
  const opt = (k: string): string | null => {
    const v = typeof c[k] === "string" ? (c[k] as string).trim() : "";
    return v ? v : null;
  };

  const category = str("category");
  const condition = str("condition");
  const criteria = str("criteria");
  const cause = str("cause");
  const effect = str("effect");
  const auditorConclusion = str("auditorConclusion");

  if (!category || !condition || !criteria || !cause || !effect || !auditorConclusion) {
    return null;
  }

  // A money amount and its currency must be BOTH set or BOTH null (DB CHECK
  // afv_estimated_pair_chk). Pair them here so an amount without a currency
  // (the form shows "SAR" only as a placeholder) defaults to SAR, and a stray
  // currency without an amount is dropped.
  const pair = (amtKey: string, curKey: string): [string | null, string | null] => {
    const amt = opt(amtKey);
    return amt ? [amt, opt(curKey) ?? "SAR"] : [null, null];
  };
  const [observedAmount, observedCurrency] = pair("observedAmount", "observedCurrency");
  const [estimatedExposureAmount, estimatedExposureCurrency] = pair("estimatedExposureAmount", "estimatedExposureCurrency");

  return {
    category,
    condition,
    criteria,
    cause,
    effect,
    auditorConclusion,
    recommendation: opt("recommendation"),
    observedAmount,
    observedCurrency,
    estimatedExposureAmount,
    estimatedExposureCurrency,
  };
}
