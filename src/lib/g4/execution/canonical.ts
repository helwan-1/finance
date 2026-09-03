import { fields, seq, str, int } from "@/lib/g4/framing";

/**
 * C1 canonical result value model (ADR-G4-C1-07). A frozen, deterministic value
 * grammar used for BOTH the stored payloadJson and the fingerprinted payload, so
 * the two always represent the same semantic value. Raw IEEE-754 floats (and
 * NaN/Infinity) are rejected — decimals must be supplied as validated decimal
 * strings via `dec()`, so nothing platform-unstable ever enters a fingerprint.
 *
 * Each node frames to a single-key `fields([[typeTag, payload]])`, so distinct
 * types never collide: boolean true, integer 1, decimal "1", string "1" and the
 * one-element sequence [ ... ] all produce different frames.
 */
export type CanonicalNode =
  | { t: "null" }
  | { t: "bool"; v: boolean }
  | { t: "int"; v: number }
  | { t: "dec"; v: string }
  | { t: "str"; v: string }
  | { t: "seq"; v: CanonicalNode[] }
  | { t: "obj"; v: Array<[string, CanonicalNode]> };

const DECIMAL_RE = /^-?\d+(\.\d+)?$/;

/** Wrap a validated decimal string as a canonical decimal (never a JS float). */
export function dec(s: string): CanonicalNode {
  if (typeof s !== "string" || !DECIMAL_RE.test(s)) throw new Error(`canonical: invalid decimal string ${JSON.stringify(s)}`);
  return { t: "dec", v: s };
}

/**
 * Normalize an arbitrary JS value into a canonical node. Objects get their keys
 * sorted; arrays keep order; integers pass through; non-integer numbers, NaN and
 * Infinity are REJECTED (supply a decimal string via `dec()` instead). A `dec`
 * node passes through unchanged so callers can mix `dec("1.50")` into plain data.
 */
export function canonicalize(v: unknown): CanonicalNode {
  if (v === null || v === undefined) return { t: "null" };
  if (typeof v === "boolean") return { t: "bool", v };
  if (typeof v === "number") {
    if (!Number.isInteger(v)) throw new Error(`canonical: refusing raw non-integer number ${v} (use dec() with a decimal string)`);
    return { t: "int", v };
  }
  if (typeof v === "string") return { t: "str", v };
  if (isNode(v)) return normalizeNode(v);
  if (Array.isArray(v)) return { t: "seq", v: v.map(canonicalize) };
  if (typeof v === "object") {
    const pairs = Object.entries(v as Record<string, unknown>)
      .map(([k, val]) => [k, canonicalize(val)] as [string, CanonicalNode])
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    return { t: "obj", v: pairs };
  }
  throw new Error(`canonical: unsupported value type ${typeof v}`);
}

function isNode(v: unknown): v is CanonicalNode {
  return typeof v === "object" && v !== null && "t" in v && typeof (v as { t: unknown }).t === "string";
}

function normalizeNode(n: CanonicalNode): CanonicalNode {
  switch (n.t) {
    case "dec": return dec(n.v);
    case "seq": return { t: "seq", v: n.v.map(canonicalize) };
    case "obj": return { t: "obj", v: n.v.map(([k, val]) => [k, canonicalize(val)] as [string, CanonicalNode]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)) };
    default: return n;
  }
}

/** Injection-safe frame of a canonical node (feeds fingerprints). */
export function toFrame(n: CanonicalNode): Buffer {
  switch (n.t) {
    case "null": return fields([["n", str(null)]]);
    case "bool": return fields([["b", str(n.v ? "1" : "0")]]);
    case "int": return fields([["i", int(n.v)]]);
    case "dec": return fields([["d", str(n.v)]]);
    case "str": return fields([["s", str(n.v)]]);
    case "seq": return fields([["seq", seq(n.v.map(toFrame))]]);
    case "obj": return fields([["obj", fields(n.v.map(([k, val]) => [k, toFrame(val)] as [string, Buffer]))]]);
  }
}

/** JSON-serializable projection (stored as payloadJson); same value as the frame. */
export function toJson(n: CanonicalNode): unknown {
  switch (n.t) {
    case "null": return null;
    case "bool": return n.v;
    case "int": return n.v;
    case "dec": return n.v; // decimal preserved as a string (never a float)
    case "str": return n.v;
    case "seq": return n.v.map(toJson);
    case "obj": {
      const o: Record<string, unknown> = {};
      for (const [k, val] of n.v) o[k] = toJson(val); // keys already sorted
      return o;
    }
  }
}
