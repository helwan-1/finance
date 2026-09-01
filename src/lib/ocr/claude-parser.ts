/**
 * Claude-powered document parser.
 *
 * Uses the Anthropic SDK to extract structured financial line items from an
 * uploaded document (image, PDF, or text/CSV). Claude is asked to call a single
 * extraction tool whose input is our `ParsedDocument` shape, so the result is
 * structured rather than free text.
 *
 * Activated by `getParser()` when `ANTHROPIC_API_KEY` is set. Requires the file
 * bytes (`ParseInput.contentBase64`).
 */

import Anthropic from "@anthropic-ai/sdk";
import type { DocumentType } from "../ui-types";
import type {
  DocumentParser,
  ExtractedLine,
  ParseInput,
  ParsedDocument,
} from "./types";

const DOCUMENT_TYPES: DocumentType[] = [
  "INVOICE",
  "BANK_STATEMENT",
  "VAT_RETURN",
  "GENERAL_LEDGER",
  "PURCHASE_ORDER",
  "RECEIPT",
  "OTHER",
];

const EXTRACTION_TOOL: Anthropic.Tool = {
  name: "record_document",
  description:
    "Record the structured financial line items extracted from the document.",
  input_schema: {
    type: "object",
    properties: {
      documentType: { type: "string", enum: DOCUMENT_TYPES },
      pageCount: { type: "integer", minimum: 1 },
      lines: {
        type: "array",
        description: "One entry per financial line item / transaction.",
        items: {
          type: "object",
          properties: {
            reference: { type: "string" },
            description: { type: "string" },
            amount: {
              type: "string",
              description: "Net/taxable amount as a decimal string, e.g. 1234.50",
            },
            vatAmount: {
              type: "string",
              description: "VAT amount as a decimal string, if present.",
            },
            date: { type: "string", description: "ISO date, if present." },
            counterparty: { type: "string" },
          },
          required: ["reference", "description", "amount"],
        },
      },
    },
    required: ["documentType", "pageCount", "lines"],
  },
};

/** Build the content block for the document based on its MIME type. */
function contentBlock(input: ParseInput): Anthropic.ContentBlockParam {
  const data = input.contentBase64 ?? "";
  if (input.mimeType.startsWith("image/")) {
    return {
      type: "image",
      source: {
        type: "base64",
        media_type: input.mimeType as
          | "image/jpeg"
          | "image/png"
          | "image/gif"
          | "image/webp",
        data,
      },
    };
  }
  if (input.mimeType === "application/pdf") {
    return {
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data },
    };
  }
  // Text / CSV: decode and inline as text so Claude can read it directly.
  const text = Buffer.from(data, "base64").toString("utf8");
  return { type: "text", text: `Document content:\n\n${text}` };
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Defensively normalize the tool input into our ParsedDocument shape. */
function normalize(
  input: ParseInput,
  raw: Record<string, unknown>,
): ParsedDocument {
  const rawLines = Array.isArray(raw.lines) ? raw.lines : [];
  const lines: ExtractedLine[] = [];
  for (const entry of rawLines) {
    if (typeof entry !== "object" || entry === null) continue;
    const e = entry as Record<string, unknown>;
    const amount = asString(e.amount);
    const reference = asString(e.reference);
    const description = asString(e.description);
    if (!amount || !reference || !description) continue;
    lines.push({
      reference,
      description,
      amount,
      vatAmount: asString(e.vatAmount),
      date: asString(e.date),
      counterparty: asString(e.counterparty),
    });
  }

  const documentType =
    typeof raw.documentType === "string" &&
    DOCUMENT_TYPES.includes(raw.documentType as DocumentType)
      ? (raw.documentType as DocumentType)
      : input.documentType;

  const pageCount =
    typeof raw.pageCount === "number" && raw.pageCount > 0
      ? Math.floor(raw.pageCount)
      : 1;

  return { provider: "claude", documentType, pageCount, lines };
}

export class ClaudeDocumentParser implements DocumentParser {
  readonly name = "claude";
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(client?: Anthropic, model = "claude-opus-5") {
    // The zero-arg client resolves ANTHROPIC_API_KEY / auth profile.
    this.client = client ?? new Anthropic();
    this.model = model;
  }

  async parse(input: ParseInput): Promise<ParsedDocument> {
    if (!input.contentBase64) {
      throw new Error(
        "ClaudeDocumentParser requires file content (contentBase64).",
      );
    }

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      // Forced single-tool extraction; thinking disabled is the standard,
      // low-latency pattern for a forced tool call.
      thinking: { type: "disabled" },
      tools: [EXTRACTION_TOOL],
      tool_choice: { type: "tool", name: EXTRACTION_TOOL.name },
      messages: [
        {
          role: "user",
          content: [
            contentBlock(input),
            {
              type: "text",
              text: `Extract every financial line item from this ${input.documentType} ("${input.fileName}"). Amounts must be decimal strings. Call the record_document tool with the results.`,
            },
          ],
        },
      ],
    });

    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
    );
    if (!toolUse) {
      throw new Error("Claude did not return a structured extraction.");
    }

    return normalize(input, toolUse.input as Record<string, unknown>);
  }
}
