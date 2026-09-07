"use client";

import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Table2, Download, Loader2 } from "lucide-react";
import { useUIStore } from "@/store/ui-store";
import type { DatasetKind } from "@/lib/import/vocab";

interface StartResult { batchId?: string; datasetId?: string; status?: string; error?: string; code?: string; rowsTotal?: number; rowsAccepted?: number; rowsRejected?: number; blockingIssues?: number }
interface ConfirmResult { datasetId?: string; transactionsCreated?: number; error?: string }

/** Dataset kinds importable via CSV, with their Arabic label and required-column hint. */
const KIND_OPTIONS: { kind: DatasetKind; labelAr: string; requiredHintAr: string }[] = [
  { kind: "GENERAL_LEDGER", labelAr: "دفتر الأستاذ", requiredHintAr: "«رقم الحساب» و«تاريخ القيد» ومبلغًا («مدين»/«دائن»/«المبلغ»)" },
  { kind: "TRIAL_BALANCE", labelAr: "ميزان المراجعة", requiredHintAr: "«رقم الحساب» ورصيدًا واحدًا على الأقل (افتتاحي/حركة/ختامي، مدين أو دائن)" },
  { kind: "BANK", labelAr: "كشف بنكي", requiredHintAr: "«تاريخ العملية» و«المبلغ»" },
  { kind: "OTHER", labelAr: "أخرى (دليل فقط)", requiredHintAr: "لا أعمدة إلزامية — يُحفظ كدليل ولا يُنشئ بيانات تدقيق" },
];

/**
 * Import a transactions CSV through the lineage-aware two-phase pipeline
 * (`/api/imports` → `/api/imports/:batchId/confirm`). The dataset kind is chosen
 * by the auditor (General Ledger / Trial Balance / Bank / Other); the source file
 * is retained under content-addressed custody, and ACCEPTED rows are canonicalized
 * into a Dataset consumable by an audit run. Values are stored exactly as entered
 * (no OCR).
 */
export function ImportTransactions() {
  const engagementId = useUIStore((s) => s.engagementId);
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [msgTone, setMsgTone] = useState<"info" | "error">("info");
  const [kind, setKind] = useState<DatasetKind>("GENERAL_LEDGER");

  const mutation = useMutation({
    mutationFn: async ({ file, datasetKind }: { file: File; datasetKind: DatasetKind }) => {
      if (!engagementId) throw new Error("اختر ارتباط تدقيق أولاً");
      // Phase 1 — upload + retain source + validate (halts at READY, no transactions).
      const form = new FormData();
      form.set("file", file);
      form.set("engagementId", engagementId);
      form.set("datasetKind", datasetKind);
      form.set("acknowledgeDuplicate", "true");
      const startRes = await fetch("/api/imports", { method: "POST", body: form });
      const start = (await startRes.json().catch(() => ({}))) as StartResult;
      if (!startRes.ok || !start.batchId) throw new Error(start.error ?? "فشل رفع الملف");
      // Phase 2 — confirm: canonicalize ACCEPTED rows into a Dataset.
      const confRes = await fetch(`/api/imports/${start.batchId}/confirm`, { method: "POST" });
      const conf = (await confRes.json().catch(() => ({}))) as ConfirmResult;
      if (!confRes.ok) throw new Error(conf.error ?? "فشل تأكيد الاستيراد");
      // The truthful accepted/rejected counts come from the START (validation) phase.
      return { start, conf, datasetKind };
    },
    onSuccess: ({ start, conf, datasetKind }) => {
      const accepted = start.rowsAccepted ?? conf.transactionsCreated ?? 0;
      const rejected = start.rowsRejected ?? 0;
      const opt = KIND_OPTIONS.find((o) => o.kind === datasetKind) ?? KIND_OPTIONS[0]!;
      if (accepted === 0) {
        setMsgTone("error");
        setMsg(
          `⚠️ لم يُقبل أي سطر${rejected ? ` (رُفض ${rejected})` : ""}. تحقّق من أعمدة الملف: «${opt.labelAr}» يتطلب ${opt.requiredHintAr}.`,
        );
      } else {
        setMsgTone("info");
        setMsg(
          `تم استيراد ${accepted} سطراً${rejected ? ` — رُفض ${rejected}` : ""} كـ«${opt.labelAr}». البيانات المستوردة جاهزة لإنشاء عملية تدقيق.`,
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
          if (f) { setMsg(null); setMsgTone("info"); mutation.mutate({ file: f, datasetKind: kind }); }
          e.target.value = "";
        }}
      />
      <label className="sr-only" htmlFor="csv-kind">نوع البيانات</label>
      <select
        id="csv-kind"
        value={kind}
        onChange={(e) => setKind(e.target.value as DatasetKind)}
        disabled={mutation.isPending}
        title="نوع البيانات المستوردة"
        className="surface rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500/40 disabled:opacity-60"
      >
        {KIND_OPTIONS.map((o) => (
          <option key={o.kind} value={o.kind}>{o.labelAr}</option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={mutation.isPending}
        title={`استيراد ملف CSV كـ«${(KIND_OPTIONS.find((o) => o.kind === kind) ?? KIND_OPTIONS[0]!).labelAr}»`}
        className="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
      >
        {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Table2 className="h-4 w-4" />}
        استيراد معاملات (CSV)
      </button>
      {msg && <span className={`text-xs ${msgTone === "error" ? "text-severity-critical" : "text-[rgb(var(--muted))]"}`}>{msg}</span>}
    </div>
  );
}
