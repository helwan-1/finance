/**
 * Benford's Law analysis (first-digit) with a Chi-Square goodness-of-fit test.
 *
 * Benford's Law predicts the frequency of leading digits (1-9) in many
 * naturally-occurring financial datasets. A large deviation from the expected
 * distribution can indicate fabricated or manipulated figures.
 */

import { absMinor, toMinorUnits } from "./money";
import type {
  AnalyzableTransaction,
  DetectedAnomaly,
} from "./types";

/** Expected proportion of each leading digit under Benford's Law. */
export const BENFORD_EXPECTED: readonly number[] = [
  Math.log10(1 + 1 / 1),
  Math.log10(1 + 1 / 2),
  Math.log10(1 + 1 / 3),
  Math.log10(1 + 1 / 4),
  Math.log10(1 + 1 / 5),
  Math.log10(1 + 1 / 6),
  Math.log10(1 + 1 / 7),
  Math.log10(1 + 1 / 8),
  Math.log10(1 + 1 / 9),
];

/**
 * Critical chi-square value at 8 degrees of freedom (9 digits - 1),
 * p = 0.05. Above this, the fit is rejected at the 95% confidence level.
 */
export const CHI_SQUARE_CRITICAL_8DF = 15.507;

export interface BenfordDigitStat {
  digit: number;
  observedCount: number;
  observedProportion: number;
  expectedProportion: number;
}

export interface BenfordResult {
  sampleSize: number;
  chiSquare: number;
  /** True when chiSquare exceeds the 95% critical value. */
  rejectsBenford: boolean;
  digits: BenfordDigitStat[];
}

/** Extract the leading significant digit (1-9) of a minor-units amount. */
export function leadingDigit(minorUnits: number): number | null {
  const abs = absMinor(minorUnits);
  if (abs === 0) return null;
  let n = abs;
  while (n >= 10) {
    n = Math.trunc(n / 10);
  }
  return n; // 1-9
}

/**
 * Run the Benford first-digit distribution + chi-square test over a set of
 * amounts. Amounts are decimal strings; zeros are ignored.
 */
export function analyzeBenford(
  amounts: readonly string[],
): BenfordResult {
  const counts = new Array<number>(9).fill(0);
  let sampleSize = 0;

  for (const amount of amounts) {
    const digit = leadingDigit(toMinorUnits(amount));
    if (digit === null) continue;
    counts[digit - 1] = (counts[digit - 1] ?? 0) + 1;
    sampleSize += 1;
  }

  const digits: BenfordDigitStat[] = [];
  let chiSquare = 0;

  for (let i = 0; i < 9; i += 1) {
    const observedCount = counts[i] ?? 0;
    const expectedProportion = BENFORD_EXPECTED[i] ?? 0;
    const expectedCount = expectedProportion * sampleSize;
    const observedProportion =
      sampleSize > 0 ? observedCount / sampleSize : 0;

    if (expectedCount > 0) {
      const diff = observedCount - expectedCount;
      chiSquare += (diff * diff) / expectedCount;
    }

    digits.push({
      digit: i + 1,
      observedCount,
      observedProportion,
      expectedProportion,
    });
  }

  return {
    sampleSize,
    chiSquare,
    rejectsBenford: chiSquare > CHI_SQUARE_CRITICAL_8DF,
    digits,
  };
}

/** Minimum sample size for Benford's Law to be statistically meaningful. */
export const BENFORD_MIN_SAMPLE = 50;

/**
 * Produce an anomaly if the transaction population deviates from Benford's Law.
 * Returns an empty array when the sample is too small or the fit is acceptable.
 */
export function detectBenfordDeviation(
  transactions: readonly AnalyzableTransaction[],
): DetectedAnomaly[] {
  if (transactions.length < BENFORD_MIN_SAMPLE) return [];

  const result = analyzeBenford(transactions.map((t) => t.amount));
  if (!result.rejectsBenford) return [];

  // Scale severity by how far chi-square exceeds the critical threshold.
  const excess = result.chiSquare / CHI_SQUARE_CRITICAL_8DF;
  const severity =
    excess >= 3 ? "CRITICAL" : excess >= 2 ? "HIGH" : "MEDIUM";
  const score = Math.min(100, Math.round(40 + excess * 20));

  return [
    {
      ruleCode: "BENFORD_DEVIATION",
      severity,
      score,
      title: "Benford's Law deviation detected",
      titleAr: "انحراف عن قانون بنفورد",
      description: `First-digit distribution rejects Benford's Law (χ² = ${result.chiSquare.toFixed(
        2,
      )} > ${CHI_SQUARE_CRITICAL_8DF} at 95% confidence, n = ${result.sampleSize}).`,
      descriptionAr: `توزيع الرقم الأول لا يتوافق مع قانون بنفورد (مربع كاي = ${result.chiSquare.toFixed(
        2,
      )} أكبر من ${CHI_SQUARE_CRITICAL_8DF} عند ثقة 95%، عدد العينات = ${result.sampleSize}).`,
      // A population-level finding: not tied to a single transaction.
      transactionIds: [],
      evidence: {
        chiSquare: result.chiSquare,
        criticalValue: CHI_SQUARE_CRITICAL_8DF,
        sampleSize: result.sampleSize,
        digits: result.digits,
      },
    },
  ];
}
