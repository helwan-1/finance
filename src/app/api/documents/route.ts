import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { DEMO_DOCUMENTS } from "@/lib/demo-documents";
import { StubDocumentParser } from "@/lib/ocr";
import { selectParser } from "@/lib/ocr/select";
import { authorize } from "@/lib/auth/guard";
import { withTenantContext } from "@/lib/db/tenant";
import { getStorageAdapter, firmBucket } from "@/lib/storage";
import { sha256Bytes } from "@/lib/import/canonical";
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
  const bytes = Buffer.from(await file.arrayBuffer());
  const contentBase64 = bytes.toString("base64");

  const synthesized = (pageCount: number, extractedCount: number): DocumentDTO => ({
    id: `doc-${Date.now()}`,
    type,
    status: "PARSED",
    fileName,
    mimeType,
    sizeBytes,
    pageCount,
    uploadedAt: new Date().toISOString(),
    parsedAt: new Date().toISOString(),
    extractedCount,
  });

  // Demo path (non-production, no session): stub parse, no persistence, no egress.
  if (!authz.session) {
    const p = await new StubDocumentParser().parse({ fileName, mimeType, sizeBytes, documentType: type, contentBase64 });
    return NextResponse.json({ document: synthesized(p.pageCount, p.lines.length) }, { status: 201 });
  }
  if (!engagementId) {
    return NextResponse.json({ error: "engagementId is required" }, { status: 400 });
  }
  const firmId = authz.session.auditFirmId;
  const userId = authz.session.userId;

  // Enforce Private Audit Mode, then parse (provider-neutral provenance).
  const firm = await withTenantContext(firmId, (tx) =>
    tx.auditFirm.findUnique({ where: { id: firmId }, select: { settings: true } }),
  );
  const privateMode = !!(firm?.settings as { privateMode?: boolean } | null)?.privateMode;
  const { parser, boundary, processorRef } = selectParser(privateMode);
  const parsed = await parser.parse({ fileName, mimeType, sizeBytes, documentType: type, contentBase64 });

  // Store original bytes (custody) and confirm RETAINED before persisting.
  const sha = sha256Bytes(bytes);
  const adapter = getStorageAdapter();
  const bucket = firmBucket(firmId);
  await adapter.put(bucket, sha, bytes);
  const st = await adapter.stat(bucket, sha);
  const retained = !!st && st.sizeBytes === bytes.length;

  try {
    const created = await withTenantContext(authz.session.auditFirmId, async (tx) => {
      // RLS makes a cross-tenant / unknown engagement invisible → not found.
      const engagement = await tx.auditEngagement.findUnique({
        where: { id: engagementId },
        select: { id: true, auditFirmId: true },
      });
      if (!engagement) return null;

      // Custody: create the SourceFile for the original bytes, then link it.
      const sf = await tx.sourceFile.create({
        data: {
          auditFirmId: engagement.auditFirmId,
          engagementId: engagement.id,
          originalFileName: fileName,
          mimeType,
          sizeBytes: BigInt(bytes.length),
          sha256: sha,
          uploadedById: userId,
          storageProvider: "OBJECT_STORE",
          storageBucket: bucket,
          storageObjectKey: sha,
          custodyStatus: retained ? "RETAINED" : "NOT_RETAINED",
          processingBoundary: boundary,
          processorRef,
        },
        select: { id: true },
      });

      const doc = await tx.document.create({
        data: {
          auditFirmId: engagement.auditFirmId,
          engagementId: engagement.id,
          type,
          status: "PARSED",
          fileName,
          storageKey: `${bucket}/${sha}`,
          sourceFileId: sf.id,
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
