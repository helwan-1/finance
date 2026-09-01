"use client";

import { ArrowLeftRight } from "lucide-react";
import type { ReconMatchDTO } from "@/lib/ui-types";
import { MATCH_STATUS_BADGE, MATCH_STATUS_LABELS_AR } from "@/lib/labels";
import { formatCurrency } from "@/lib/format";

/** Tabular view of reconciliation matches (bank ⇄ ledger). */
export function MatchesTable({ matches }: { matches: ReconMatchDTO[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-right text-sm">
        <thead>
          <tr className="border-b text-xs text-[rgb(var(--muted))]">
            <th className="px-3 py-2 font-medium">مرجع المصدر</th>
            <th className="px-3 py-2 font-medium">المبلغ</th>
            <th className="px-3 py-2 font-medium">مرجع الطرف المقابل</th>
            <th className="px-3 py-2 font-medium">الحالة</th>
            <th className="px-3 py-2 font-medium">الثقة</th>
            <th className="px-3 py-2 font-medium">الفرق</th>
          </tr>
        </thead>
        <tbody>
          {matches.map((m) => {
            const confidencePct = Math.round(
              Number.parseFloat(m.confidence) * 100,
            );
            const hasDelta =
              m.amountDelta !== null && Number.parseFloat(m.amountDelta) !== 0;
            return (
              <tr
                key={m.id}
                className="border-b border-[rgb(var(--border))]/60 last:border-0 hover:bg-black/5 dark:hover:bg-white/5"
              >
                <td className="px-3 py-2.5 font-medium tabular-nums">
                  {m.sourceRef}
                </td>
                <td className="px-3 py-2.5 tabular-nums">
                  {formatCurrency(m.sourceAmount)}
                </td>
                <td className="px-3 py-2.5 tabular-nums text-[rgb(var(--muted))]">
                  {m.targetRef ?? (
                    <span className="inline-flex items-center gap-1 text-severity-critical">
                      <ArrowLeftRight className="h-3.5 w-3.5" />—
                    </span>
                  )}
                </td>
                <td className="px-3 py-2.5">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${MATCH_STATUS_BADGE[m.status]}`}
                  >
                    {MATCH_STATUS_LABELS_AR[m.status]}
                  </span>
                </td>
                <td className="px-3 py-2.5">
                  {m.status === "UNMATCHED" ? (
                    <span className="text-[rgb(var(--muted))]">—</span>
                  ) : (
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
                        <div
                          className="h-full rounded-full bg-brand-500"
                          style={{ width: `${confidencePct}%` }}
                        />
                      </div>
                      <span className="tabular-nums text-xs text-[rgb(var(--muted))]">
                        {confidencePct}%
                      </span>
                    </div>
                  )}
                </td>
                <td className="px-3 py-2.5 tabular-nums">
                  {hasDelta ? (
                    <span className="text-severity-medium">
                      {formatCurrency(m.amountDelta!)}
                    </span>
                  ) : (
                    <span className="text-[rgb(var(--muted))]">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
