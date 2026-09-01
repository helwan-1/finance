import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { DEMO_DOCUMENTS } from "@/lib/demo-documents";
import { getParser } from "@/lib/ocr";
import type {
  DocumentDTO,
  DocumentType,
  DocumentsResponse,
} from "@/lib/ui-types";

const VALID_TYPES: DocumentType[] = [
  "INVOICE",
  "BANK_STATEMENT",
  "VAT_RETURN",
  "GENERAL_LEDGER",
  "PURCHASE_ORDER",
  "RECEIPT",
  "OTHER",
];

/** GET /api/documents?engagementId=... — tenant-scoped document list. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const engagementId = searchParams.get("engagementId");

  try {
    if (!engagementId) {
      return NextResponse.json<DocumentsResponse>({
        documents: DEMO_DOCUMENTS,
      });
    }

    const engagement = await prisma.auditEngagement.findUnique({
      where: { id: engagementId },
      select: { auditFirmId: true },
    });
    if (!engagement) {
      return NextResponse.json<DocumentsResponse>({
        documents: DEMO_DOCUMENTS,
      });
    }

    const rows = await prisma.document.findMany({
      where: { auditFirmId: engagement.auditFirmId, engagementId },
      orderBy: { uploadedAt: "desc" },
      include: { _count: { select: { transactions: true } } },
    });

    const documents: DocumentDTO[] = rows.map((d) => ({
      id: d.id,
      type: d.type,
      status: d.status,
      fileName: d.fileName,
      mimeType: d.mimeType,
      sizeBytes: d.sizeBytes,
      pageCount: d.pageCount,
      uploadedAt: d.uploadedAt.toISOString(),
      parsedAt: d.parsedAt?.toISOString() ?? null,
      extractedCount: d.status === "PARSED" ? d._count.transactions : null,
    }));

    return NextResponse.json<DocumentsResponse>({ documents });
  } catch {
    return NextResponse.json<DocumentsResponse>({ documents: DEMO_DOCUMENTS });
  }
}

interface UploadBody {
  engagementId?: string;
  fileName?: string;
  mimeType?: string;
  sizeBytes?: number;
  type?: DocumentType;
}

/**
 * POST /api/documents — register an uploaded document and run the OCR parser.
 *
 * The file bytes would be streamed to object storage in production; here we
 * accept metadata and run the (stub) parser so the upload → parse → extract
 * flow is exercised end to end. Persists when a database is available;
 * otherwise returns a synthesized parsed document.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: UploadBody;
  try {
    body = (await request.json()) as UploadBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const fileName = body.fileName?.trim();
  const mimeType = body.mimeType?.trim() || "application/octet-stream";
  const sizeBytes =
    typeof body.sizeBytes === "number" && body.sizeBytes >= 0
      ? Math.floor(body.sizeBytes)
      : 0;
  const type: DocumentType =
    body.type && VALID_TYPES.includes(body.type) ? body.type : "OTHER";

  if (!fileName) {
    return NextResponse.json({ error: "fileName is required" }, { status: 400 });
  }

  const parser = getParser();
  const parsed = await parser.parse({
    fileName,
    mimeType,
    sizeBytes,
    documentType: type,
  });

  try {
    const engagement = body.engagementId
      ? await prisma.auditEngagement.findUnique({
          where: { id: body.engagementId },
          select: { id: true, auditFirmId: true },
        })
      : null;

    if (!engagement) {
      // No DB / unknown engagement: return a synthesized parsed document.
      const dto: DocumentDTO = {
        id: `doc-${Date.now()}`,
        type,
        status: "PARSED",
        fileName,
        mimeType,
        sizeBytes,
        pageCount: parsed.pageCount,
        uploadedAt: new Date().toISOString(),
        parsedAt: new Date().toISOString(),
        extractedCount: parsed.lines.length,
      };
      return NextResponse.json({ document: dto }, { status: 201 });
    }

    // Persist the document + extracted transactions in one transaction.
    const created = await prisma.$transaction(async (tx) => {
      const doc = await tx.document.create({
        data: {
          auditFirmId: engagement.auditFirmId,
          engagementId: engagement.id,
          type,
          status: "PARSED",
          fileName,
          storageKey: `engagements/${engagement.id}/${Date.now()}-${fileName}`,
          mimeType,
          sizeBytes,
          pageCount: parsed.pageCount,
          parsedData: parsed as unknown as object,
          parsedAt: new Date(),
        },
      });

      for (const line of parsed.lines) {
        await tx.transaction.create({
          data: {
            auditFirmId: engagement.auditFirmId,
            engagementId: engagement.id,
            documentId: doc.id,
            reference: line.reference,
            description: line.description,
            amount: line.amount,
            vatAmount: line.vatAmount ?? null,
            currency: "SAR",
            type: "DEBIT",
            source: "INVOICE",
            counterparty: line.counterparty ?? null,
            postedAt: line.date ? new Date(line.date) : new Date(),
            valueDate: line.date ? new Date(line.date) : new Date(),
          },
        });
      }

      return doc;
    });

    const dto: DocumentDTO = {
      id: created.id,
      type: created.type,
      status: created.status,
      fileName: created.fileName,
      mimeType: created.mimeType,
      sizeBytes: created.sizeBytes,
      pageCount: created.pageCount,
      uploadedAt: created.uploadedAt.toISOString(),
      parsedAt: created.parsedAt?.toISOString() ?? null,
      extractedCount: parsed.lines.length,
    };
    return NextResponse.json({ document: dto }, { status: 201 });
  } catch {
    // DB error: still return the parsed result so the UI can proceed.
    const dto: DocumentDTO = {
      id: `doc-${Date.now()}`,
      type,
      status: "PARSED",
      fileName,
      mimeType,
      sizeBytes,
      pageCount: parsed.pageCount,
      uploadedAt: new Date().toISOString(),
      parsedAt: new Date().toISOString(),
      extractedCount: parsed.lines.length,
    };
    return NextResponse.json({ document: dto }, { status: 201 });
  }
}
