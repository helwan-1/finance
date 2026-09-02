"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Loader2,
  ServerCrash,
  FileText,
  FileSpreadsheet,
  FileImage,
  FileCheck2,
} from "lucide-react";
import { useUIStore } from "@/store/ui-store";
import type { DocumentDTO, DocumentsResponse } from "@/lib/ui-types";
import {
  DOCUMENT_STATUS_BADGE,
  DOCUMENT_STATUS_LABELS_AR,
  DOCUMENT_TYPE_LABELS_AR,
} from "@/lib/labels";
import { formatBytes, formatDateTime } from "@/lib/format";
import { UploadButton } from "./upload-button";
import { ImportTransactions } from "./import-transactions";

async function fetchDocuments(
  engagementId: string,
): Promise<DocumentsResponse> {
  const params = new URLSearchParams();
  if (engagementId) params.set("engagementId", engagementId);
  const res = await fetch(`/api/documents?${params.toString()}`);
  if (!res.ok) throw new Error("فشل تحميل المستندات");
  return (await res.json()) as DocumentsResponse;
}

function iconFor(mimeType: string) {
  if (mimeType.includes("pdf")) return FileText;
  if (mimeType.includes("csv") || mimeType.includes("sheet"))
    return FileSpreadsheet;
  if (mimeType.includes("image")) return FileImage;
  return FileCheck2;
}

export function DocumentsView() {
  const engagementId = useUIStore((s) => s.engagementId);
  const { data, isPending, isError } = useQuery({
    queryKey: ["documents", engagementId],
    queryFn: () => fetchDocuments(engagementId),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-[rgb(var(--muted))]">
          {data ? `${data.documents.length} مستند` : " "}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <ImportTransactions />
          <UploadButton />
        </div>
      </div>

      <div className="surface rounded-lg border border-brand-500/20 bg-brand-50/50 px-4 py-2.5 text-xs text-[rgb(var(--muted))] dark:bg-brand-700/5">
        💡 لأدق النتائج على بياناتك الحقيقية استخدم «استيراد معاملات (CSV)» — تُخزَّن
        أرقامك كما هي بلا استخراج تلقائي. رفع المستندات (OCR) يتطلب تفعيل مفتاح Claude
        لقراءة حقيقية.
      </div>

      {isPending ? (
        <div className="surface flex items-center justify-center gap-2 rounded-xl border p-12 text-[rgb(var(--muted))]">
          <Loader2 className="h-5 w-5 animate-spin" />
          جارٍ تحميل المستندات...
        </div>
      ) : isError ? (
        <div className="surface flex flex-col items-center justify-center gap-2 rounded-xl border p-12 text-severity-critical">
          <ServerCrash className="h-6 w-6" />
          تعذّر تحميل البيانات.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.documents.map((doc) => (
            <DocumentCard key={doc.id} doc={doc} Icon={iconFor(doc.mimeType)} />
          ))}
        </div>
      )}
    </div>
  );
}

function DocumentCard({
  doc,
  Icon,
}: {
  doc: DocumentDTO;
  Icon: typeof FileText;
}) {
  return (
    <article className="surface flex flex-col gap-3 rounded-xl border p-4 shadow-card">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-black/5 dark:bg-white/5">
          <Icon className="h-5 w-5 text-brand-600" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-medium" title={doc.fileName}>
            {doc.fileName}
          </h3>
          <p className="text-xs text-[rgb(var(--muted))]">
            {DOCUMENT_TYPE_LABELS_AR[doc.type]} · {formatBytes(doc.sizeBytes)}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${DOCUMENT_STATUS_BADGE[doc.status]}`}
        >
          {DOCUMENT_STATUS_LABELS_AR[doc.status]}
        </span>
      </div>

      <div className="flex items-center justify-between border-t pt-3 text-xs text-[rgb(var(--muted))]">
        <span>{formatDateTime(doc.uploadedAt)}</span>
        {doc.extractedCount !== null && (
          <span className="font-medium text-[rgb(var(--foreground))]">
            {doc.extractedCount} حركة مستخرجة
          </span>
        )}
      </div>
    </article>
  );
}
