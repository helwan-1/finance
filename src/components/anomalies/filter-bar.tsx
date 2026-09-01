"use client";

import { Search, RotateCcw } from "lucide-react";
import { useUIStore } from "@/store/ui-store";
import type {
  AnomalyRuleCode,
  AnomalySeverity,
  AnomalyStatus,
} from "@/lib/ui-types";
import {
  RULE_LABELS_AR,
  SEVERITY_LABELS_AR,
  STATUS_LABELS_AR,
} from "@/lib/labels";

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
const RULES = Object.keys(RULE_LABELS_AR) as AnomalyRuleCode[];

const selectClass =
  "surface rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500/40";

/**
 * FilterBar drives real-time anomaly filtering. It writes into the shared
 * Zustand store; the feed reacts to store changes and refetches.
 */
export function FilterBar() {
  const filters = useUIStore((s) => s.filters);
  const setFilters = useUIStore((s) => s.setFilters);
  const resetFilters = useUIStore((s) => s.resetFilters);

  return (
    <div className="surface flex flex-wrap items-end gap-3 rounded-xl border p-4">
      <div className="flex min-w-[220px] flex-1 flex-col gap-1">
        <label className="text-xs text-[rgb(var(--muted))]" htmlFor="f-search">
          بحث
        </label>
        <div className="relative">
          <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[rgb(var(--muted))]" />
          <input
            id="f-search"
            type="search"
            value={filters.search}
            onChange={(e) => setFilters({ search: e.target.value })}
            placeholder="المرجع، الوصف، الطرف المقابل..."
            className={`${selectClass} w-full pr-9`}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-[rgb(var(--muted))]" htmlFor="f-sev">
          الخطورة
        </label>
        <select
          id="f-sev"
          value={filters.severity}
          onChange={(e) =>
            setFilters({ severity: e.target.value as AnomalySeverity | "ALL" })
          }
          className={selectClass}
        >
          <option value="ALL">الكل</option>
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {SEVERITY_LABELS_AR[s]}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-[rgb(var(--muted))]" htmlFor="f-rule">
          نوع القاعدة
        </label>
        <select
          id="f-rule"
          value={filters.ruleCode}
          onChange={(e) =>
            setFilters({ ruleCode: e.target.value as AnomalyRuleCode | "ALL" })
          }
          className={selectClass}
        >
          <option value="ALL">الكل</option>
          {RULES.map((r) => (
            <option key={r} value={r}>
              {RULE_LABELS_AR[r]}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-[rgb(var(--muted))]" htmlFor="f-status">
          الحالة
        </label>
        <select
          id="f-status"
          value={filters.status}
          onChange={(e) =>
            setFilters({ status: e.target.value as AnomalyStatus | "ALL" })
          }
          className={selectClass}
        >
          <option value="ALL">الكل</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS_AR[s]}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-[rgb(var(--muted))]" htmlFor="f-from">
          من تاريخ
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
          إلى تاريخ
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
        إعادة تعيين
      </button>
    </div>
  );
}
