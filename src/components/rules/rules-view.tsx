"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, ServerCrash, Play, Plus, Trash2 } from "lucide-react";
import { useUIStore } from "@/store/ui-store";
import type { RuleDTO, RulesResponse, RunRulesResponse } from "@/lib/ui-types";
import {
  RULE_CATEGORY_LABELS_AR,
  SEVERITY_BADGE,
  SEVERITY_LABELS_AR,
} from "@/lib/labels";
import { AddRuleForm } from "./add-rule-form";
import { ImportRules } from "./import-rules";

async function fetchRules(engagementId: string): Promise<RulesResponse> {
  const p = new URLSearchParams();
  if (engagementId) p.set("engagementId", engagementId);
  const res = await fetch(`/api/rules?${p.toString()}`);
  if (!res.ok) throw new Error("فشل تحميل القواعد");
  return (await res.json()) as RulesResponse;
}

const CATEGORY_ORDER = ["NUMERIC", "PARTY", "TIMING", "AGGREGATE"] as const;

export function RulesView() {
  const engagementId = useUIStore((s) => s.engagementId);
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [runMsg, setRunMsg] = useState<string | null>(null);

  const { data, isPending, isError } = useQuery({
    queryKey: ["rules", engagementId],
    queryFn: () => fetchRules(engagementId),
  });

  const toggle = useMutation({
    mutationFn: async (r: RuleDTO) => {
      const res = await fetch(`/api/rules/${r.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !r.enabled }),
      });
      if (!res.ok) throw new Error("فشل");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["rules"] }),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/rules/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("فشل");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["rules"] }),
  });

  const run = useMutation({
    mutationFn: async () => {
      const p = new URLSearchParams();
      if (engagementId) p.set("engagementId", engagementId);
      const res = await fetch(`/api/rules/run?${p.toString()}`, { method: "POST" });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(d.error ?? "فشل تشغيل التدقيق");
      }
      return (await res.json()) as RunRulesResponse;
    },
    onSuccess: (r) => {
      setRunMsg(`تم تطبيق ${r.evaluated} قاعدة وإنتاج ${r.findings} حالة شاذة.`);
      void queryClient.invalidateQueries({ queryKey: ["anomalies"] });
      void queryClient.invalidateQueries({ queryKey: ["anomalies-summary"] });
    },
    onError: (e) => setRunMsg((e as Error).message),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-[rgb(var(--muted))]">
          {data ? `${data.rules.length} قاعدة` : " "}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <ImportRules />
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            className="surface flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/5"
          >
            <Plus className="h-4 w-4" />
            إضافة قاعدة
          </button>
          <button
            type="button"
            onClick={() => { setRunMsg(null); run.mutate(); }}
            disabled={run.isPending}
            className="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {run.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            تشغيل التدقيق
          </button>
        </div>
      </div>

      {runMsg && (
        <div className="surface rounded-lg border border-brand-500/30 bg-brand-50 px-4 py-2.5 text-sm text-brand-700 dark:bg-brand-700/10">
          {runMsg}
        </div>
      )}

      {showForm && <AddRuleForm onClose={() => setShowForm(false)} />}

      {isPending ? (
        <div className="surface flex items-center justify-center gap-2 rounded-xl border p-12 text-[rgb(var(--muted))]">
          <Loader2 className="h-5 w-5 animate-spin" /> جارٍ تحميل القواعد...
        </div>
      ) : isError ? (
        <div className="surface flex flex-col items-center gap-2 rounded-xl border p-12 text-severity-critical">
          <ServerCrash className="h-6 w-6" /> تعذّر تحميل القواعد.
        </div>
      ) : (
        CATEGORY_ORDER.map((cat) => {
          const rules = data.rules.filter((r) => r.category === cat);
          if (rules.length === 0) return null;
          return (
            <section key={cat} className="space-y-2">
              <h2 className="text-sm font-semibold text-[rgb(var(--muted))]">
                {RULE_CATEGORY_LABELS_AR[cat]}
              </h2>
              <div className="surface divide-y overflow-hidden rounded-xl border shadow-card">
                {rules.map((r) => (
                  <RuleRow
                    key={r.id}
                    rule={r}
                    onToggle={() => toggle.mutate(r)}
                    onDelete={() => remove.mutate(r.id)}
                    busy={toggle.isPending || remove.isPending}
                  />
                ))}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}

function RuleRow({
  rule,
  onToggle,
  onDelete,
  busy,
}: {
  rule: RuleDTO;
  onToggle: () => void;
  onDelete: () => void;
  busy: boolean;
}) {
  return (
    <div className="flex items-start gap-3 p-4">
      <button
        type="button"
        onClick={onToggle}
        disabled={busy}
        aria-pressed={rule.enabled}
        title={rule.enabled ? "مُفعّلة" : "معطّلة"}
        className={`mt-0.5 h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors ${
          rule.enabled ? "bg-severity-low" : "bg-black/20 dark:bg-white/20"
        }`}
      >
        <span
          className={`block h-4 w-4 rounded-full bg-white transition-transform ${
            rule.enabled ? "translate-x-0" : "-translate-x-4"
          }`}
        />
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{rule.nameAr}</span>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${SEVERITY_BADGE[rule.severity]}`}>
            {SEVERITY_LABELS_AR[rule.severity]}
          </span>
          <span dir="ltr" className="rounded-full bg-black/5 px-2 py-0.5 text-[11px] text-[rgb(var(--muted))] dark:bg-white/5">
            {rule.code}
          </span>
          <span className="rounded-full border px-2 py-0.5 text-[11px] text-[rgb(var(--muted))]">
            {rule.scope === "FIRM" ? "الشركة" : "المهمة"}
          </span>
        </div>
        {rule.descriptionAr && (
          <p className="mt-1 text-xs text-[rgb(var(--muted))]">{rule.descriptionAr}</p>
        )}
      </div>

      <button
        type="button"
        onClick={onDelete}
        disabled={busy}
        className="shrink-0 rounded-lg p-2 text-[rgb(var(--muted))] hover:bg-severity-critical/10 hover:text-severity-critical"
        title="حذف"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}
