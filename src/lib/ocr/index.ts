/**
 * Document parsing (OCR) integration layer.
 *
 * This is the seam where PaddleOCR / AWS Textract / the Claude API plug in. The
 * app depends only on the `DocumentParser` interface, so a real provider can be
 * swapped in without touching the routes or UI. Until one is configured we use
 * a deterministic stub so the upload → parse flow works end to end.
 */

import type { DocumentType } from "../ui-types";

/** A single line item extracted from a document. */
export interface ExtractedLine {
  reference: string;
  description: string;
  /** Decimal string. */
  amount: string;
  /** Decimal string, when a tax line is present. */
  vatAmount?: string;
  date?: string;
  counterparty?: string;
}

export interface ParsedDocument {
  /** Provider that produced the result (e.g. "stub", "textract", "claude"). */
  provider: string;
  documentType: DocumentType;
  pageCount: number;
  lines: ExtractedLine[];
  /** Free-form provider metadata (confidence scores, raw blocks, etc.). */
  raw?: Record<string, unknown>;
}

export interface ParseInput {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  documentType: DocumentType;
}

export interface DocumentParser {
  readonly name: string;
  parse(input: ParseInput): Promise<ParsedDocument>;
}

/** Deterministic pseudo-random generator seeded from a string. */
function seededRandom(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Stub parser: returns deterministic mock line items derived from the file
 * name, so the same upload always yields the same "extraction". Replace with a
 * real provider by implementing DocumentParser and wiring it into getParser().
 */
export class StubDocumentParser implements DocumentParser {
  readonly name = "stub";

  async parse(input: ParseInput): Promise<ParsedDocument> {
    const rand = seededRandom(input.fileName);
    const lineCount = 3 + Math.floor(rand() * 6);
    const lines: ExtractedLine[] = [];
    for (let i = 0; i < lineCount; i += 1) {
      const base = Math.round((500 + rand() * 90000) * 100) / 100;
      const vat = Math.round(base * 15) / 100;
      lines.push({
        reference: `${input.documentType.slice(0, 3)}-${1000 + i}`,
        description: "بند مستخرج من المستند",
        amount: base.toFixed(2),
        vatAmount: vat.toFixed(2),
        counterparty: "طرف مقابل مستخرج",
      });
    }
    return {
      provider: this.name,
      documentType: input.documentType,
      pageCount: 1 + Math.floor(rand() * 4),
      lines,
      raw: { note: "stub extraction — no real OCR provider configured" },
    };
  }
}

/**
 * Resolve the active parser. When OCR_SERVICE_URL / ANTHROPIC_API_KEY are set a
 * real provider would be returned here; for now we always return the stub.
 */
export function getParser(): DocumentParser {
  // Placeholder for provider selection:
  //   if (process.env.OCR_SERVICE_URL) return new TextractParser(...)
  //   if (process.env.ANTHROPIC_API_KEY) return new ClaudeParser(...)
  return new StubDocumentParser();
}
