"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, FlaskConical, RefreshCw } from "lucide-react";
import { useT } from "@/lib/i18n/use-t";
import type { MessageKey } from "@/lib/i18n/messages";

interface TestItem { key: string; name: string; nameAr: string; testType: string }
interface Creatable { testType: string; kind: string; datasetKinds: string[]; params?: "round" | "dupamt" }

// Arabic labels used to pre-fill the editable Arabic-name field when a test type
// is picked — always Arabic regardless of the active UI locale.
const KIND_LABEL_AR: Record<string, string> = {
  POPULATION_MEMBER: "اكتمال المجتمع (مؤشّر لكل سجل)",
  SOURCE_TO_CANONICAL_MISMATCH: "تطابق المصدر مع الترحيل المحاسبي",
  UNBALANCED_JE: "قيود يومية غير متوازنة",
  INVALID_DEBIT_CREDIT: "قيم مدين/دائن غير صالحة",
  TB_ACCOUNT_DUPLICATION: "تكرار حساب في ميزان المراجعة",
  ROUND_NUMBER_FREQUENCY: "تكرار المبالغ المدوّرة",
  DUPLICATE_AMOUNT_FREQUENCY: "تكرار المبالغ المتطابقة",
};
const KIND_LABEL_KEY: Record<string, MessageKey> = {
  POPULATION_MEMBER: "auditTests.kind.POPULATION_MEMBER",
  SOURCE_TO_CANONICAL_MISMATCH: "auditTests.kind.SOURCE_TO_CANONICAL_MISMATCH",
  UNBALANCED_JE: "auditTests.kind.UNBALANCED_JE",
  INVALID_DEBIT_CREDIT: "auditTests.kind.INVALID_DEBIT_CREDIT",
  TB_ACCOUNT_DUPLICATION: "auditTests.kind.TB_ACCOUNT_DUPLICATION",
  ROUND_NUMBER_FREQUENCY: "auditTests.kind.ROUND_NUMBER_FREQUENCY",
  DUPLICATE_AMOUNT_FREQUENCY: "auditTests.kind.DUPLICATE_AMOUNT_FREQUENCY",
};
// Sensible starting values for statistical parameters (user may adjust).
const STAT_DEFAULTS: Record<string, Record<string, string>> = {
  round: { roundingQuantum: "1000.00", minimumPopulation: "1", minimumRoundCount: "1", rateThresholdNum: "1", rateThresholdDenom: "2" },
  dupamt: { minimumOccurrenceCount: "2" },
};
const STAT_FIELDS: Record<string, { key: string }[]> = {
  round: [
    { key: "roundingQuantum" },
    { key: "minimumPopulation" },
    { key: "minimumRoundCount" },
    { key: "rateThresholdNum" },
    { key: "rateThresholdDenom" },
  ],
  dupamt: [{ key: "minimumOccurrenceCount" }],
};
const STAT_FIELD_KEY: Record<string, MessageKey> = {
  roundingQuantum: "auditTests.statField.roundingQuantum",
  minimumPopulation: "auditTests.statField.minimumPopulation",
  minimumRoundCount: "auditTests.statField.minimumRoundCount",
  rateThresholdNum: "auditTests.statField.rateThresholdNum",
  rateThresholdDenom: "auditTests.statField.rateThresholdDenom",
  minimumOccurrenceCount: "auditTests.statField.minimumOccurrenceCount",
};
const TESTTYPE_LABEL_KEY: Record<string, MessageKey> = {
  DATA_QUALITY: "auditTests.testType.DATA_QUALITY",
  ACCOUNTING_INTEGRITY: "auditTests.testType.ACCOUNTING_INTEGRITY",
  STATISTICAL: "auditTests.testType.STATISTICAL",
};
const DS_LABEL_KEY: Record<string, MessageKey> = {
  GENERAL_LEDGER: "auditTests.dsKind.GENERAL_LEDGER",
  TRIAL_BALANCE: "auditTests.dsKind.TRIAL_BALANCE",
  BANK: "auditTests.dsKind.BANK",
  OTHER: "auditTests.dsKind.OTHER",
};

const card = "surface rounded-xl border p-4";
const btn = "inline-flex items-center gap-2 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60";
const ghost = "inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-60";
const field = "surface w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500/40";

async function jget<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "فشل التحميل");
  return (await r.json()) as T;
}

