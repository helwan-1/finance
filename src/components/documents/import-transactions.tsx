"use client";

import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Table2, Download, Loader2 } from "lucide-react";
import { useUIStore } from "@/store/ui-store";

interface ImportResult {
  created: number;
  skipped: number;
  errors: string[];
}

/**
 * Import ledger transactions from a CSV directly (no OCR), plus a template
 * download. This is the accurate path for real data — values are stored exactly
 * as entered.
 */
export function ImportTransactions() {
  const engagementId = useUIStore((s) => s.engagementId);
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.set("file", file);
      form.set("engagementId", engagementId);
      const res = await fetch("/api/transactions/import", { method: "POST", body: form });
      const data = (await res.json().catch(() => ({}))) as ImportResult & { error?: string };
      if (!res.ok && !data.created) throw new Error(data.error ?? "فشل الاستيراد");
      return data;
    },
    onSuccess: (r) => {
      setMsg(`تم استيراد ${r.created} معاملة${r.skipped ? ` — تم تخطّي ${r.skipped}` : ""}. شغّل التدقيق الآن.`);
      void queryClient.invalidateQueries({ queryKey: ["anomalies"] });
      void queryClient.invalidateQueries({ queryKey: ["anomalies-summary"] });
      void queryClient.invalidateQueries({ queryKey: ["analytics"] });
    },
    onError: (e) => setMsg((e as Error).message),
  });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <a
        href="/api/transactions/template"
        className="surface flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/5"
      >
        <Download className="h-4 w-4" />
        قالب المعاملات
      </a>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) { setMsg(null); mutation.mutate(f); }
          e.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={mutation.isPending}
        className="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
      >
        {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Table2 className="h-4 w-4" />}
        استيراد معاملات (CSV)
      </button>
      {msg && <span className="text-xs text-[rgb(var(--muted))]">{msg}</span>}
    </div>
  );
}
