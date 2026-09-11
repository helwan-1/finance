"use client";

import { Search, RotateCcw } from "lucide-react";
import { useUIStore } from "@/store/ui-store";
import type {
  AnomalyRuleCode,
  AnomalySeverity,
  AnomalyStatus,
} from "@/lib/ui-types";
import { useT } from "@/lib/i18n/use-t";
import { useLabels } from "@/lib/i18n/use-labels";

const SEVERITIES: AnomalySeverity[] = [
  "CRITICAL",
  "HIGH",
  "MEDIUM",
  "LOW",
  "INFO",
];
const STATUSES: AnomalyStatus[] = [
  "OPEN",
  "IN_REVIEW",
  "RESOLVED",
  "DISMISSED",
  "ESCALATED",
];
const selectClass =
  "surface rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500/40";

/**
 * FilterBar drives real-time anomaly filtering. It writes into the shared
 * Zustand store; the feed reacts to store changes and refetches.
 */
export function FilterBar() {
  const { t } = useT();
  const labels = useLabels();
  const RULES = Object.keys(labels.rule) as AnomalyRuleCode[];
  const filters = useUIStore((s) => s.filters);
  const setFilters = useUIStore((s) => s.setFilters);
  const resetFilters = useUIStore((s) => s.resetFilters);

  return (
    <div className="surface flex flex-wrap items-end gap-3 rounded-xl border p-4 print:hidden">
      <div className="flex min-w-[220px] flex-1 flex-col gap-1">
        <label className="text-xs text-[rgb(var(--muted))]" htmlFor="f-search">
          {t("anomalies.filter.search")}
        </label>
        <div className="relative">
          <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[rgb(var(--muted))]" />
          <input
            id="f-search"
            type="search"
            value={filters.search}
            onChange={(e) => setFilters({ search: e.target.value })}
            placeholder={t("anomalies.filter.searchPlaceholder")}
            className={`${selectClass} w-full pr-9`}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-[rgb(var(--muted))]" htmlFor="f-sev">
          {t("anomalies.filter.severity")}
        </label>
        <select
          id="f-sev"
          value={filters.severity}
          onChange={(e) =>
            setFilters({ severity: e.target.value as AnomalySeverity | "ALL" })
          }
          className={selectClass}
        >
          <option value="ALL">{t("anomalies.filter.all")}</option>
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {labels.severity[s]}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-[rgb(var(--muted))]" htmlFor="f-rule">
          {t("anomalies.filter.ruleType")}
        </label>
        <select
          id="f-rule"
          value={filters.ruleCode}
          onChange={(e) =>
            setFilters({ ruleCode: e.target.value as AnomalyRuleCode | "ALL" })
          }
          className={selectClass}
        >
          <option value="ALL">{t("anomalies.filter.all")}</option>
          {RULES.map((r) => (
            <option key={r} value={r}>
              {labels.rule[r]}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-[rgb(var(--muted))]" htmlFor="f-status">
          {t("anomalies.filter.status")}
        </label>
        <select
          id="f-status"
          value={filters.status}
          onChange={(e) =>
            setFilters({ status: e.target.value as AnomalyStatus | "ALL" })
          }
          className={selectClass}
        >
          <option value="ALL">{t("anomalies.filter.all")}</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {labels.status[s]}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-[rgb(var(--muted))]" htmlFor="f-from">
          {t("anomalies.filter.fromDate")}
        </label>
        <input
          id="f-from"
          type="date"
          value={filters.from ?? ""}
          onChange={(e) => setFilters({ from: e.target.value || null })}
          className={selectClass}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-[rgb(var(--muted))]" htmlFor="f-to">
          {t("anomalies.filter.toDate")}
        </label>
        <input
          id="f-to"
          type="date"
          value={filters.to ?? ""}
          onChange={(e) => setFilters({ to: e.target.value || null })}
          className={selectClass}
        />
      </div>

      <button
        type="button"
        onClick={resetFilters}
        className="flex items-center gap-2 rounded-lg border border-transparent px-3 py-2 text-sm text-[rgb(var(--muted))] hover:bg-black/5 dark:hover:bg-white/5"
      >
        <RotateCcw className="h-4 w-4" />
        {t("anomalies.filter.reset")}
      </button>
    </div>
  );
}
