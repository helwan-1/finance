import { ConfigError } from "../errors";

/**
 * C3 statistical frozen-config parsing + validation (ADR-G4-C3). Runs in
 * PREFLIGHT before any authoritative result is written, so an invalid frozen
 * config is a terminal CONFIG failure with ZERO results. Every authoritative
 * parameter is an integer or a canonical fixed-point decimal STRING — no JS
 * floating-point value is ever produced or consumed here (no parseFloat, no
 * Number(decimal)); rate math is exact integer arithmetic and round math is
 * exact NUMERIC in the DB.
 */

const CANONICAL_DECIMAL_RE = /^\d+(\.\d+)?$/; // positive, no sign, no exponent
const MAX_PRECISION = 24; // Decimal(24,6)
const MAX_SCALE = 6;

/** Greatest common divisor (non-negative integers). gcd(0, n) === n. */
export function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    [x, y] = [y, x % y];
  }
  return x;
}

function requireObject(params: unknown): Record<string, unknown> {
  if (typeof params !== "object" || params === null || Array.isArray(params)) {
    throw new ConfigError("statistical config must be a JSON object");
  }
  return params as Record<string, unknown>;
}

function requireInteger(v: unknown, name: string): number {
  if (typeof v !== "number" || !Number.isInteger(v)) {
    throw new ConfigError(`${name} must be an integer (got ${JSON.stringify(v)})`);
  }
  return v;
}

/**
 * Validate a positive canonical fixed-point decimal STRING against Decimal(24,6):
 * a string only, no exponent, no sign, no NaN/Infinity, scale ≤ 6, precision ≤ 24,
 * strictly > 0. No JS Number conversion. Returns the frozen string unchanged so it
 * remains byte-identical to what fed effectiveParametersHash.
 */
export function validatePositiveCanonicalDecimal(v: unknown, name: string): string {
  if (typeof v !== "string") throw new ConfigError(`${name} must be a canonical decimal string (got ${typeof v})`);
  if (!CANONICAL_DECIMAL_RE.test(v)) throw new ConfigError(`${name} is not a canonical positive decimal (no sign/exponent/NaN): ${JSON.stringify(v)}`);
  const [intPart = "", fracPart = ""] = v.split(".");
  const scale = fracPart.length;
  if (scale > MAX_SCALE) throw new ConfigError(`${name} scale ${scale} exceeds ${MAX_SCALE} (Decimal(24,6))`);
  // Significant integer digits (leading zeros do not count toward precision).
  const intSig = intPart.replace(/^0+(?=\d)/, "");
  const intDigits = intSig === "0" ? 0 : intSig.length;
  if (intDigits + scale > MAX_PRECISION) throw new ConfigError(`${name} precision ${intDigits + scale} exceeds ${MAX_PRECISION}`);
  // Strictly positive: at least one non-zero digit anywhere.
  if (!/[1-9]/.test(v)) throw new ConfigError(`${name} must be > 0`);
  return v;
}

export interface RoundConfig {
  amountBasis: "TRANSACTION";
  methodVersion: "st.round.1";
  roundingQuantum: string;
  minimumPopulation: number;
  minimumRoundCount: number;
  rateThresholdNum: number;
  rateThresholdDenom: number;
}

/** Parse + validate ST_ROUND_NUMBER_FREQUENCY frozen config (throws ConfigError). */
export function parseRoundConfig(params: unknown): RoundConfig {
  const p = requireObject(params);
  if (p.amountBasis !== "TRANSACTION") throw new ConfigError(`round: amountBasis must be "TRANSACTION" (got ${JSON.stringify(p.amountBasis)})`);
  if (p.methodVersion !== "st.round.1") throw new ConfigError(`round: methodVersion must be "st.round.1" (got ${JSON.stringify(p.methodVersion)})`);

  const roundingQuantum = validatePositiveCanonicalDecimal(p.roundingQuantum, "round: roundingQuantum");

  const minimumPopulation = requireInteger(p.minimumPopulation, "round: minimumPopulation");
  if (minimumPopulation < 1) throw new ConfigError("round: minimumPopulation must be >= 1");

  const minimumRoundCount = requireInteger(p.minimumRoundCount, "round: minimumRoundCount");
  if (minimumRoundCount < 1) throw new ConfigError("round: minimumRoundCount must be >= 1");

  const rateThresholdNum = requireInteger(p.rateThresholdNum, "round: rateThresholdNum");
  if (rateThresholdNum < 0) throw new ConfigError("round: rateThresholdNum must be >= 0");

  const rateThresholdDenom = requireInteger(p.rateThresholdDenom, "round: rateThresholdDenom");
  if (rateThresholdDenom <= 0) throw new ConfigError("round: rateThresholdDenom must be > 0");

  if (rateThresholdNum > rateThresholdDenom) throw new ConfigError("round: rate is impossible (Num > Denom > 100%)");
  if (gcd(rateThresholdNum, rateThresholdDenom) !== 1) {
    throw new ConfigError(`round: rate ${rateThresholdNum}/${rateThresholdDenom} must be reduced (lowest terms)`);
  }

  return { amountBasis: "TRANSACTION", methodVersion: "st.round.1", roundingQuantum, minimumPopulation, minimumRoundCount, rateThresholdNum, rateThresholdDenom };
}

export interface DuplicateConfig {
  amountBasis: "TRANSACTION";
  methodVersion: "st.dupamt.1";
  minimumOccurrenceCount: number;
}

/** Parse + validate ST_DUPLICATE_AMOUNT_FREQUENCY frozen config (throws ConfigError). */
export function parseDuplicateConfig(params: unknown): DuplicateConfig {
  const p = requireObject(params);
  if (p.amountBasis !== "TRANSACTION") throw new ConfigError(`dupamt: amountBasis must be "TRANSACTION" (got ${JSON.stringify(p.amountBasis)})`);
  if (p.methodVersion !== "st.dupamt.1") throw new ConfigError(`dupamt: methodVersion must be "st.dupamt.1" (got ${JSON.stringify(p.methodVersion)})`);

  const minimumOccurrenceCount = requireInteger(p.minimumOccurrenceCount, "dupamt: minimumOccurrenceCount");
  if (minimumOccurrenceCount < 2) throw new ConfigError("dupamt: minimumOccurrenceCount must be >= 2");

  // There is NO minimumPopulation for this test (C3-D1=B); it is neither inferred
  // nor accepted as authoritative — only minimumOccurrenceCount gates a group.
  return { amountBasis: "TRANSACTION", methodVersion: "st.dupamt.1", minimumOccurrenceCount };
}
