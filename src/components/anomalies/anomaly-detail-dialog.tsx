"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, X, ArrowUpCircle, Loader2 } from "lucide-react";
import type {
  AnomaliesResponse,
  AnomalyDetailResponse,
  AnomalyStatus,
} from "@/lib/ui-types";
import { SEVERITY_BADGE } from "@/lib/labels";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { useT } from "@/lib/i18n/use-t";
import { useLabels } from "@/lib/i18n/use-labels";

type ActionKey = "RESOLVE" | "DISMISS" | "ESCALATE";
const ACTION_STATUS: Record<ActionKey, AnomalyStatus> = {
  RESOLVE: "RESOLVED",
  DISMISS: "DISMISSED",
  ESCALATE: "ESCALATED",
};

const TX_TYPE_AR: Record<string, string> = {
  DEBIT: "مدين",
  CREDIT: "دائن",
  INVOICE: "فاتورة",
  PAYMENT: "دفعة",
  RECEIPT: "قبض",
  JOURNAL: "قيد يومية",
  TRANSFER: "تحويل",
};
const TX_SOURCE_AR: Record<string, string> = {
  GENERAL_LEDGER: "دفتر الأستاذ",
  BANK_STATEMENT: "كشف بنكي",
  INVOICE: "فاتورة",
  MANUAL: "يدوي",
  IMPORT: "استيراد",
};

/**
 * Anomaly case detail — opened from a card on the audit dashboard. Shows the
 * rule, structured evidence, the underlying transaction and the resolution
 * history, and (while the case is still open) lets the user resolve / dismiss /
 * escalate it from here.
 */
