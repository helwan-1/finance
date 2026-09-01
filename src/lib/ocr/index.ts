/**
 * Document parsing (OCR) integration layer.
 *
 * This is the seam where PaddleOCR / AWS Textract / the Claude API plug in. The
 * app depends only on the `DocumentParser` interface, so a real provider can be
 * swapped in without touching the routes or UI. Without credentials we use a
 * deterministic stub so the upload → parse flow works end to end.
 */

import { ClaudeDocumentParser } from "./claude-parser";
import type {
  DocumentParser,
  ExtractedLine,
  ParseInput,
  ParsedDocument,
} from "./types";

export type { DocumentParser, ExtractedLine, ParseInput, ParsedDocument };
export { ClaudeDocumentParser } from "./claude-parser";

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
 * Resolve the active parser based on the environment:
 *   * ANTHROPIC_API_KEY set → the Claude vision/document parser.
 *   * otherwise → the deterministic stub (keeps the flow working offline).
 *
 * The Textract seam (OCR_SERVICE_URL) can be added the same way.
 */
export function getParser(): DocumentParser {
  if (process.env.ANTHROPIC_API_KEY) {
    return new ClaudeDocumentParser();
  }
  return new StubDocumentParser();
}
