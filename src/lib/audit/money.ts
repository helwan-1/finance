/**
 * Money handling utilities.
 *
 * RULE: monetary amounts are NEVER manipulated as JavaScript floating-point
 * numbers. Prisma returns `Decimal(15, 2)` values which we convert to integer
 * minor units ("cents") for all arithmetic, then format back for display.
 *
 * `MinorUnits` is an integer count of the currency's smallest unit
 * (e.g. halalas for SAR, cents for USD). Two decimal places assumed, matching
 * the `@db.Decimal(15, 2)` columns.
 */

export type MinorUnits = number;

/** A Decimal-like input: a string ("1234.50"), or a Prisma Decimal instance. */
export interface DecimalLike {
  toString(): string;
}

/**
 * Convert a decimal string / Decimal value into integer minor units.
 * Throws on malformed input rather than silently coercing to NaN.
 */
export function toMinorUnits(value: DecimalLike | string): MinorUnits {
  const raw = typeof value === "string" ? value : value.toString();
  const trimmed = raw.trim();
  const match = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(trimmed);
  if (!match) {
    throw new Error(`Invalid monetary value: "${raw}"`);
  }
  const sign = match[1] ? -1 : 1;
  const whole = match[2] ?? "0";
  const frac = (match[3] ?? "").padEnd(2, "0");
  const units = Number.parseInt(whole, 10) * 100 + Number.parseInt(frac, 10);
  return sign * units;
}

/** Absolute value in minor units. */
export function absMinor(value: MinorUnits): MinorUnits {
  return Math.abs(value);
}

/** Format integer minor units as a decimal string with 2 places. */
export function minorUnitsToString(value: MinorUnits): string {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  const whole = Math.trunc(abs / 100);
  const frac = (abs % 100).toString().padStart(2, "0");
  return `${sign}${whole}.${frac}`;
}
