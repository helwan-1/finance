"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, X } from "lucide-react";
import { useUIStore } from "@/store/ui-store";
import type { AnomalySeverity, RuleCategory, RuleScope } from "@/lib/ui-types";
import { RULE_CATEGORY_LABELS_AR, SEVERITY_LABELS_AR } from "@/lib/labels";
import { useT } from "@/lib/i18n/use-t";

type RuleType =
  | "field_compare"
  | "threshold_avoidance"
  | "round_amount"
  | "value_list"
  | "missing_field"
  | "time_window"
  | "aggregate";

const TYPE_LABEL_KEYS = {
  field_compare: "rules.type.fieldCompare",
  threshold_avoidance: "rules.type.thresholdAvoidance",
  round_amount: "rules.type.roundAmount",
  value_list: "rules.type.valueList",
  missing_field: "rules.type.missingField",
  time_window: "rules.type.timeWindow",
  aggregate: "rules.type.aggregate",
} as const;

const TYPE_CATEGORY: Record<RuleType, RuleCategory> = {
  field_compare: "NUMERIC",
  threshold_avoidance: "NUMERIC",
  round_amount: "NUMERIC",
  value_list: "PARTY",
  missing_field: "PARTY",
  time_window: "TIMING",
  aggregate: "AGGREGATE",
};

