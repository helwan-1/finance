"use client";

import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Table2, Download, Loader2 } from "lucide-react";
import { useUIStore } from "@/store/ui-store";

interface StartResult { batchId?: string; datasetId?: string; status?: string; error?: string; code?: string; rowsTotal?: number; rowsAccepted?: number; rowsRejected?: number; blockingIssues?: number }
interface ConfirmResult { datasetId?: string; transactionsCreated?: number; error?: string }

/**
 * Import a general-ledger CSV through the lineage-aware two-phase pipeline
 * (`/api/imports` → `/api/imports/:batchId/confirm`). The source file is retained
 * under content-addressed custody; ACCEPTED rows are canonicalized into a Dataset
 * consumable by an audit run. Values are stored exactly as entered (no OCR).
 */
export function ImportTransactions() {
  const engagementId = useUIStore((s) => s.engagementId);
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [msgTone, setMsgTone] = useState<"info" | "error">("info");

  const mutation = useMutation({
    mutationFn: async (file: File) => {
      if (!engagementId) throw new Error("اختر ارتباط تدقيق أولاً");
      // Phase 1 — upload + retain source + validate (halts at READY, no transactions).
      const form = new FormData();
      form.set("file", file);
      form.set("engagementId", engagementId);
      form.set("datasetKind", "GENERAL_LEDGER");
      form.set("acknowledgeDuplicate", "true");
      const startRes = await fetch("/api/imports", { method: "POST", body: form });
      const start = (await startRes.json().catch(() => ({}))) as StartResult;
      if (!startRes.ok || !start.batchId) throw new Error(start.error ?? "فشل رفع الملف");
      // Phase 2 — confirm: canonicalize ACCEPTED rows into a Dataset.
      const confRes = await fetch(`/api/imports/${start.batchId}/confirm`, { method: "POST" });
      const conf = (await confRes.json().catch(() => ({}))) as ConfirmResult;
      if (!confRes.ok) throw new Error(conf.error ?? "فشل تأكيد الاستيراد");
      // The truthful accepted/rejected counts come from the START (validation) phase.
      return { start, conf };
    },
    onSuccess: ({ start, conf }) => {
      const accepted = start.rowsAccepted ?? conf.transactionsCreated ?? 0;
      const rejected = start.rowsRejected ?? 0;
      if (accepted === 0) {
        setMsgTone("error");
        setMsg(
          `⚠️ لم يُقبل أي سطر${rejected ? ` (رُفض ${rejected})` : ""}. تحقّق من أعمدة الملف: دفتر الأستاذ يتطلب «رقم الحساب» و«تاريخ القيد» ومبلغًا («مدين»/«دائن»/«المبلغ»).`,
        );
      } else {
        setMsgTone("info");
        setMsg(
          `تم استيراد ${accepted} سطراً${rejected ? ` — رُفض ${rejected}` : ""}. البيانات المستوردة جاهزة لإنشاء عملية تدقيق.`,
        );
      }
      void queryClient.invalidateQueries({ queryKey: ["datasets"] });
      void queryClient.invalidateQueries({ queryKey: ["anomalies"] });
      void queryClient.invalidateQueries({ queryKey: ["analytics"] });
    },
    onError: (e) => { setMsgTone("error"); setMsg((e as Error).message); },
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
          if (f) { setMsg(null); setMsgTone("info"); mutation.mutate(f); }
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
      {msg && <span className={`text-xs ${msgTone === "error" ? "text-severity-critical" : "text-[rgb(var(--muted))]"}`}>{msg}</span>}
    </div>
  );
}
