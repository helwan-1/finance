import { StubDocumentParser } from "./index";
import { ClaudeDocumentParser } from "./claude-parser";
import type { DocumentParser } from "./types";

/**
 * Select the document parser and record its provider-neutral processing
 * provenance (Closure C7). Private Audit Mode makes EXTERNAL processing
 * impossible regardless of ANTHROPIC_API_KEY.
 */
export function selectParser(privateMode: boolean): {
  parser: DocumentParser;
  boundary: "INTERNAL" | "EXTERNAL";
  processorRef: string | null;
} {
  if (!privateMode && process.env.ANTHROPIC_API_KEY) {
    return { parser: new ClaudeDocumentParser(), boundary: "EXTERNAL", processorRef: "anthropic" };
  }
  return { parser: new StubDocumentParser(), boundary: "INTERNAL", processorRef: null };
}