export function AnomalyDetailDialog({
  anomalyId,
  onClose,
}: {
  anomalyId: string;
  onClose: () => void;
}) {
  const { t } = useT();
  const labels = useLabels();
  const queryClient = useQueryClient();

  const { data, isPending, isError } = useQuery({
    queryKey: ["anomaly-detail", anomalyId],
    queryFn: async () => {
      const res = await fetch(`/api/anomalies/${anomalyId}`);
      if (!res.ok) throw new Error("failed");
      return (await res.json()) as AnomalyDetailResponse;
    },
  });

  const mutation = useMutation({
    mutationFn: async (action: ActionKey) => {
      const res = await fetch(`/api/anomalies/${anomalyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) throw new Error("فشل تحديث الحالة");
    },
    onSuccess: async (_d, action) => {
      const next = ACTION_STATUS[action];
      queryClient.setQueriesData<AnomaliesResponse>({ queryKey: ["anomalies"] }, (prev) =>
        prev
          ? { ...prev, anomalies: prev.anomalies.map((a) => (a.id === anomalyId ? { ...a, status: next } : a)) }
          : prev,
      );
      await queryClient.invalidateQueries({ queryKey: ["anomaly-detail", anomalyId] });
      await queryClient.invalidateQueries({ queryKey: ["anomalies-summary"] });
      onClose();
    },
    onError: () => alert(t("anomalies.detail.updateError")),
  });

  const a = data?.anomaly;
  const open = a && (a.status === "OPEN" || a.status === "IN_REVIEW");
  const busy = mutation.isPending;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onMouseDown={onClose}>
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="surface max-h-[85vh] w-full max-w-2xl space-y-4 overflow-y-auto rounded-2xl border p-5 shadow-card"
      >
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold">{t("anomalies.detail.title")}</h3>
          <button type="button" onClick={onClose} className="rounded-lg p-1 hover:bg-black/5 dark:hover:bg-white/5">
            <X className="h-4 w-4" />
          </button>
        </div>

        {isPending ? (
          <p className="py-8 text-center text-sm text-[rgb(var(--muted))]">{t("anomalies.detail.loading")}</p>
        ) : isError || !a ? (
          <p className="py-8 text-center text-sm text-severity-critical">{t("anomalies.detail.loadError")}</p>
        ) : (
          <>
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="text-base font-bold">{a.titleAr}</h4>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${SEVERITY_BADGE[a.severity]}`}>
                  {labels.severity[a.severity]}
                </span>
                <span className="rounded-full bg-black/5 px-2 py-0.5 text-[11px] text-[rgb(var(--muted))] dark:bg-white/5">
                  {a.auditRuleName ?? labels.rule[a.ruleCode]}
                </span>
                <span className="rounded-full border px-2 py-0.5 text-[11px] text-[rgb(var(--muted))]">
                  {labels.status[a.status]}
                </span>
              </div>
              <p className="text-sm text-[rgb(var(--foreground))]">{a.descriptionAr}</p>
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-[rgb(var(--muted))]">
                <span>{t("anomalies.detail.score")} <span className="font-medium text-[rgb(var(--foreground))]">{Math.round(Number.parseFloat(a.score))}</span></span>
                <span>{t("anomalies.detail.detectedAt")} <span className="font-medium text-[rgb(var(--foreground))]">{formatDateTime(a.detectedAt)}</span></span>
              </div>
            </div>

            {/* Underlying transaction */}
            {a.transaction && (
              <Section title={t("anomalies.detail.sectionTransaction")}>
                <Field label={t("anomalies.detail.fieldReference")} value={a.transaction.reference} />
                <Field label={t("anomalies.detail.fieldDescription")} value={a.transaction.description} />
                <Field label={t("anomalies.detail.fieldAmount")} value={formatCurrency(a.transaction.amount, a.transaction.currency)} />
                {a.transaction.vatAmount && (
                  <Field label={t("anomalies.detail.fieldVat")} value={formatCurrency(a.transaction.vatAmount, a.transaction.currency)} />
                )}
                <Field label={t("anomalies.detail.fieldType")} value={TX_TYPE_AR[a.transaction.type] ?? a.transaction.type} />
                <Field label={t("anomalies.detail.fieldSource")} value={TX_SOURCE_AR[a.transaction.source] ?? a.transaction.source} />
                {a.transaction.counterparty && <Field label={t("anomalies.detail.fieldCounterparty")} value={a.transaction.counterparty} />}
                {a.transaction.account && <Field label={t("anomalies.detail.fieldAccount")} value={a.transaction.account} />}
                <Field label={t("anomalies.detail.fieldPostedAt")} value={formatDateTime(a.transaction.postedAt)} />
                <Field label={t("anomalies.detail.fieldValueDate")} value={formatDateTime(a.transaction.valueDate)} />
              </Section>
            )}

            {/* Structured evidence */}
            {a.evidence && Object.keys(a.evidence).length > 0 && (
              <Section title={t("anomalies.detail.sectionEvidence")}>
                {Object.entries(a.evidence).map(([k, v]) => (
                  <Field key={k} label={k} value={renderValue(v)} />
                ))}
              </Section>
            )}

            {/* Resolution history */}
            {(a.resolvedAt || a.resolutionNote) && (
              <Section title={t("anomalies.detail.sectionResolution")}>
                {a.resolvedByName && <Field label={t("anomalies.detail.fieldBy")} value={a.resolvedByName} />}
                {a.resolvedAt && <Field label={t("anomalies.detail.fieldDate")} value={formatDateTime(a.resolvedAt)} />}
                {a.resolutionNote && <Field label={t("anomalies.detail.fieldNote")} value={a.resolutionNote} />}
              </Section>
            )}

            {/* Actions (only while open) */}
            {open && (
              <div className="flex flex-wrap items-center gap-2 border-t pt-4">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => mutation.mutate("RESOLVE")}
                  className="flex items-center gap-1.5 rounded-lg border border-severity-low/40 px-3 py-1.5 text-xs font-medium text-severity-low hover:bg-severity-low/10 disabled:opacity-60"
                >
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  {t("anomalies.action.resolve")}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => mutation.mutate("DISMISS")}
                  className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium text-[rgb(var(--muted))] hover:bg-black/5 disabled:opacity-60 dark:hover:bg-white/5"
                >
                  <X className="h-3.5 w-3.5" />
                  {t("anomalies.action.dismiss")}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => mutation.mutate("ESCALATE")}
                  className="flex items-center gap-1.5 rounded-lg border border-severity-high/40 px-3 py-1.5 text-xs font-medium text-severity-high hover:bg-severity-high/10 disabled:opacity-60"
                >
                  <ArrowUpCircle className="h-3.5 w-3.5" />
                  {t("anomalies.action.escalate")}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5 rounded-lg border p-3">
      <h5 className="text-sm font-bold">{title}</h5>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] gap-2 text-sm">
      <span className="text-[rgb(var(--muted))]">{label}</span>
      <span className="min-w-0 break-words">{value}</span>
    </div>
  );
}

function renderValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
