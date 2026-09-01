/**
 * Audit algorithms engine — public entry point.
 *
 * Composes the individual analyzers into a single pass over a transaction
 * population and returns a ranked list of findings.
 */

import { detectBenfordDeviation } from "./benford";
import { detectDuplicates, type DuplicateOptions } from "./duplicates";
import { detectOffHours, type OffHoursOptions } from "./offHours";
import { detectVatDiscrepancies, type VatOptions } from "./vat";
import type { AnalyzableTransaction, DetectedAnomaly } from "./types";

export * from "./types";
export { analyzeBenford, detectBenfordDeviation } from "./benford";
export { detectDuplicates } from "./duplicates";
export { detectOffHours, zonedParts } from "./offHours";
export { detectVatDiscrepancies, checkVat, expectedVatMinor } from "./vat";
export { toMinorUnits, minorUnitsToString } from "./money";

export interface EngineOptions {
  duplicates?: Partial<DuplicateOptions>;
  offHours?: Partial<OffHoursOptions>;
  vat?: Partial<VatOptions>;
  /** Toggle individual analyzers (all on by default). */
  enable?: {
    benford?: boolean;
    duplicates?: boolean;
    offHours?: boolean;
    vat?: boolean;
  };
}

/**
 * Run all enabled analyzers and return findings sorted by score (desc),
 * then severity. Callers persist these as `AnomalyFlag` rows scoped to the
 * engagement.
 */
export function runAuditEngine(
  transactions: readonly AnalyzableTransaction[],
  options: EngineOptions = {},
): DetectedAnomaly[] {
  const enable = {
    benford: true,
    duplicates: true,
    offHours: true,
    vat: true,
    ...options.enable,
  };

  const findings: DetectedAnomaly[] = [];

  if (enable.benford) {
    findings.push(...detectBenfordDeviation(transactions));
  }
  if (enable.duplicates) {
    findings.push(...detectDuplicates(transactions, options.duplicates));
  }
  if (enable.offHours) {
    findings.push(...detectOffHours(transactions, options.offHours));
  }
  if (enable.vat) {
    findings.push(...detectVatDiscrepancies(transactions, options.vat));
  }

  const severityRank: Record<DetectedAnomaly["severity"], number> = {
    CRITICAL: 5,
    HIGH: 4,
    MEDIUM: 3,
    LOW: 2,
    INFO: 1,
  };

  return findings.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return severityRank[b.severity] - severityRank[a.severity];
  });
}
