"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, FlaskConical, RefreshCw } from "lucide-react";

interface TestItem { key: string; name: string; nameAr: string; testType: string }
interface Creatable { testType: string; kind: string; datasetKinds: string[]; params?: "round" | "dupamt" }

const KIND_LABEL_AR: Record<string, string> = {
  POPULATION_MEMBER: "اكتمال المجتمع (مؤشّر لكل سجل)",
  SOURCE_TO_CANONICAL_MISMATCH: "تطابق المصدر مع الترحيل المحاسبي",
  UNBALANCED_JE: "قيود يومية غير متوازنة",
  INVALID_DEBIT_CREDIT: "قيم مدين/دائن غير صالحة",
  TB_ACCOUNT_DUPLICATION: "تكرار حساب في ميزان المراجعة",
  ROUND_NUMBER_FREQUENCY: "تكرار المبالغ المدوّرة",
  DUPLICATE_AMOUNT_FREQUENCY: "تكرار المبالغ المتطابقة",
};
// Sensible starting values for statistical parameters (user may adjust).
const STAT_DEFAULTS: Record<string, Record<string, string>> = {
  round: { roundingQuantum: "1000.00", minimumPopulation: "1", minimumRoundCount: "1", rateThresholdNum: "1", rateThresholdDenom: "2" },
  dupamt: { minimumOccurrenceCount: "2" },
};
const STAT_FIELDS: Record<string, { key: string; labelAr: string }[]> = {
  round: [
    { key: "roundingQuantum", labelAr: "وحدة التدوير (مثال 1000.00)" },
    { key: "minimumPopulation", labelAr: "أدنى حجم مجتمع" },
    { key: "minimumRoundCount", labelAr: "أدنى عدد مبالغ مدوّرة" },
    { key: "rateThresholdNum", labelAr: "بسط نسبة العتبة" },
    { key: "rateThresholdDenom", labelAr: "مقام نسبة العتبة" },
  ],
  dupamt: [{ key: "minimumOccurrenceCount", labelAr: "أدنى عدد تكرارات (≥ 2)" }],
};
const TESTTYPE_LABEL_AR: Record<string, string> = {
  DATA_QUALITY: "جودة البيانات",
  ACCOUNTING_INTEGRITY: "سلامة محاسبية",
  STATISTICAL: "إحصائي",
};
const DS_LABEL_AR: Record<string, string> = {
  GENERAL_LEDGER: "دفتر الأستاذ",
  TRIAL_BALANCE: "ميزان المراجعة",
  BANK: "كشف بنكي",
  OTHER: "أخرى",
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
  const qc = useQueryClient();
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
    setPickedDs(new Set());
    const spec = creatable.find((c) => `${c.testType}:${c.kind}` === rk);
    setParams(spec?.params ? { ...STAT_DEFAULTS[spec.params] } : {});
  };

  const reset = () => { setRegistryKey(""); setKey(""); setNameAr(""); setName(""); setPickedDs(new Set()); setParams({}); setErr(null); };

  const create = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("اختر نوع الاختبار");
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
      if (!r.ok) throw new Error(d.error ?? "فشل إنشاء الاختبار");
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
          <h2 className="font-semibold">اختبارات التدقيق المُفعّلة</h2>
          <div className="flex gap-2">
            <button className={ghost} onClick={() => void data.refetch()}><RefreshCw className="h-4 w-4" />تحديث</button>
            <button className={btn} onClick={() => { setShowForm((v) => !v); setErr(null); }}>
              <Plus className="h-4 w-4" />اختبار جديد
            </button>
          </div>
        </div>
        {data.isPending ? (
          <p className="text-sm text-[rgb(var(--muted))]">جارٍ التحميل…</p>
        ) : (data.data?.tests.length ?? 0) === 0 ? (
          <p className="text-sm text-[rgb(var(--muted))]">لا توجد اختبارات بعد. أنشئ اختبارًا ليصبح متاحًا في عمليات التدقيق.</p>
        ) : (
          <ul className="divide-y">
            {data.data!.tests.map((t) => (
              <li key={t.key} className="flex items-center justify-between py-2 text-sm">
                <span className="flex items-center gap-2">
                  <FlaskConical className="h-4 w-4 text-brand-600" />
                  <span>{t.nameAr || t.name}</span>
                  <span className="rounded bg-black/5 px-1.5 py-0.5 font-mono text-[11px] dark:bg-white/5">{t.key}</span>
                </span>
                <span className="rounded-full border px-2 py-0.5 text-xs">{TESTTYPE_LABEL_AR[t.testType] ?? t.testType}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {showForm && (
        <div className={card}>
          <h3 className="mb-3 font-semibold">إنشاء اختبار تدقيق جديد</h3>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-sm font-medium">نوع الاختبار</label>
              <select className={field} value={registryKey} onChange={(e) => onSelectKind(e.target.value)}>
                <option value="">— اختر نوع الاختبار —</option>
                {creatable.map((c) => (
                  <option key={`${c.testType}:${c.kind}`} value={`${c.testType}:${c.kind}`}>
                    {KIND_LABEL_AR[c.kind] ?? c.kind} ({TESTTYPE_LABEL_AR[c.testType] ?? c.testType})
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium">المفتاح (رمز فريد)</label>
                <input className={field} value={key} onChange={(e) => setKey(e.target.value)} placeholder="مثال: GL-BALANCE" dir="ltr" />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">الاسم (عربي)</label>
                <input className={field} value={nameAr} onChange={(e) => setNameAr(e.target.value)} placeholder="اسم الاختبار بالعربية" />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">الاسم (إنجليزي — اختياري)</label>
              <input className={field} value={name} onChange={(e) => setName(e.target.value)} placeholder="English name (optional)" dir="ltr" />
            </div>

            {selected && (
              <div>
                <label className="mb-1 block text-sm font-medium">أنواع البيانات المطلوبة</label>
                <div className="flex flex-wrap gap-3">
                  {selected.datasetKinds.map((k) => (
                    <label key={k} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={pickedDs.has(k)}
                        onChange={() => { const n = new Set(pickedDs); if (n.has(k)) n.delete(k); else n.add(k); setPickedDs(n); }}
                      />
                      <span>{DS_LABEL_AR[k] ?? k}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {selected?.params && (
              <div>
                <label className="mb-1 block text-sm font-medium">معاملات الاختبار الإحصائي (مُجمّدة مع الاختبار)</label>
                <div className="grid gap-3 sm:grid-cols-2">
                  {(STAT_FIELDS[selected.params] ?? []).map((f) => (
                    <div key={f.key}>
                      <label className="mb-1 block text-xs text-[rgb(var(--muted))]">{f.labelAr}</label>
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
                {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}إنشاء وتفعيل
              </button>
              <button className={ghost} onClick={() => { reset(); setShowForm(false); }}>إلغاء</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
