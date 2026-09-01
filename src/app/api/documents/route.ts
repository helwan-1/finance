import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { DEMO_DOCUMENTS } from "@/lib/demo-documents";
import { getParser } from "@/lib/ocr";
import { authorize } from "@/lib/auth/guard";
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

  const authz = await authorize("documents:view", engagementId);
  if (!authz.ok) return authz.response;

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

/**
 * POST /api/documents — register an uploaded document and run the OCR parser.
 *
 * Accepts multipart/form-data with `file`, `engagementId`, and `type`. The file
 * bytes are handed to the active parser (Claude when configured, else the stub)
 * and, when a database is available, the document plus its extracted
 * transactions are persisted in a single Prisma transaction. In production the
 * bytes would additionally be streamed to object storage.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Expected multipart/form-data" },
      { status: 400 },
    );
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }

  const engagementId = (form.get("engagementId") as string | null)?.trim() || null;
  const rawType = (form.get("type") as string | null)?.trim();
  const type: DocumentType =
    rawType && VALID_TYPES.includes(rawType as DocumentType)
      ? (rawType as DocumentType)
      : "OTHER";

  const authz = await authorize("documents:upload", engagementId);
  if (!authz.ok) return authz.response;

  const fileName = file.name;
  const mimeType = file.type || "application/octet-stream";
  const sizeBytes = file.size;
  const contentBase64 = Buffer.from(await file.arrayBuffer()).toString("base64");

  const parser = getParser();
  const parsed = await parser.parse({
    fileName,
    mimeType,
    sizeBytes,
    documentType: type,
    contentBase64,
  });

  try {
    const engagement = engagementId
      ? await prisma.auditEngagement.findUnique({
          where: { id: engagementId },
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
