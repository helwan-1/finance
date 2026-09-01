"use client";

import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Upload, Loader2 } from "lucide-react";
import { useUIStore } from "@/store/ui-store";
import type {
  DocumentDTO,
  DocumentType,
  DocumentsResponse,
} from "@/lib/ui-types";
import { DOCUMENT_TYPE_LABELS_AR } from "@/lib/labels";

const TYPE_OPTIONS = Object.keys(DOCUMENT_TYPE_LABELS_AR) as DocumentType[];

async function uploadDocument(input: {
  engagementId: string;
  file: File;
  type: DocumentType;
}): Promise<DocumentDTO> {
  const res = await fetch("/api/documents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      engagementId: input.engagementId,
      fileName: input.file.name,
      mimeType: input.file.type,
      sizeBytes: input.file.size,
      type: input.type,
    }),
  });
  if (!res.ok) throw new Error("فشل رفع المستند");
  const data = (await res.json()) as { document: DocumentDTO };
  return data.document;
}

/**
 * Upload control: pick a file + type, POST metadata to the documents API which
 * runs the OCR parser, then prepend the returned document to the cached list.
 */
export function UploadButton() {
  const engagementId = useUIStore((s) => s.engagementId);
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pendingType, setPendingType] = useState<DocumentType>("OTHER");

  const mutation = useMutation({
    mutationFn: uploadDocument,
    onSuccess: (doc) => {
      queryClient.setQueryData<DocumentsResponse>(
        ["documents", engagementId],
        (prev) =>
          prev
            ? { documents: [doc, ...prev.documents] }
            : { documents: [doc] },
      );
    },
  });

  function onFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    mutation.mutate({ engagementId, file, type: pendingType });
    // Reset so the same file can be re-selected.
    event.target.value = "";
  }

  return (
    <div className="flex items-center gap-2">
      <select
        value={pendingType}
        onChange={(e) => setPendingType(e.target.value as DocumentType)}
        className="surface rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500/40"
        aria-label="نوع المستند"
      >
        {TYPE_OPTIONS.map((t) => (
          <option key={t} value={t}>
            {DOCUMENT_TYPE_LABELS_AR[t]}
          </option>
        ))}
      </select>

      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={onFileChange}
        accept=".pdf,.csv,.jpg,.jpeg,.png,.xlsx"
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={mutation.isPending}
        className="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
      >
        {mutation.isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Upload className="h-4 w-4" />
        )}
        رفع مستند
      </button>

      {mutation.isError && (
        <span className="text-xs text-severity-critical">فشل الرفع</span>
      )}
    </div>
  );
}