export function AuditTestsView() {
  const { t } = useT();
  const qc = useQueryClient();
  const kindLabel = (k: string) => (KIND_LABEL_KEY[k] ? t(KIND_LABEL_KEY[k]!) : k);
  const testTypeLabel = (tt: string) => (TESTTYPE_LABEL_KEY[tt] ? t(TESTTYPE_LABEL_KEY[tt]!) : tt);
  const dsLabel = (k: string) => (DS_LABEL_KEY[k] ? t(DS_LABEL_KEY[k]!) : k);
  const [showForm, setShowForm] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [registryKey, setRegistryKey] = useState("");
  const [key, setKey] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [name, setName] = useState("");
  const [pickedDs, setPickedDs] = useState<Set<string>>(new Set());
  const [params, setParams] = useState<Record<string, string>>({});

  const data = useQuery({
    queryKey: ["audit-tests-admin"],
    queryFn: () => jget<{ tests: TestItem[]; creatable: Creatable[] }>("/api/audit-tests"),
  });
  const creatable = data.data?.creatable ?? [];
  const selected = creatable.find((c) => `${c.testType}:${c.kind}` === registryKey) ?? null;

  const onSelectKind = (rk: string) => {
    setRegistryKey(rk);
    const spec = creatable.find((c) => `${c.testType}:${c.kind}` === rk);
    // Auto-fill sensible defaults so the auditor rarely types anything: a key
    // derived from the executor kind, the Arabic name, and all required dataset
    // kinds preselected. Every field stays editable.
    setKey(spec ? spec.kind.replaceAll("_", "-") : "");
    setNameAr(spec ? (KIND_LABEL_AR[spec.kind] ?? "") : "");
    setPickedDs(new Set(spec?.datasetKinds ?? []));
    setParams(spec?.params ? { ...STAT_DEFAULTS[spec.params] } : {});
  };

  const reset = () => { setRegistryKey(""); setKey(""); setNameAr(""); setName(""); setPickedDs(new Set()); setParams({}); setErr(null); };

  const create = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error(t("auditTests.selectTestTypeError"));
      const r = await fetch("/api/audit-tests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          key, nameAr, name, testType: selected.testType, kind: selected.kind,
          requiredDatasetKinds: [...pickedDs],
          ...(selected.params ? { params } : {}),
        }),
      });
      const d = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(d.error ?? t("auditTests.createFailed"));
    },
    onSuccess: () => { reset(); setShowForm(false); void qc.invalidateQueries({ queryKey: ["audit-tests-admin"] }); },
    onError: (e) => setErr((e as Error).message),
  });

  const paramsComplete = !selected?.params || (STAT_FIELDS[selected.params] ?? []).every((f) => (params[f.key] ?? "").trim() !== "");
  const canSubmit = Boolean(selected) && key.trim().length >= 2 && Boolean(nameAr.trim() || name.trim()) && pickedDs.size > 0 && paramsComplete;

  return (
    <div className="space-y-4">
      {err && <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-600">{err}</div>}

      <div className={card}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">{t("auditTests.enabledTitle")}</h2>
          <div className="flex gap-2">
            <button className={ghost} onClick={() => void data.refetch()}><RefreshCw className="h-4 w-4" />{t("auditTests.refresh")}</button>
            <button className={btn} onClick={() => { setShowForm((v) => !v); setErr(null); }}>
              <Plus className="h-4 w-4" />{t("auditTests.newTest")}
            </button>
          </div>
        </div>
        {data.isPending ? (
          <p className="text-sm text-[rgb(var(--muted))]">{t("auditTests.loading")}</p>
        ) : (data.data?.tests.length ?? 0) === 0 ? (
          <p className="text-sm text-[rgb(var(--muted))]">{t("auditTests.emptyList")}</p>
        ) : (
          <ul className="divide-y">
            {data.data!.tests.map((t) => (
              <li key={t.key} className="flex items-center justify-between py-2 text-sm">
                <span className="flex items-center gap-2">
                  <FlaskConical className="h-4 w-4 text-brand-600" />
                  <span>{t.nameAr || t.name}</span>
                  <span className="rounded bg-black/5 px-1.5 py-0.5 font-mono text-[11px] dark:bg-white/5">{t.key}</span>
                </span>
                <span className="rounded-full border px-2 py-0.5 text-xs">{testTypeLabel(t.testType)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {showForm && (
        <div className={card}>
          <h3 className="mb-3 font-semibold">{t("auditTests.createTitle")}</h3>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-sm font-medium">{t("auditTests.testTypeLabel")}</label>
              <select className={field} value={registryKey} onChange={(e) => onSelectKind(e.target.value)}>
                <option value="">{t("auditTests.selectPlaceholder")}</option>
                {creatable.map((c) => (
                  <option key={`${c.testType}:${c.kind}`} value={`${c.testType}:${c.kind}`}>
                    {kindLabel(c.kind)} ({testTypeLabel(c.testType)})
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium">{t("auditTests.keyLabel")}</label>
                <input className={field} value={key} onChange={(e) => setKey(e.target.value)} placeholder={t("auditTests.keyPlaceholder")} dir="ltr" />
                <p className="mt-1 text-xs text-[rgb(var(--muted))]">{t("auditTests.keyHint")}</p>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">{t("auditTests.nameArLabel")}</label>
                <input className={field} value={nameAr} onChange={(e) => setNameAr(e.target.value)} placeholder={t("auditTests.nameArPlaceholder")} />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">{t("auditTests.nameEnLabel")}</label>
              <input className={field} value={name} onChange={(e) => setName(e.target.value)} placeholder="English name (optional)" dir="ltr" />
            </div>

            {selected && (
              <div>
                <label className="mb-1 block text-sm font-medium">{t("auditTests.requiredDatasets")}</label>
                <div className="flex flex-wrap gap-3">
                  {selected.datasetKinds.map((k) => (
                    <label key={k} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={pickedDs.has(k)}
                        onChange={() => { const n = new Set(pickedDs); if (n.has(k)) n.delete(k); else n.add(k); setPickedDs(n); }}
                      />
                      <span>{dsLabel(k)}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {selected?.params && (
              <div>
                <label className="mb-1 block text-sm font-medium">{t("auditTests.statParamsLabel")}</label>
                <div className="grid gap-3 sm:grid-cols-2">
                  {(STAT_FIELDS[selected.params] ?? []).map((f) => (
                    <div key={f.key}>
                      <label className="mb-1 block text-xs text-[rgb(var(--muted))]">{STAT_FIELD_KEY[f.key] ? t(STAT_FIELD_KEY[f.key]!) : f.key}</label>
                      <input
                        className={field}
                        dir="ltr"
                        inputMode={f.key === "roundingQuantum" ? "decimal" : "numeric"}
                        value={params[f.key] ?? ""}
                        onChange={(e) => setParams({ ...params, [f.key]: e.target.value })}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <button className={btn} disabled={!canSubmit || create.isPending} onClick={() => { setErr(null); create.mutate(); }}>
                {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}{t("auditTests.createActivate")}
              </button>
              <button className={ghost} onClick={() => { reset(); setShowForm(false); }}>{t("auditTests.cancel")}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
