"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Play, FileCheck2, Rocket, RefreshCw } from "lucide-react";
import { useUIStore } from "@/store/ui-store";
import { useT } from "@/lib/i18n/use-t";
import type { MessageKey } from "@/lib/i18n/messages";

interface RunSummary { id: string; status: string; label: string | null; freezeGeneration: string | null; configFingerprint: string | null; createdAt: string }
interface Prep { id: string; generationNo: number; status: string; failureCode: string | null }
interface DatasetOption { id: string; kind: string; status: string; datasetHash?: string | null; createdAt?: string }

const DS_KIND_KEY: Record<string, MessageKey> = {
  GENERAL_LEDGER: "runs.dsKind.GENERAL_LEDGER",
  TRIAL_BALANCE: "runs.dsKind.TRIAL_BALANCE",
  BANK: "runs.dsKind.BANK",
  OTHER: "runs.dsKind.OTHER",
};
const DS_STATUS_KEY: Record<string, MessageKey> = {
  COMPLETED: "runs.dsStatus.COMPLETED",
  COMPLETED_WITH_ISSUES: "runs.dsStatus.COMPLETED_WITH_ISSUES",
};
function fmtDate(iso?: string): string {
  if (!iso) return "";
  try { return new Intl.DateTimeFormat("ar", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso)); } catch { return iso; }
}
interface TestOption { key: string; name: string; nameAr: string; testType: string; supportedDatasetKinds?: string[] }
interface JobSummary { id: string; attemptNo: number; status: string; failureCode: string | null; failureDetail: string | null }
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
  const { t } = useT();
  const engagementId = useUIStore((s) => s.engagementId);
  const qc = useQueryClient();
  const dsKind = (k: string) => (DS_KIND_KEY[k] ? t(DS_KIND_KEY[k]!) : k);
  const dsStatus = (s: string) => (DS_STATUS_KEY[s] ? t(DS_STATUS_KEY[s]!) : s);
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

  if (!engagementId) return <div className={card}>{t("runs.selectEngagement")}</div>;

  const toggle = (set: Set<string>, id: string, apply: (s: Set<string>) => void) => { const n = new Set(set); if (n.has(id)) n.delete(id); else n.add(id); apply(n); };

  // Dataset kinds available in this engagement, and those currently checked, so a
  // test whose required kind is absent can be blocked before the run fails CONFIG.
  // Guard against a non-array payload (an API error object, a stale cache, etc.)
  // so a bad response degrades to "no data" instead of crashing the screen.
  const datasetList: DatasetOption[] = Array.isArray(datasets.data) ? datasets.data : [];
  const testList: TestOption[] = Array.isArray(tests.data) ? tests.data : [];
  const availableKinds = new Set(datasetList.map((d) => d.kind));
  const checkedKinds = new Set(datasetList.filter((d) => pickedDatasets.has(d.id)).map((d) => d.kind));
  const testDataState = (t: TestOption): "ok" | "not_imported" | "not_selected" => {
    const req = t.supportedDatasetKinds ?? [];
    if (req.length === 0) return "ok"; // no dataset requirement
    if (!req.some((k) => availableKinds.has(k))) return "not_imported";
    if (!req.some((k) => checkedKinds.has(k))) return "not_selected";
    return "ok";
  };
  // Every checked test must have its required dataset kind selected.
  const checkedTestsSatisfied = [...pickedTests].every((key) => {
    const t = testList.find((x) => x.key === key);
    return !t || testDataState(t) === "ok";
  });
  const canBegin = pickedDatasets.size > 0 && pickedTests.size > 0 && checkedTestsSatisfied && (run?.status === "DRAFT" || run?.status === "PREPARING");

  return (
    <div className="space-y-4">
      {err && <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-600">{err}</div>}

      <div className={card}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">{t("runs.title")}</h2>
          <div className="flex gap-2">
            <button className={ghost} onClick={() => void runs.refetch()}><RefreshCw className="h-4 w-4" />{t("runs.refresh")}</button>
            <button className={btn} disabled={createRun.isPending} onClick={() => { setErr(null); createRun.mutate(); }}>
              {createRun.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}{t("runs.createRun")}
            </button>
          </div>
        </div>
        {runs.isPending ? <p className="text-sm text-[rgb(var(--muted))]">{t("runs.loading")}</p> : (runs.data?.length ?? 0) === 0 ? (
          <p className="text-sm text-[rgb(var(--muted))]">{t("runs.emptyRuns")}</p>
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
          <h3 className="mb-2 font-semibold">{t("runs.runDetails")} — <span className="text-xs text-[rgb(var(--muted))]">{run.id}</span></h3>
          <p className="mb-3 text-sm">{t("runs.status")}: <span className="rounded-full border px-2 py-0.5 text-xs">{run.status}</span></p>

          {(run.status === "DRAFT" || run.status === "PREPARING") && (!prep.data || prep.data.status === "FAILED") && (
            <div className="space-y-3">
              <div>
                <p className="mb-1 text-sm font-medium">{t("runs.importedData")}</p>
                {datasetList.length ? datasetList.map((d) => (
                  <label key={d.id} className="flex items-center gap-2 py-1 text-sm">
                    <input type="checkbox" checked={pickedDatasets.has(d.id)} onChange={() => toggle(pickedDatasets, d.id, setPickedDatasets)} />
                    <span>
                      {dsKind(d.kind)}
                      {d.createdAt && <span className="text-[rgb(var(--muted))]"> · {fmtDate(d.createdAt)}</span>}
                      {d.datasetHash && <span className="font-mono text-[11px] text-[rgb(var(--muted))]"> · {d.datasetHash.slice(0, 10)}</span>}
                      <span className="text-[rgb(var(--muted))]"> ({dsStatus(d.status)})</span>
                    </span>
                  </label>
                )) : <p className="text-xs text-[rgb(var(--muted))]">{t("runs.noImportedData")}</p>}
              </div>
              <div>
                <p className="mb-1 text-sm font-medium">{t("runs.auditTests")}</p>
                {testList.length ? testList.map((test) => {
                  const state = testDataState(test);
                  const reqAr = (test.supportedDatasetKinds ?? []).map((k) => dsKind(k)).join(t("runs.orSeparator"));
                  const disabled = state === "not_imported";
                  return (
                    <label key={test.key} className={`flex items-start gap-2 py-1 text-sm ${disabled ? "opacity-50" : ""}`}>
                      <input type="checkbox" className="mt-1" checked={pickedTests.has(test.key)} disabled={disabled} onChange={() => toggle(pickedTests, test.key, setPickedTests)} />
                      <span>
                        {test.nameAr || test.name} <span className="text-[rgb(var(--muted))]">({test.testType})</span>
                        {state === "not_imported" && <span className="block text-xs text-[rgb(var(--muted))]">{t("runs.requiresDataNotImported", { reqAr })}</span>}
                        {state === "not_selected" && pickedTests.has(test.key) && <span className="block text-xs text-amber-600">{t("runs.selectDatasetOfKind", { reqAr })}</span>}
                      </span>
                    </label>
                  );
                }) : <p className="text-xs text-[rgb(var(--muted))]">{t("runs.noEnabledTests")}</p>}
              </div>
              {prep.data?.status === "FAILED" && <p className="text-sm text-red-600">{t("runs.prepFailed", { code: prep.data.failureCode ?? "" })}</p>}
              <button className={btn} disabled={!canBegin || beginPrep.isPending} onClick={() => { setErr(null); beginPrep.mutate(); }}>
                {beginPrep.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileCheck2 className="h-4 w-4" />}{t("runs.beginPrep")}
              </button>
            </div>
          )}

          {prep.data && prep.data.status !== "FAILED" && (run.status === "PREPARING" || run.status === "DRAFT") && (
            <div className="mt-3 rounded-lg border p-3 text-sm">
              <p>{t("runs.prepGeneration", { n: prep.data.generationNo })}: <span className="rounded-full border px-2 py-0.5 text-xs">{prep.data.status}</span></p>
              {prep.data.status === "PREPARING" && <p className="mt-1 flex items-center gap-2 text-[rgb(var(--muted))]"><Loader2 className="h-3 w-3 animate-spin" />{t("runs.prepInBackground")}</p>}
              {prep.data.status === "COMPLETE" && (
                <button className={`mt-2 ${btn}`} disabled={publish.isPending} onClick={() => { setErr(null); publish.mutate(prep.data!.id); }}>
                  {publish.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}{t("runs.publish")}
                </button>
              )}
            </div>
          )}

          {run.status !== "DRAFT" && run.status !== "PREPARING" && (
            <div className="mt-3 space-y-3">
              <div>
                <p className="mb-1 text-sm font-medium">{t("runs.attempts")}</p>
                {jobs.data?.length ? <ul className="space-y-1 text-sm">{jobs.data.map((j) => (
                  <li key={j.id}>
                    {t("runs.attempt", { n: j.attemptNo })}: {j.status}{j.failureCode ? ` (${j.failureCode})` : ""}
                    {j.failureDetail && <span className="block text-xs text-red-600">{t("runs.reason")}: {j.failureDetail}</span>}
                  </li>
                ))}</ul> : <p className="text-xs text-[rgb(var(--muted))]">—</p>}
              </div>
              {run.status === "COMPLETED" && (
                <div>
                  <p className="mb-1 text-sm font-medium">{t("runs.indicators", { n: results.data?.length ?? 0 })}</p>
                  {results.data?.length ? <ul className="max-h-64 overflow-auto text-sm">{results.data.map((r) => <li key={r.id}>{r.resultCode} — {r.severity}</li>)}</ul> : (
                    <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                      {t("runs.noIndicators")}
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
