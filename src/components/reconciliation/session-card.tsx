"use client";

import { GitCompareArrows } from "lucide-react";
import type { ReconSessionDTO } from "@/lib/ui-types";
import { MatchesTable } from "./matches-table";

/** A single reconciliation session: header, match-rate bar, and the table. */
export function SessionCard({ session }: { session: ReconSessionDTO }) {
  const reconciled = session.matchedCount + session.partialCount;
  const rate =
    session.totalCount > 0
      ? Math.round((reconciled / session.totalCount) * 100)
      : 0;

  return (
    <section className="surface overflow-hidden rounded-xl border shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-700/15">
            <GitCompareArrows className="h-5 w-5" />
          </div>
          <div>
            <h2 className="font-semibold">{session.name}</h2>
            <p className="text-xs text-[rgb(var(--muted))]">
              {session.sourceA} ⇄ {session.sourceB}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4 text-center">
          <Metric value={session.matchedCount} labelAr="مطابَقة" tone="text-severity-low" />
          <Metric value={session.partialCount} labelAr="جزئية" tone="text-severity-medium" />
          <Metric
            value={session.unmatchedCount}
            labelAr="غير مطابَقة"
            tone="text-severity-critical"
          />
        </div>
      </div>

      <div className="border-b p-4">
        <div className="mb-1.5 flex items-center justify-between text-xs">
          <span className="text-[rgb(var(--muted))]">نسبة المطابقة</span>
          <span className="font-semibold tabular-nums">{rate}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
          <div
            className="h-full rounded-full bg-severity-low"
            style={{ width: `${rate}%` }}
          />
        </div>
      </div>

      <MatchesTable matches={session.matches} />
    </section>
  );
}

function Metric({
  value,
  labelAr,
  tone,
}: {
  value: number;
  labelAr: string;
  tone: string;
}) {
  return (
    <div>
      <p className={`text-lg font-bold tabular-nums ${tone}`}>{value}</p>
      <p className="text-[10px] text-[rgb(var(--muted))]">{labelAr}</p>
    </div>
  );
}
