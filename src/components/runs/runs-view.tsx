"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Play, FileCheck2, Rocket, RefreshCw } from "lucide-react";
import { useUIStore } from "@/store/ui-store";

interface RunSummary { id: string; status: string; label: string | null; freezeGeneration: string | null; configFingerprint: string | null; createdAt: string }
interface Prep { id: string; generationNo: number; status: string; failureCode: string | null }
interface DatasetOption { id: string; kind: string; status: string; datasetHash?: string | null; createdAt?: string }

const DS_KIND_AR: Record<string, string> = {
  GENERAL_LEDGER: "دفتر الأستاذ",
  TRIAL_BALANCE: "ميزان المراجعة",
  BANK: "كشف بنكي",
  OTHER: "أخرى",
};
const DS_STATUS_AR: Record<string, string> = {
  COMPLETED: "مكتملة",
  COMPLETED_WITH_ISSUES: "مكتملة مع ملاحظات",
};
function fmtDate(iso?: string): string {
  if (!iso) return "";
  try { return new Intl.DateTimeFormat("ar", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso)); } catch { return iso; }
}
interface TestOption { key: string; name: string; nameAr: string; testType: string }
interface JobSummary { id: string; attemptNo: number; status: string; failureCode: string | null }
interface ResultSummary { id: string; resultCode: string; severity: string; resultSemanticFingerprint: string }

const card = "surface rounded-xl border p-4";
const btn = "inline-flex items-center gap-2 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60";
const ghost = "inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-60";

async function jget<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "فشل التحميل");
  return (await r.json()) as T;
}
async function jpost<T>(url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const d = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(d.error ?? "فشلت العملية");
  return d;
}
const isTerminal = (s: string) => ["COMPLETED", "FAILED", "CANCELLED"].includes(s);

