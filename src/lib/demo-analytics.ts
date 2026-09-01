import { analyzeBenford } from "./audit/benford";
import type { AnalyticsResponse } from "./ui-types";

/**
 * Demo Benford analysis. Built by running the real analyzer over a constructed
 * population that under-represents leading digit 1 and over-represents high
 * digits, so the chi-square value and verdict are internally consistent.
 */
const OBSERVED_COUNTS = [22, 15, 14, 12, 12, 14, 12, 13, 12];

const amounts: string[] = [];
OBSERVED_COUNTS.forEach((count, index) => {
  const digit = index + 1;
  for (let k = 0; k < count; k += 1) {
    amounts.push(`${digit}${(100 + k).toString()}.00`);
  }
});

const result = analyzeBenford(amounts);

export const DEMO_ANALYTICS: AnalyticsResponse = {
  sampleSize: result.sampleSize,
  chiSquare: Math.round(result.chiSquare * 100) / 100,
  criticalValue: 15.507,
  rejectsBenford: result.rejectsBenford,
  digits: result.digits.map((d) => ({
    digit: d.digit,
    observedCount: d.observedCount,
    observedProportion: d.observedProportion,
    expectedProportion: d.expectedProportion,
  })),
};
