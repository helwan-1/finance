import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { DEMO_DOCUMENTS } from "@/lib/demo-documents";
import { getParser } from "@/lib/ocr";
import { authorize } from "@/lib/auth/guard";
import { withTenantContext } from "@/lib/db/tenant";
import { publishAuditEvent } from "@/lib/events";
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

  const authz = await authorize("documents:view");
  if (!authz.ok) return authz.response;

  // Non-production demo path (no session).
  if (!authz.session) {
    return NextResponse.json<DocumentsResponse>({ documents: DEMO_DOCUMENTS });
  }
  if (!engagementId) {
    return NextResponse.json<DocumentsResponse>({ documents: [] });
  }

  try {
    const rows = await withTenantContext(authz.session.auditFirmId, (tx) =>
      tx.document.findMany({
        where: { engagementId },
        orderBy: { uploadedAt: "desc" },
        include: { _count: { select: { transactions: true } } },
      }),
    );

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
    return NextResponse.json({ error: "تعذّر تحميل المستندات" }, { status: 503 });
  }
}

/**
 * POST /api/documents — register an uploaded document and run the OCR parser.
 *
 * Fail-closed in production (a session is required). The non-production demo
 * returns a synthesized parsed document without touching the database. When
 * authenticated, the document and its extracted transactions are persisted
 * inside the caller's tenant context (RLS-scoped) in one transaction.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const authz = await authorize("documents:upload");
  if (!authz.ok) return authz.response;

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

  const synthesized = (): DocumentDTO => ({
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
  });

  // Demo path (non-production, no session): no persistence.
  if (!authz.session) {
    return NextResponse.json({ document: synthesized() }, { status: 201 });
  }
  if (!engagementId) {
    return NextResponse.json({ error: "engagementId is required" }, { status: 400 });
  }

  try {
    const created = await withTenantContext(authz.session.auditFirmId, async (tx) => {
      // RLS makes a cross-tenant / unknown engagement invisible → not found.
      const engagement = await tx.auditEngagement.findUnique({
        where: { id: engagementId },
        select: { id: true, auditFirmId: true },
      });
      if (!engagement) return null;

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

    if (!created) {
      return NextResponse.json({ error: "Engagement not found" }, { status: 404 });
    }

    publishAuditEvent({
      type: "document.created",
      engagementId,
      payload: { id: created.id, extracted: parsed.lines.length },
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
    return NextResponse.json({ error: "تعذّر حفظ المستند" }, { status: 503 });
  }
}
