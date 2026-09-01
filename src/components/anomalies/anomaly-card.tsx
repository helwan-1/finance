"use client";

import {
  TrendingUp,
  CopyCheck,
  Copy,
  Clock,
  CalendarOff,
  Receipt,
  CircleDollarSign,
  Unlink,
  type LucideIcon,
} from "lucide-react";
import type { AnomalyDTO, AnomalyRuleCode } from "@/lib/ui-types";
import {
  RULE_LABELS_AR,
  SEVERITY_BADGE,
  SEVERITY_BAR,
  SEVERITY_LABELS_AR,
  STATUS_LABELS_AR,
} from "@/lib/labels";
import { formatCurrency, formatRelative } from "@/lib/format";
import { ResolutionActions } from "./resolution-actions";

const RULE_ICON: Record<AnomalyRuleCode, LucideIcon> = {
  BENFORD_DEVIATION: TrendingUp,
  DUPLICATE_EXACT: CopyCheck,
  DUPLICATE_NEAR: Copy,
  OFF_HOURS_ENTRY: Clock,
  WEEKEND_ENTRY: CalendarOff,
  VAT_DISCREPANCY: Receipt,
  ROUND_AMOUNT: CircleDollarSign,
  UNRECONCILED: Unlink,
};

export function AnomalyCard({ anomaly }: { anomaly: AnomalyDTO }) {
  const Icon = RULE_ICON[anomaly.ruleCode];

  return (
    <article className="surface relative flex gap-4 overflow-hidden rounded-xl border p-4 shadow-card">
      {/* Severity accent bar (right edge in RTL). */}
      <span
        className={`absolute inset-y-0 right-0 w-1 ${SEVERITY_BAR[anomaly.severity]}`}
        aria-hidden
      />

      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-black/5 dark:bg-white/5">
        <Icon className="h-5 w-5 text-brand-600" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold">{anomaly.titleAr}</h3>
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${SEVERITY_BADGE[anomaly.severity]}`}
          >
            {SEVERITY_LABELS_AR[anomaly.severity]}
          </span>
          <span className="rounded-full bg-black/5 px-2 py-0.5 text-[11px] text-[rgb(var(--muted))] dark:bg-white/5">
            {RULE_LABELS_AR[anomaly.ruleCode]}
          </span>
          <span className="rounded-full border px-2 py-0.5 text-[11px] text-[rgb(var(--muted))]">
            {STATUS_LABELS_AR[anomaly.status]}
          </span>
        </div>

        <p className="mt-1.5 text-sm text-[rgb(var(--muted))]">
          {anomaly.descriptionAr}
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-[rgb(var(--muted))]">
          {anomaly.reference && (
            <span>
              المرجع:{" "}
              <span className="font-medium text-[rgb(var(--foreground))]">
                {anomaly.reference}
              </span>
            </span>
          )}
          {anomaly.amount && (
            <span>
              المبلغ:{" "}
              <span className="font-medium text-[rgb(var(--foreground))]">
                {formatCurrency(anomaly.amount)}
              </span>
            </span>
          )}
          {anomaly.counterparty && (
            <span>
              الطرف المقابل:{" "}
              <span className="font-medium text-[rgb(var(--foreground))]">
                {anomaly.counterparty}
              </span>
            </span>
          )}
          <span>{formatRelative(anomaly.detectedAt)}</span>
        </div>

        <ResolutionActions anomaly={anomaly} />
      </div>

      <div className="hidden shrink-0 flex-col items-center justify-center sm:flex">
        <span className="text-lg font-bold tabular-nums">
          {Math.round(Number.parseFloat(anomaly.score))}
        </span>
        <span className="text-[10px] text-[rgb(var(--muted))]">الدرجة</span>
      </div>
    </article>
  );
}
