"use client";

import { useState } from "react";
import {
  TrendingUp,
  CopyCheck,
  Copy,
  Clock,
  CalendarOff,
  Receipt,
  CircleDollarSign,
  Unlink,
  Gauge,
  UserX,
  FileWarning,
  CalendarClock,
  SlidersHorizontal,
  Eye,
  type LucideIcon,
} from "lucide-react";
import type { AnomalyDTO, AnomalyRuleCode } from "@/lib/ui-types";
import { useT } from "@/lib/i18n/use-t";
import { useLabels } from "@/lib/i18n/use-labels";
import { AnomalyDetailDialog } from "./anomaly-detail-dialog";
import {
  SEVERITY_BADGE,
  SEVERITY_BAR,
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
  THRESHOLD_AVOIDANCE: Gauge,
  GAP_SEQUENCE: SlidersHorizontal,
  DENYLIST_PARTY: UserX,
  MISSING_FIELD: FileWarning,
  BACKDATED_ENTRY: CalendarClock,
  CUSTOM_RULE: SlidersHorizontal,
};

const DEFAULT_ICON: LucideIcon = SlidersHorizontal;

export function AnomalyCard({ anomaly }: { anomaly: AnomalyDTO }) {
  const { t } = useT();
  const labels = useLabels();
  const Icon = RULE_ICON[anomaly.ruleCode] ?? DEFAULT_ICON;
  const [showDetail, setShowDetail] = useState(false);

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
            {labels.severity[anomaly.severity]}
          </span>
          <span className="rounded-full bg-black/5 px-2 py-0.5 text-[11px] text-[rgb(var(--muted))] dark:bg-white/5">
            {labels.rule[anomaly.ruleCode]}
          </span>
          <span className="rounded-full border px-2 py-0.5 text-[11px] text-[rgb(var(--muted))]">
            {labels.status[anomaly.status]}
          </span>
        </div>

        <p className="mt-1.5 text-sm text-[rgb(var(--muted))]">
          {anomaly.descriptionAr}
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-[rgb(var(--muted))]">
          {anomaly.reference && (
            <span>
              {t("anomalies.card.reference")}{" "}
              <span className="font-medium text-[rgb(var(--foreground))]">
                {anomaly.reference}
              </span>
            </span>
          )}
          {anomaly.amount && (
            <span>
              {t("anomalies.card.amount")}{" "}
              <span className="font-medium text-[rgb(var(--foreground))]">
                {formatCurrency(anomaly.amount)}
              </span>
            </span>
          )}
          {anomaly.counterparty && (
            <span>
              {t("anomalies.card.counterparty")}{" "}
              <span className="font-medium text-[rgb(var(--foreground))]">
                {anomaly.counterparty}
              </span>
            </span>
          )}
          <span>{formatRelative(anomaly.detectedAt)}</span>
        </div>

        <div className="mt-3 print:hidden">
          <button
            type="button"
            onClick={() => setShowDetail(true)}
            className="flex items-center gap-1.5 rounded-lg border border-brand-600/40 px-2.5 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand-50 dark:text-brand-300 dark:hover:bg-brand-700/15"
          >
            <Eye className="h-3.5 w-3.5" />
            {t("anomalies.card.details")}
          </button>
        </div>

        <ResolutionActions anomaly={anomaly} />
      </div>

      {showDetail && (
        <AnomalyDetailDialog anomalyId={anomaly.id} onClose={() => setShowDetail(false)} />
      )}

      <div className="hidden shrink-0 flex-col items-center justify-center sm:flex">
        <span className="text-lg font-bold tabular-nums">
          {Math.round(Number.parseFloat(anomaly.score))}
        </span>
        <span className="text-[10px] text-[rgb(var(--muted))]">{t("anomalies.card.score")}</span>
      </div>
    </article>
  );
}
