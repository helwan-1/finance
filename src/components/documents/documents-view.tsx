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
import { DOCUMENT_STATUS_BADGE } from "@/lib/labels";
import { formatBytes, formatDateTime } from "@/lib/format";
import { useT } from "@/lib/i18n/use-t";
import { useLabels } from "@/lib/i18n/use-labels";
import { UploadButton } from "./upload-button";
import { ImportTransactions } from "./import-transactions";
import { ImportedDatasets } from "./imported-datasets";
import { DocumentActions } from "./document-actions";

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
  const { t } = useT();
  const engagementId = useUIStore((s) => s.engagementId);
  const { data, isPending, isError } = useQuery({
    queryKey: ["documents", engagementId],
    queryFn: () => fetchDocuments(engagementId),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-[rgb(var(--muted))]">
          {data ? t("documents.documentCount", { count: data.documents.length }) : " "}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <ImportTransactions />
          <UploadButton />
        </div>
      </div>

      <div className="surface rounded-lg border border-brand-500/20 bg-brand-50/50 px-4 py-2.5 text-xs text-[rgb(var(--muted))] dark:bg-brand-700/5">
        💡 <span className="font-medium">{t("documents.tipImportName")}</span> {t("documents.tipImportBody")} <span className="font-medium">{t("documents.tipUploadName")}</span> {t("documents.tipUploadBody")} <span className="font-medium">{t("documents.tipUploadEmphasis")}</span> {t("documents.tipUploadSuffix")}
      </div>

      <ImportedDatasets />

      <div>
        <h2 className="mb-2 text-sm font-semibold text-[rgb(var(--muted))]">{t("documents.uploadedOcrDocuments")}</h2>
      </div>

      {isPending ? (
        <div className="surface flex items-center justify-center gap-2 rounded-xl border p-12 text-[rgb(var(--muted))]">
          <Loader2 className="h-5 w-5 animate-spin" />
          {t("documents.loadingDocuments")}
        </div>
      ) : isError ? (
        <div className="surface flex flex-col items-center justify-center gap-2 rounded-xl border p-12 text-severity-critical">
          <ServerCrash className="h-6 w-6" />
          {t("documents.loadDataFailed")}
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
  const { t } = useT();
  const labels = useLabels();
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
            {labels.documentType[doc.type]} · {formatBytes(doc.sizeBytes)}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${DOCUMENT_STATUS_BADGE[doc.status]}`}
        >
          {labels.documentStatus[doc.status]}
        </span>
      </div>

      <div className="flex items-center justify-between border-t pt-3 text-xs text-[rgb(var(--muted))]">
        <span>{formatDateTime(doc.uploadedAt)}</span>
        {doc.extractedCount !== null && (
          <span className="font-medium text-[rgb(var(--foreground))]">
            {t("documents.extractedTransactionsCount", { count: doc.extractedCount })}
          </span>
        )}
      </div>

      <div className="flex items-center justify-end border-t pt-2">
        <DocumentActions doc={doc} />
      </div>
    </article>
  );
}
