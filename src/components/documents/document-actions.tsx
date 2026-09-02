"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil, Trash2, Loader2, X } from "lucide-react";
import type { DocumentDTO, DocumentType } from "@/lib/ui-types";
import { DOCUMENT_TYPE_LABELS_AR } from "@/lib/labels";

const TYPES = Object.keys(DOCUMENT_TYPE_LABELS_AR) as DocumentType[];
const input = "surface w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500/40";

export function DocumentActions({ doc }: { doc: DocumentDTO }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [fileName, setFileName] = useState(doc.fileName);
  const [type, setType] = useState<DocumentType>(doc.type);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["documents"] });
    void queryClient.invalidateQueries({ queryKey: ["anomalies"] });
    void queryClient.invalidateQueries({ queryKey: ["anomalies-summary"] });
  };

  const save = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/documents/${doc.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName, type }),
      });
      if (!res.ok) throw new Error("فشل الحفظ");
    },
    onSuccess: () => { invalidate(); setEditing(false); },
  });

  const remove = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/documents/${doc.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("فشل الحذف");
    },
    onSuccess: invalidate,
  });

  return (
    <>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="rounded-lg p-1.5 text-[rgb(var(--muted))] hover:bg-black/5 hover:text-brand-600 dark:hover:bg-white/5"
          title="تعديل"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          disabled={remove.isPending}
          onClick={() => {
            if (window.confirm(`حذف «${doc.fileName}» وكل الحركات المستخرجة منه؟`)) {
              remove.mutate();
            }
          }}
          className="rounded-lg p-1.5 text-[rgb(var(--muted))] hover:bg-severity-critical/10 hover:text-severity-critical"
          title="حذف"
        >
          {remove.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
        </button>
      </div>

      {editing && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4" onMouseDown={() => setEditing(false)}>
          <form
            onMouseDown={(e) => e.stopPropagation()}
            onSubmit={(e) => { e.preventDefault(); save.mutate(); }}
            className="surface w-full max-w-md space-y-4 rounded-2xl border p-5 shadow-card"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">تعديل المستند</h3>
              <button type="button" onClick={() => setEditing(false)} className="rounded-lg p-1 hover:bg-black/5 dark:hover:bg-white/5">
                <X className="h-4 w-4" />
              </button>
            </div>
            <label className="block space-y-1 text-sm">
              <span className="text-[rgb(var(--muted))]">اسم الملف</span>
              <input className={input} value={fileName} onChange={(e) => setFileName(e.target.value)} />
            </label>
            <label className="block space-y-1 text-sm">
              <span className="text-[rgb(var(--muted))]">النوع</span>
              <select className={input} value={type} onChange={(e) => setType(e.target.value as DocumentType)}>
                {TYPES.map((t) => <option key={t} value={t}>{DOCUMENT_TYPE_LABELS_AR[t]}</option>)}
              </select>
            </label>
            {save.isError && <p className="text-sm text-severity-critical">فشل الحفظ</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setEditing(false)} className="rounded-lg border px-4 py-2 text-sm">إلغاء</button>
              <button type="submit" disabled={save.isPending} className="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60">
                {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                حفظ
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
