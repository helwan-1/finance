"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, X, ArrowUpCircle, Loader2 } from "lucide-react";
import type { AnomaliesResponse, AnomalyDTO, AnomalyStatus } from "@/lib/ui-types";

type ActionKey = "RESOLVE" | "DISMISS" | "ESCALATE";

const ACTION_STATUS: Record<ActionKey, AnomalyStatus> = {
  RESOLVE: "RESOLVED",
  DISMISS: "DISMISSED",
  ESCALATE: "ESCALATED",
};

async function patchAnomaly(id: string, action: ActionKey): Promise<void> {
  const res = await fetch(`/api/anomalies/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
  });
  if (!res.ok) throw new Error("فشل تحديث الحالة");
}

/**
 * Resolve / dismiss / escalate buttons for an open anomaly. Updates every
 * cached anomalies query (feed + summary) so the change reflects immediately.
 */
export function ResolutionActions({ anomaly }: { anomaly: AnomalyDTO }) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (action: ActionKey) => patchAnomaly(anomaly.id, action),
    onSuccess: (_data, action) => {
      const nextStatus = ACTION_STATUS[action];
      const patch = (prev: AnomaliesResponse | undefined) =>
        prev
          ? {
              ...prev,
              anomalies: prev.anomalies.map((a) =>
                a.id === anomaly.id ? { ...a, status: nextStatus } : a,
              ),
            }
          : prev;
      queryClient.setQueriesData<AnomaliesResponse>(
        { queryKey: ["anomalies"] },
        patch,
      );
      queryClient.setQueriesData<AnomaliesResponse>(
        { queryKey: ["anomalies-summary"] },
        patch,
      );
    },
  });

  // Only actionable while still open / under review.
  if (anomaly.status !== "OPEN" && anomaly.status !== "IN_REVIEW") {
    return null;
  }

  const busy = mutation.isPending;

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 print:hidden">
      <button
        type="button"
        disabled={busy}
        onClick={() => mutation.mutate("RESOLVE")}
        className="flex items-center gap-1.5 rounded-lg border border-severity-low/40 px-2.5 py-1.5 text-xs font-medium text-severity-low hover:bg-severity-low/10 disabled:opacity-60"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
        معالجة
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => mutation.mutate("DISMISS")}
        className="flex items-center gap-1.5 rounded-lg border border-[rgb(var(--border))] px-2.5 py-1.5 text-xs font-medium text-[rgb(var(--muted))] hover:bg-black/5 disabled:opacity-60 dark:hover:bg-white/5"
      >
        <X className="h-3.5 w-3.5" />
        استبعاد
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => mutation.mutate("ESCALATE")}
        className="flex items-center gap-1.5 rounded-lg border border-severity-high/40 px-2.5 py-1.5 text-xs font-medium text-severity-high hover:bg-severity-high/10 disabled:opacity-60"
      >
        <ArrowUpCircle className="h-3.5 w-3.5" />
        تصعيد
      </button>
      {mutation.isError && (
        <span className="text-xs text-severity-critical">تعذّر التحديث</span>
      )}
    </div>
  );
}
