/**
 * VAT discrepancy detection (ZATCA — Kingdom of Saudi Arabia).
 *
 * The standard VAT rate in KSA is 15%. For a transaction whose `amount` is the
 * taxable base (net) and whose `vatAmount` is the declared tax, the expected
 * tax is `round(base * rate)`. A declared value outside a small tolerance is a
 * discrepancy — a common source of ZATCA return misstatement.
 *
 * All arithmetic is in integer minor units; expected VAT is computed with
 * half-up rounding on the minor-unit product, never via JS float math.
 */

import { absMinor, minorUnitsToString, toMinorUnits } from "./money";
import type { AnalyzableTransaction, DetectedAnomaly } from "./types";

export interface VatOptions {
  /** Standard VAT rate as a fraction. Default 0.15 (KSA standard). */
  rate: number;
  /**
   * Absolute tolerance in minor units. Declared VAT within this many halalas
   * of the expected value is treated as correct (covers legitimate rounding).
   * Default 1 (one halala).
   */
  toleranceMinor: number;
}

const DEFAULT_OPTIONS: VatOptions = {
  rate: 0.15,
  toleranceMinor: 1,
};

/**
 * Expected VAT in minor units for a taxable base, using half-up rounding.
 * rate is expressed in basis points internally to avoid float drift.
 */
export function expectedVatMinor(baseMinor: number, rate: number): number {
  // rate * 10000 → integer basis points (e.g. 0.15 → 1500).
  const basisPoints = Math.round(rate * 10000);
  const product = baseMinor * basisPoints; // minor units × bps
  // Divide by 10000 with half-up rounding on the sign of the base.
  const sign = product < 0 ? -1 : 1;
  const abs = Math.abs(product);
  return sign * Math.floor((abs + 5000) / 10000);
}

export interface VatCheck {
  baseMinor: number;
  declaredMinor: number;
  expectedMinor: number;
  deltaMinor: number;
  isDiscrepancy: boolean;
}

/** Evaluate a single transaction's declared VAT against the expected value. */
export function checkVat(
  baseMinor: number,
  declaredMinor: number,
  options: Partial<VatOptions> = {},
): VatCheck {
  const opts: VatOptions = { ...DEFAULT_OPTIONS, ...options };
  const expectedMinor = expectedVatMinor(baseMinor, opts.rate);
  const deltaMinor = declaredMinor - expectedMinor;
  return {
    baseMinor,
    declaredMinor,
    expectedMinor,
    deltaMinor,
    isDiscrepancy: absMinor(deltaMinor) > opts.toleranceMinor,
  };
}

export function detectVatDiscrepancies(
  transactions: readonly AnalyzableTransaction[],
  options: Partial<VatOptions> = {},
): DetectedAnomaly[] {
  const opts: VatOptions = { ...DEFAULT_OPTIONS, ...options };
  const ratePct = Math.round(opts.rate * 10000) / 100;
  const anomalies: DetectedAnomaly[] = [];

  for (const txn of transactions) {
    if (txn.vatAmount === undefined || txn.vatAmount === null) continue;

    const baseMinor = toMinorUnits(txn.amount);
    if (baseMinor === 0) continue;

    const declaredMinor = toMinorUnits(txn.vatAmount);
    const check = checkVat(baseMinor, declaredMinor, opts);
    if (!check.isDiscrepancy) continue;

    const expectedStr = minorUnitsToString(check.expectedMinor);
    const declaredStr = minorUnitsToString(check.declaredMinor);
    const deltaStr = minorUnitsToString(check.deltaMinor);

    // Larger relative deltas are more severe.
    const relative =
      absMinor(check.deltaMinor) / Math.max(1, absMinor(check.expectedMinor));
    const severity =
      relative >= 0.5 ? "CRITICAL" : relative >= 0.1 ? "HIGH" : "MEDIUM";
    const score = Math.min(100, Math.round(60 + relative * 60));

    anomalies.push({
      ruleCode: "VAT_DISCREPANCY",
      severity,
      score,
      title: "VAT discrepancy",
      titleAr: "فرق في ضريبة القيمة المضافة",
      description: `Declared VAT ${declaredStr} does not match the expected ${ratePct}% (${expectedStr}) for reference ${txn.reference}; delta ${deltaStr}.`,
      descriptionAr: `ضريبة القيمة المضافة المصرّح بها ${declaredStr} لا تطابق المتوقع ${ratePct}% (${expectedStr}) للمرجع ${txn.reference}؛ الفرق ${deltaStr}.`,
      transactionIds: [txn.id],
      evidence: {
        rate: opts.rate,
        taxableBase: txn.amount,
        declaredVat: declaredStr,
        expectedVat: expectedStr,
        deltaVat: deltaStr,
      },
    });
  }

  return anomalies;
}