const SEVERITIES: AnomalySeverity[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"];
const input = "surface w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500/40";

export function AddRuleForm({ onClose }: { onClose: () => void }) {
  const { t } = useT();
  const engagementId = useUIStore((s) => s.engagementId);
  const queryClient = useQueryClient();

  const [nameAr, setNameAr] = useState("");
  const [code, setCode] = useState("");
  const [severity, setSeverity] = useState<AnomalySeverity>("MEDIUM");
  const [scope, setScope] = useState<RuleScope>("FIRM");
  const [type, setType] = useState<RuleType>("field_compare");

  // Per-type fields (kept flat for simplicity).
  const [field, setField] = useState("amount");
  const [op, setOp] = useState("gte");
  const [value, setValue] = useState("");
  const [value2, setValue2] = useState("");
  const [marginPct, setMarginPct] = useState("5");
  const [minZeros, setMinZeros] = useState("3");
  const [listField, setListField] = useState("counterparty");
  const [listMode, setListMode] = useState("deny");
  const [listValues, setListValues] = useState("");
  const [missing, setMissing] = useState("document");
  const [timeKind, setTimeKind] = useState("off_hours");
  const [aggGroup, setAggGroup] = useState<string[]>(["counterparty"]);
  const [agg, setAgg] = useState("count");
  const [windowDays, setWindowDays] = useState("");

  function buildDefinition(): Record<string, unknown> | null {
    const num = (s: string) => Number.parseFloat(s);
    switch (type) {
      case "field_compare":
        if (!value) return null;
        return { type, field, op, value: num(value), ...(op === "between" && value2 ? { value2: num(value2) } : {}) };
      case "threshold_avoidance":
        if (!value) return null;
        return { type, limit: num(value), marginPct: num(marginPct) };
      case "round_amount":
        return { type, minTrailingZeros: Number.parseInt(minZeros, 10) };
      case "value_list":
        return { type, field: listField, mode: listMode, values: listValues.split(",").map((v) => v.trim()).filter(Boolean) };
      case "missing_field":
        return { type, field: missing };
      case "time_window":
        return { type, kind: timeKind };
      case "aggregate":
        if (!value) return null;
        return { type, groupBy: aggGroup, agg, op, value: num(value), ...(windowDays ? { windowDays: Number.parseInt(windowDays, 10) } : {}) };
      default:
        return null;
    }
  }

  const mutation = useMutation({
    mutationFn: async () => {
      const definition = buildDefinition();
      if (!definition) throw new Error(t("rules.error.incomplete"));
      const res = await fetch("/api/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          engagementId: scope === "ENGAGEMENT" ? engagementId : null,
          code: code.trim() || `RULE-${Date.now().toString().slice(-5)}`,
          nameAr,
          category: TYPE_CATEGORY[type],
          severity,
          scope,
          definition,
        }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(d.error ?? t("rules.error.createFailed"));
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["rules"] });
      onClose();
    },
  });

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); mutation.mutate(); }}
      className="surface space-y-4 rounded-xl border p-4 shadow-card"
    >
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">{t("rules.form.title")}</h3>
        <button type="button" onClick={onClose} className="rounded-lg p-1 hover:bg-black/5 dark:hover:bg-white/5">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="text-[rgb(var(--muted))]">{t("rules.form.name")}</span>
          <input className={input} value={nameAr} onChange={(e) => setNameAr(e.target.value)} required placeholder={t("rules.form.namePlaceholder")} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-[rgb(var(--muted))]">{t("rules.form.code")}</span>
          <input className={input} dir="ltr" value={code} onChange={(e) => setCode(e.target.value)} placeholder="LARGE-ITEMS" />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-[rgb(var(--muted))]">{t("rules.form.type")}</span>
          <select className={input} value={type} onChange={(e) => setType(e.target.value as RuleType)}>
            {(Object.keys(TYPE_LABEL_KEYS) as RuleType[]).map((rt) => (
              <option key={rt} value={rt}>{t(TYPE_LABEL_KEYS[rt])} — {RULE_CATEGORY_LABELS_AR[TYPE_CATEGORY[rt]]}</option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-[rgb(var(--muted))]">{t("rules.form.severity")}</span>
          <select className={input} value={severity} onChange={(e) => setSeverity(e.target.value as AnomalySeverity)}>
            {SEVERITIES.map((s) => <option key={s} value={s}>{SEVERITY_LABELS_AR[s]}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-[rgb(var(--muted))]">{t("rules.form.scope")}</span>
          <select className={input} value={scope} onChange={(e) => setScope(e.target.value as RuleScope)}>
            <option value="FIRM">{t("rules.scope.firm")}</option>
            <option value="ENGAGEMENT">{t("rules.scope.engagement")}</option>
          </select>
        </label>
      </div>

      {/* Type-specific fields */}
      <div className="grid gap-3 rounded-lg bg-black/5 p-3 sm:grid-cols-3 dark:bg-white/5">
        {(type === "field_compare" || type === "aggregate") && (
          <>
            {type === "field_compare" && (
              <label className="space-y-1 text-sm">
                <span className="text-[rgb(var(--muted))]">{t("rules.form.field")}</span>
                <select className={input} value={field} onChange={(e) => setField(e.target.value)}>
                  <option value="amount">{t("rules.field.amount")}</option>
                  <option value="vatAmount">{t("rules.field.vatAmount")}</option>
                  <option value="vatRatioPct">{t("rules.field.vatRatioPct")}</option>
                  <option value="hour">{t("rules.field.hour")}</option>
                  <option value="weekday">{t("rules.field.weekday")}</option>
                  <option value="valueVsPostedDays">{t("rules.field.valueVsPostedDays")}</option>
                </select>
              </label>
            )}
            {type === "aggregate" && (
              <label className="space-y-1 text-sm">
                <span className="text-[rgb(var(--muted))]">{t("rules.form.groupBy")}</span>
                <select className={input} multiple value={aggGroup} onChange={(e) => setAggGroup(Array.from(e.target.selectedOptions, (o) => o.value))}>
                  <option value="counterparty">{t("rules.field.counterparty")}</option>
                  <option value="account">{t("rules.field.account")}</option>
                  <option value="amount">{t("rules.field.amount")}</option>
                  <option value="reference">{t("rules.field.reference")}</option>
                </select>
              </label>
            )}
            {type === "aggregate" && (
              <label className="space-y-1 text-sm">
                <span className="text-[rgb(var(--muted))]">{t("rules.form.function")}</span>
                <select className={input} value={agg} onChange={(e) => setAgg(e.target.value)}>
                  <option value="count">{t("rules.agg.count")}</option>
                  <option value="sum">{t("rules.agg.sum")}</option>
                </select>
              </label>
            )}
            <label className="space-y-1 text-sm">
              <span className="text-[rgb(var(--muted))]">{t("rules.form.condition")}</span>
              <select className={input} value={op} onChange={(e) => setOp(e.target.value)}>
                <option value="gte">≥</option>
                <option value="gt">&gt;</option>
                <option value="lte">≤</option>
                <option value="lt">&lt;</option>
                <option value="eq">=</option>
                <option value="neq">≠</option>
                <option value="between">{t("rules.op.between")}</option>
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-[rgb(var(--muted))]">{t("rules.form.value")}</span>
              <input className={input} type="number" step="any" value={value} onChange={(e) => setValue(e.target.value)} />
            </label>
            {op === "between" && (
              <label className="space-y-1 text-sm">
                <span className="text-[rgb(var(--muted))]">{t("rules.form.value2")}</span>
                <input className={input} type="number" step="any" value={value2} onChange={(e) => setValue2(e.target.value)} />
              </label>
            )}
            {type === "aggregate" && (
              <label className="space-y-1 text-sm">
                <span className="text-[rgb(var(--muted))]">{t("rules.form.windowDays")}</span>
                <input className={input} type="number" value={windowDays} onChange={(e) => setWindowDays(e.target.value)} />
              </label>
            )}
          </>
        )}

        {type === "threshold_avoidance" && (
          <>
            <label className="space-y-1 text-sm">
              <span className="text-[rgb(var(--muted))]">{t("rules.form.threshold")}</span>
              <input className={input} type="number" step="any" value={value} onChange={(e) => setValue(e.target.value)} />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-[rgb(var(--muted))]">{t("rules.form.marginPct")}</span>
              <input className={input} type="number" step="any" value={marginPct} onChange={(e) => setMarginPct(e.target.value)} />
            </label>
          </>
        )}

        {type === "round_amount" && (
          <label className="space-y-1 text-sm">
            <span className="text-[rgb(var(--muted))]">{t("rules.form.minZeros")}</span>
            <input className={input} type="number" value={minZeros} onChange={(e) => setMinZeros(e.target.value)} />
          </label>
        )}

        {type === "value_list" && (
          <>
            <label className="space-y-1 text-sm">
              <span className="text-[rgb(var(--muted))]">{t("rules.form.field")}</span>
              <select className={input} value={listField} onChange={(e) => setListField(e.target.value)}>
                <option value="counterparty">{t("rules.field.counterparty")}</option>
                <option value="account">{t("rules.field.account")}</option>
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-[rgb(var(--muted))]">{t("rules.form.type")}</span>
              <select className={input} value={listMode} onChange={(e) => setListMode(e.target.value)}>
                <option value="deny">{t("rules.list.deny")}</option>
                <option value="allow">{t("rules.list.allow")}</option>
              </select>
            </label>
            <label className="space-y-1 text-sm sm:col-span-3">
              <span className="text-[rgb(var(--muted))]">{t("rules.form.listValues")}</span>
              <input className={input} value={listValues} onChange={(e) => setListValues(e.target.value)} placeholder={t("rules.form.listValuesPlaceholder")} />
            </label>
          </>
        )}

        {type === "missing_field" && (
          <label className="space-y-1 text-sm">
            <span className="text-[rgb(var(--muted))]">{t("rules.form.requiredField")}</span>
            <select className={input} value={missing} onChange={(e) => setMissing(e.target.value)}>
              <option value="document">{t("rules.missing.document")}</option>
              <option value="counterparty">{t("rules.field.counterparty")}</option>
              <option value="account">{t("rules.field.account")}</option>
              <option value="vatAmount">{t("rules.missing.vatAmount")}</option>
              <option value="valueDate">{t("rules.missing.valueDate")}</option>
            </select>
          </label>
        )}

        {type === "time_window" && (
          <label className="space-y-1 text-sm">
            <span className="text-[rgb(var(--muted))]">{t("rules.form.type")}</span>
            <select className={input} value={timeKind} onChange={(e) => setTimeKind(e.target.value)}>
              <option value="off_hours">{t("rules.time.offHours")}</option>
              <option value="weekend">{t("rules.time.weekend")}</option>
            </select>
          </label>
        )}
      </div>

      {mutation.isError && (
        <p className="text-sm text-severity-critical">{(mutation.error as Error).message}</p>
      )}

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-lg border px-4 py-2 text-sm">{t("rules.form.cancel")}</button>
        <button type="submit" disabled={mutation.isPending} className="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60">
          {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          {t("rules.form.save")}
        </button>
      </div>
    </form>
  );
}
