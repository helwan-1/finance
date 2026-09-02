import { createHash } from "node:crypto";

/**
 * G2 canonical hashing (Closure C4/C5).
 *
 * Unambiguous, injection-proof framing: every value is length-prefixed and
 * type-tagged, so no data byte can forge a field/record boundary. NULL is a
 * distinct tag, never confused with an empty string. All fingerprints are
 * SHA-256 over the framed bytes, lowercase hex. Two independent implementations
 * following this contract produce identical digests.
 *
 *   primitive := 0x00                                   (NULL)
 *              | 0x01 || LEB128(byteLen) || utf8Bytes   (STRING)
 *   LEB128    := unsigned little-endian base-128 varint
 */

/** Lossless positional cell (C5): column index, original header, raw value. */
export interface RawCell {
  i: number;
  h: string | null;
  v: string | null;
}

function leb128(n: number): Buffer {
  if (!Number.isInteger(n) || n < 0) {
    throw new Error("leb128 requires a non-negative integer");
  }
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

function encPrimitive(x: string | null): Buffer {
  if (x === null) return Buffer.from([0x00]);
  const bytes = Buffer.from(x, "utf8");
  return Buffer.concat([Buffer.from([0x01]), leb128(bytes.length), bytes]);
}

/** Ordered key/value pairs, sorted by key (Unicode code point), each framed. */
function encObject(pairs: Array<[string, string | null]>): Buffer {
  const sorted = [...pairs].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const parts: Buffer[] = [leb128(sorted.length)];
  for (const [k, v] of sorted) parts.push(encPrimitive(k), encPrimitive(v));
  return Buffer.concat(parts);
}

const sha = (b: Buffer): string => createHash("sha256").update(b).digest("hex");

/** SHA-256 of exact bytes (SourceFile.sha256). */
export function sha256Bytes(bytes: Buffer): string {
  return sha(bytes);
}

/**
 * ImportedRecord.rawHash — over the lossless positional array, ordered by
 * column index. Duplicate headers survive as distinct entries (distinct i).
 */
export function rawHash(cells: RawCell[]): string {
  const sorted = [...cells].sort((a, b) => a.i - b.i);
  const parts: Buffer[] = [leb128(sorted.length)];
  for (const c of sorted) {
    parts.push(encPrimitive(String(c.i)), encPrimitive(c.h), encPrimitive(c.v));
  }
  return sha(Buffer.concat(parts));
}

export interface ProfileFingerprintInput {
  format: string;
  encoding: string;
  delimiter: string | null;
  sheet: string | null;
  headerRow: number;
  locale: string;
  dateInterpretation: string;
  numberInterpretation: string;
  parserVersion: string;
  normalizerVersion: string;
}

/** effectiveProfileHash — canonical over the frozen parse config. */
export function profileHash(p: ProfileFingerprintInput): string {
  return sha(
    encObject([
      ["format", p.format],
      ["encoding", p.encoding],
      ["delimiter", p.delimiter],
      ["sheet", p.sheet],
      ["headerRow", String(p.headerRow)],
      ["locale", p.locale],
      ["dateInterpretation", p.dateInterpretation],
      ["numberInterpretation", p.numberInterpretation],
      ["parserVersion", p.parserVersion],
      ["normalizerVersion", p.normalizerVersion],
    ]),
  );
}

/** mappingHash — {kind, targetFieldSetVersion} header ++ sorted source→field pairs. */
export function mappingHash(
  datasetKind: string,
  targetFieldSetVersion: string,
  map: Record<string, string>,
): string {
  const header = encObject([
    ["datasetKind", datasetKind],
    ["targetFieldSetVersion", targetFieldSetVersion],
  ]);
  const pairs = Object.entries(map).sort((a, b) =>
    a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0,
  );
  const parts: Buffer[] = [header, leb128(pairs.length)];
  for (const [k, v] of pairs) parts.push(encPrimitive(k), encPrimitive(v));
  return sha(Buffer.concat(parts));
}

export interface DatasetHashInput {
  sourceFileSha256: string | null;
  effectiveProfileHash: string;
  mappingHash: string;
  datasetKind: string;
  normalizerVersion: string;
  /** Each ImportedRecord.rawHash, in ascending sourceRowNo. */
  orderedRawHashes: string[];
}

/** datasetHash — deterministic, reproducible dataset identity. */
export function datasetHash(input: DatasetHashInput): string {
  const header = encObject([
    ["sourceFileSha256", input.sourceFileSha256],
    ["effectiveProfileHash", input.effectiveProfileHash],
    ["mappingHash", input.mappingHash],
    ["datasetKind", input.datasetKind],
    ["normalizerVersion", input.normalizerVersion],
  ]);
  const parts: Buffer[] = [header, leb128(input.orderedRawHashes.length)];
  for (const h of input.orderedRawHashes) parts.push(Buffer.from(h, "hex"));
  return sha(Buffer.concat(parts));
}
