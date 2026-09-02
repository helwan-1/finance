/**
 * G3 canonical decimal handling (ADR-G3-01). Exact, no floating point.
 *
 * G2's ingestion normalizer rounds amounts to 2dp (`toFixed(2)`) in
 * `normalizedJson`; the verbatim source string is preserved in
 * `ImportedRecord.rawCells`. Canonical accounting therefore re-parses the RAW
 * mapped cell here — never the 2dp-rounded value — so precision survives into
 * `Decimal(24,6)` without rounding to the bridge (Section B / test 5).
 */

const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

/**
 * Clean a raw source amount to a canonical decimal STRING, or null when
 * unparseable. No float, no rounding: the string is handed straight to Prisma
 * Decimal(24,6). Strips thousands separators / currency symbols; maps
 * Arabic-Indic digits.
 */
export function parseCanonicalDecimal(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  let s = raw.trim();
  if (!s) return null;
  s = s.replace(/[٠-٩]/g, (dch) => String(ARABIC_DIGITS.indexOf(dch)));
  s = s.replace(/[,\s٬]/g, ""); // thousands separators
  s = s.replace(/[^0-9.\-]/g, ""); // drop currency symbols
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  // Normalize sign/zeros without going through a float.
  const neg = s.startsWith("-");
  let body = neg ? s.slice(1) : s;
  body = body.replace(/^0+(?=\d)/, ""); // strip leading zeros, keep one
  if (body === "" ) body = "0";
  const out = (neg && body !== "0" && !/^0(\.0+)?$/.test(body) ? "-" : "") + body;
  return out;
}

/** Micro-unit (10^-6) scale used for exact balance summation. */
const SCALE = 6;

/**
 * Parse a canonical decimal string to integer micro-units (×10^6), rounding
 * half-up at the 6th fractional digit. Used only for exact debit/credit totals;
 * line values are stored verbatim as strings.
 */
export function decimalToMicros(s: string): bigint {
  const neg = s.startsWith("-");
  const body = neg ? s.slice(1) : s;
  const [intPart, fracRaw = ""] = body.split(".");
  const frac = fracRaw.padEnd(SCALE + 1, "0"); // one guard digit for rounding
  const keep = frac.slice(0, SCALE);
  const guard = frac.charCodeAt(SCALE) - 48; // next digit
  let micros = BigInt(intPart + keep);
  if (guard >= 5) micros += 1n;
  return neg ? -micros : micros;
}

/** Format integer micro-units back to a plain decimal string with 6 dp. */
export function microsToDecimalString(m: bigint): string {
  const neg = m < 0n;
  const abs = (neg ? -m : m).toString().padStart(SCALE + 1, "0");
  const intPart = abs.slice(0, abs.length - SCALE);
  const frac = abs.slice(abs.length - SCALE);
  return `${neg ? "-" : ""}${intPart}.${frac}`;
}
