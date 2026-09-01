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
  /**
   * Base64-encoded file content, when available. Required by real providers
   * (Claude / Textract); the stub ignores it.
   */
  contentBase64?: string;
}

export interface DocumentParser {
  readonly name: string;
  parse(input: ParseInput): Promise<ParsedDocument>;
}
