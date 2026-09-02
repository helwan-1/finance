import { createHash } from "node:crypto";

/**
 * G4 canonical binary framing — the single injection-safe hashing primitive for
 * all G4 semantic fingerprints (g4map.1, g4scope.1, g4pop.2, g4cfg.3, EOI).
 *
 * Same contract as G2/G3 (see import/canonical.ts): every value is length-
 * prefixed and type-tagged so no data byte can forge a boundary; NULL is a
 * distinct tag (never "" ); sequences carry an explicit length so multiplicity
 * and order are preserved. No ambiguous `a + "|" + b` concatenation anywhere.
 *
 *   primitive := 0x00                                  (NULL)
 *              | 0x01 || LEB128(len) || utf8           (STRING)
 *   seq       := 0x02 || LEB128(n) || framed_item*     (ordered — order semantic)
 *   fields    := 0x03 || LEB128(n) || (str(key)||item)* sorted by key (order NOT semantic)
 *   framed    := 0x01 || LEB128(len(tag)) || tag_bytes || body   (format/version tag)
 */
const T_NULL = 0x00;
const T_STR = 0x01;
const T_SEQ = 0x02;
const T_FIELDS = 0x03;

export function leb128(n: number): Buffer {
  if (!Number.isInteger(n) || n < 0) throw new Error("leb128 requires a non-negative integer");
  const out: number[] = [];
  let v = n;
  do {
    let b = v & 0x7f;
    v = Math.floor(v / 128);
    if (v > 0) b |= 0x80;
    out.push(b);
  } while (v > 0);
  return Buffer.from(out);
}

/** STRING or NULL primitive. `null` and `""` are distinct. */
export function str(x: string | null | undefined): Buffer {
  if (x === null || x === undefined) return Buffer.from([T_NULL]);
  const b = Buffer.from(x, "utf8");
  return Buffer.concat([Buffer.from([T_STR]), leb128(b.length), b]);
}

/** Integer as a framed decimal string (explicit, deterministic). */
export function int(n: number): Buffer {
  return str(String(n));
}

/** Ordered sequence — order IS semantic; multiplicity preserved by the length prefix. */
export function seq(items: Buffer[]): Buffer {
  return Buffer.concat([Buffer.from([T_SEQ]), leb128(items.length), ...items]);
}

/** Multiset — order is declared NON-semantic; members are sorted by their framed bytes. */
export function multiset(items: Buffer[]): Buffer {
  const sorted = [...items].sort(Buffer.compare);
  return Buffer.concat([Buffer.from([T_MULTI]), leb128(sorted.length), ...sorted]);
}
const T_MULTI = 0x04;

/** Named fields — key order NOT semantic (sorted by key code point). */
export function fields(pairs: Array<[string, Buffer]>): Buffer {
  const sorted = [...pairs].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const parts: Buffer[] = [Buffer.from([T_FIELDS]), leb128(sorted.length)];
  for (const [k, v] of sorted) parts.push(str(k), v);
  return Buffer.concat(parts);
}

/** Prefix a format/version tag onto a body (binds the framing scheme identity). */
export function framed(formatTag: string, body: Buffer): Buffer {
  const t = Buffer.from(formatTag, "utf8");
  return Buffer.concat([Buffer.from([T_STR]), leb128(t.length), t, body]);
}

export function hashHex(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

/** SHA-256 (hex) over a format-tagged framed body — the standard G4 fingerprint. */
export function fingerprint(formatTag: string, body: Buffer): string {
  return hashHex(framed(formatTag, body));
}

/**
 * Fold one framed member into a running chain accumulator (for resumable,
 * bounded-memory population fingerprinting): acc' = SHA256(acc || member).
 * Order- and multiplicity-preserving; deterministic on the same ordered stream.
 */
export function foldMember(accHex: string, member: Buffer): string {
  return hashHex(Buffer.concat([Buffer.from(accHex, "hex"), member]));
}

/** Seal a chain fold into a final fingerprint binding the element count. */
export function sealFold(formatTag: string, accHex: string, count: number): string {
  return fingerprint(formatTag, seq([str(accHex), int(count)]));
}

/** The empty-fold seed (before any member). */
export const FOLD_SEED = hashHex(Buffer.from("g4pop.seed", "utf8"));