export function RunsView() {
  const engagementId = useUIStore((s) => s.engagementId);
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [pickedDatasets, setPickedDatasets] = useState<Set<string>>(new Set());
  const [pickedTests, setPickedTests] = useState<Set<string>>(new Set());
  const [err, setErr] = useState<string | null>(null);

  // Switching engagements must not leak the selected run or the dataset/test
  // picks across engagements — reset them so each engagement starts clean.
  useEffect(() => {
    setSelected(null);
    setPickedDatasets(new Set());
    setPickedTests(new Set());
    setErr(null);
  }, [engagementId]);

  const runs = useQuery({
    queryKey: ["runs", engagementId],
    queryFn: () => jget<{ runs: RunSummary[] }>(`/api/runs?engagementId=${engagementId}`).then((d) => d.runs),
    enabled: Boolean(engagementId),
    // Auto-refresh while any run is still working, so QUEUED/RUNNING flips to
    // COMPLETED in the list without a manual refresh.
    refetchInterval: (q) =>
      (q.state.data as RunSummary[] | undefined)?.some((r) => ["PREPARING", "QUEUED", "RUNNING"].includes(r.status)) ? 3000 : false,
  });
  const datasets = useQuery({
    queryKey: ["datasets", engagementId],
    queryFn: () => jget<{ datasets: DatasetOption[] }>(`/api/datasets?engagementId=${engagementId}`).then((d) => d.datasets),
    enabled: Boolean(engagementId),
  });
  const tests = useQuery({
    queryKey: ["audit-tests"],
    queryFn: () => jget<{ tests: TestOption[] }>(`/api/audit-tests`).then((d) => d.tests),
    enabled: Boolean(engagementId),
  });
  const run = runs.data?.find((r) => r.id === selected) ?? null;
  const prep = useQuery({
    queryKey: ["prep", selected],
    queryFn: () => jget<{ preparation: Prep | null }>(`/api/runs/${selected}/preparation`).then((d) => d.preparation),
    enabled: Boolean(selected),
    refetchInterval: (q) => (q.state.data && q.state.data.status === "PREPARING" ? 2000 : false),
  });
  const jobs = useQuery({
    queryKey: ["jobs", selected],
    queryFn: () => jget<{ jobs: JobSummary[] }>(`/api/runs/${selected}/jobs`).then((d) => d.jobs),
    enabled: Boolean(selected && run && run.status !== "DRAFT" && run.status !== "PREPARING"),
    refetchInterval: () => (run && !isTerminal(run.status) ? 2500 : false),
  });
  const results = useQuery({
    queryKey: ["results", selected],
    queryFn: () => jget<{ results: ResultSummary[] }>(`/api/runs/${selected}/results`).then((d) => d.results),
    enabled: Boolean(selected && run && run.status === "COMPLETED"),
  });

  const createRun = useMutation({
    mutationFn: () => jpost<{ runId: string }>(`/api/runs`, { engagementId }),
    onSuccess: (d) => { setSelected(d.runId); void qc.invalidateQueries({ queryKey: ["runs", engagementId] }); },
    onError: (e) => setErr((e as Error).message),
  });
  const beginPrep = useMutation({
    mutationFn: () => jpost<{ prepId: string }>(`/api/runs/${selected}/preparation`, { tests: [...pickedTests].map((testKey) => ({ testKey })), datasetIds: [...pickedDatasets] }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["prep", selected] }); void qc.invalidateQueries({ queryKey: ["runs", engagementId] }); },
    onError: (e) => setErr((e as Error).message),
  });
  const publish = useMutation({
    mutationFn: (prepId: string) => jpost(`/api/runs/${selected}/publish`, { prepId }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["runs", engagementId] }); void qc.invalidateQueries({ queryKey: ["jobs", selected] }); },
    onError: (e) => setErr((e as Error).message),
  });

  if (!engagementId) return <div className={card}>اختر ارتباط تدقيق من الأعلى لعرض عمليات التدقيق.</div>;

  const toggle = (set: Set<string>, id: string, apply: (s: Set<string>) => void) => { const n = new Set(set); if (n.has(id)) n.delete(id); else n.add(id); apply(n); };
  const canBegin = pickedDatasets.size > 0 && pickedTests.size > 0 && (run?.status === "DRAFT" || run?.status === "PREPARING");

  return (
    <div className="space-y-4">
      {err && <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-600">{err}</div>}

      <div className={card}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">عمليات التدقيق</h2>
          <div className="flex gap-2">
            <button className={ghost} onClick={() => void runs.refetch()}><RefreshCw className="h-4 w-4" />تحديث</button>
            <button className={btn} disabled={createRun.isPending} onClick={() => { setErr(null); createRun.mutate(); }}>
              {createRun.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}إنشاء عملية تدقيق
            </button>
          </div>
        </div>
        {runs.isPending ? <p className="text-sm text-[rgb(var(--muted))]">جارٍ التحميل…</p> : (runs.data?.length ?? 0) === 0 ? (
          <p className="text-sm text-[rgb(var(--muted))]">لا توجد عمليات تدقيق بعد.</p>
        ) : (
          <ul className="divide-y">
            {runs.data!.map((r) => (
              <li key={r.id}>
                <button className={`flex w-full items-center justify-between py-2 text-right text-sm ${selected === r.id ? "font-semibold text-brand-600" : ""}`} onClick={() => setSelected(r.id)}>
                  <span className="truncate">{r.label ?? r.id.slice(0, 12)}</span>
                  <span className="rounded-full border px-2 py-0.5 text-xs">{r.status}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {run && (
        <div className={card}>
          <h3 className="mb-2 font-semibold">تفاصيل عملية التدقيق — <span className="text-xs text-[rgb(var(--muted))]">{run.id}</span></h3>
          <p className="mb-3 text-sm">الحالة: <span className="rounded-full border px-2 py-0.5 text-xs">{run.status}</span></p>

          {(run.status === "DRAFT" || run.status === "PREPARING") && (!prep.data || prep.data.status === "FAILED") && (
            <div className="space-y-3">
              <div>
                <p className="mb-1 text-sm font-medium">البيانات المستوردة</p>
                {datasets.data?.length ? datasets.data.map((d) => (
                  <label key={d.id} className="flex items-center gap-2 py-1 text-sm">
                    <input type="checkbox" checked={pickedDatasets.has(d.id)} onChange={() => toggle(pickedDatasets, d.id, setPickedDatasets)} />
                    <span>
                      {DS_KIND_AR[d.kind] ?? d.kind}
                      {d.createdAt && <span className="text-[rgb(var(--muted))]"> · {fmtDate(d.createdAt)}</span>}
                      {d.datasetHash && <span className="font-mono text-[11px] text-[rgb(var(--muted))]"> · {d.datasetHash.slice(0, 10)}</span>}
                      <span className="text-[rgb(var(--muted))]"> ({DS_STATUS_AR[d.status] ?? d.status})</span>
                    </span>
                  </label>
                )) : <p className="text-xs text-[rgb(var(--muted))]">لا توجد بيانات مستوردة. استورد ملفاً أولاً.</p>}
              </div>
              <div>
                <p className="mb-1 text-sm font-medium">اختبارات التدقيق</p>
                {tests.data?.length ? tests.data.map((t) => (
                  <label key={t.key} className="flex items-center gap-2 py-1 text-sm">
                    <input type="checkbox" checked={pickedTests.has(t.key)} onChange={() => toggle(pickedTests, t.key, setPickedTests)} />
                    <span>{t.nameAr || t.name} <span className="text-[rgb(var(--muted))]">({t.testType})</span></span>
                  </label>
                )) : <p className="text-xs text-[rgb(var(--muted))]">لا توجد اختبارات مُفعّلة.</p>}
              </div>
              {prep.data?.status === "FAILED" && <p className="text-sm text-red-600">فشل تجهيز نطاق الفحص ({prep.data.failureCode}). عدّل الاختيار وابدأ من جديد.</p>}
              <button className={btn} disabled={!canBegin || beginPrep.isPending} onClick={() => { setErr(null); beginPrep.mutate(); }}>
                {beginPrep.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileCheck2 className="h-4 w-4" />}ابدأ تجهيز نطاق الفحص
              </button>
            </div>
          )}

          {prep.data && prep.data.status !== "FAILED" && (run.status === "PREPARING" || run.status === "DRAFT") && (
            <div className="mt-3 rounded-lg border p-3 text-sm">
              <p>تجهيز نطاق الفحص (جيل {prep.data.generationNo}): <span className="rounded-full border px-2 py-0.5 text-xs">{prep.data.status}</span></p>
              {prep.data.status === "PREPARING" && <p className="mt-1 flex items-center gap-2 text-[rgb(var(--muted))]"><Loader2 className="h-3 w-3 animate-spin" />يجري تجهيز نطاق الفحص في الخلفية…</p>}
              {prep.data.status === "COMPLETE" && (
                <button className={`mt-2 ${btn}`} disabled={publish.isPending} onClick={() => { setErr(null); publish.mutate(prep.data!.id); }}>
                  {publish.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}اعتماد وإرسال للتنفيذ
                </button>
              )}
            </div>
          )}

          {run.status !== "DRAFT" && run.status !== "PREPARING" && (
            <div className="mt-3 space-y-3">
              <div>
                <p className="mb-1 text-sm font-medium">المحاولات</p>
                {jobs.data?.length ? <ul className="text-sm">{jobs.data.map((j) => <li key={j.id}>محاولة {j.attemptNo}: {j.status}{j.failureCode ? ` (${j.failureCode})` : ""}</li>)}</ul> : <p className="text-xs text-[rgb(var(--muted))]">—</p>}
              </div>
              {run.status === "COMPLETED" && (
                <div>
                  <p className="mb-1 text-sm font-medium">المؤشّرات ({results.data?.length ?? 0})</p>
                  {results.data?.length ? <ul className="max-h-64 overflow-auto text-sm">{results.data.map((r) => <li key={r.id}>{r.resultCode} — {r.severity}</li>)}</ul> : (
                    <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                      لم تُنتج هذه العملية أي مؤشّرات. تحقّق من أن البيانات المستوردة تحتوي سجلات صالحة (غير مرفوضة) وأن الاختبار المختار يناسب نوعها.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
