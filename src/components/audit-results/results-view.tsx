"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ClipboardList, Plus, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { useUIStore } from "@/store/ui-store";
import { useT } from "@/lib/i18n/use-t";
import { useLabels } from "@/lib/i18n/use-labels";
import type { MessageKey } from "@/lib/i18n/messages";
import {
  SEVERITY_BADGE,
  DISPOSITION_STATE_BADGE,
} from "@/lib/labels";
import type {
  AuditResultDTO,
  AuditResultsResponse,
  DispositionActionKind,
  DispositionStateKind,
} from "@/lib/ui-types";
import { NewExceptionDialog } from "@/components/findings/new-exception-dialog";

const selectClass =
  "surface rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500/40";
const smallSelect =
  "surface rounded-lg border px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-brand-500/40";
const btnBrand =
  "inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-60";

const ACTIONS: DispositionActionKind[] = [
  "MARK_UNDER_REVIEW",
  "REQUIRE_INVESTIGATION",
  "MARK_EXPLAINED",
  "MARK_NOT_RELEVANT",
  "MARK_FALSE_POSITIVE",
];

async function fetchResults(engagementId: string): Promise<AuditResultsResponse> {
  const res = await fetch(`/api/audit-results?engagementId=${encodeURIComponent(engagementId)}`);
  if (!res.ok) throw new Error("فشل تحميل مؤشّرات التدقيق");
  return (await res.json()) as AuditResultsResponse;
}

interface EvidenceRecord {
  evidenceType: string;
  datasetId: string | null;
  sourceRowNo: number | null;
  role: string | null;
  cells: { h: string; v: string | null }[] | null;
}
interface ResultDetailDTO {
  id: string;
  resultKind: string;
  resultCode: string;
  severity: string;
  score: string;
  resultSemanticFingerprint: string;
  dispositionState: string;
  evidence: EvidenceRecord[];
}
async function fetchResultDetail(id: string): Promise<ResultDetailDTO> {
  const res = await fetch(`/api/audit-results/${id}`);
  if (!res.ok) throw new Error("فشل تحميل تفاصيل المؤشّر");
  return ((await res.json()) as { result: ResultDetailDTO }).result;
}

export function AuditResultsView() {
  const { t } = useT();
  const labels = useLabels();
  const STATE_FILTER: { value: string; labelAr?: string; labelKey?: MessageKey }[] = [
    { value: "ALL", labelKey: "auditResults.allStates" },
    { value: "UNREVIEWED", labelAr: labels.dispositionState.UNREVIEWED },
    { value: "UNDER_REVIEW", labelAr: labels.dispositionState.UNDER_REVIEW },
    { value: "INVESTIGATING", labelAr: labels.dispositionState.INVESTIGATING },
    { value: "DISPOSED", labelAr: labels.dispositionState.DISPOSED },
    { value: "LINKED", labelAr: labels.dispositionState.LINKED },
  ];
  const engagementId = useUIStore((s) => s.engagementId);
  const queryClient = useQueryClient();
  const [stateFilter, setStateFilter] = useState("ALL");
  const [exceptionFor, setExceptionFor] = useState<AuditResultDTO | null>(null);

  const { data, isPending, isError } = useQuery({
    queryKey: ["audit-results", engagementId],
    queryFn: () => fetchResults(engagementId),
    enabled: Boolean(engagementId),
  });

  const disposition = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: DispositionActionKind }) => {
      const res = await fetch(`/api/audit-results/${id}/disposition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error || t("auditResults.dispositionError"));
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["audit-results"] }),
    onError: (e) => alert(e instanceof Error ? e.message : t("auditResults.dispositionError")),
  });

  const all = data?.results ?? [];
  const results =
    stateFilter === "ALL" ? all : all.filter((r) => r.dispositionState === stateFilter);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <select
          className={selectClass}
          value={stateFilter}
          onChange={(e) => setStateFilter(e.target.value)}
          aria-label={t("auditResults.filterByState")}
        >
          {STATE_FILTER.map((o) => (
            <option key={o.value} value={o.value}>
              {o.labelKey ? t(o.labelKey) : o.labelAr}
            </option>
          ))}
        </select>
        <span className="text-sm text-[rgb(var(--muted))]">{t("auditResults.resultCount", { count: results.length })}</span>
      </div>

      {!engagementId ? (
        <EmptyCard text={t("auditResults.selectEngagement")} />
      ) : isPending ? (
        <EmptyCard text={t("auditResults.loading")} />
      ) : isError ? (
        <EmptyCard text={t("auditResults.loadFailed")} tone="error" />
      ) : results.length === 0 ? (
        <EmptyCard text={t("auditResults.noResults")} />
      ) : (
        <div className="space-y-3">
          {results.map((r) => (
            <ResultRow
              key={r.id}
              r={r}
              busy={disposition.isPending}
              onDisposition={(action) => disposition.mutate({ id: r.id, action })}
              onCreateException={() => setExceptionFor(r)}
            />
          ))}
        </div>
      )}

      {exceptionFor && (
        <NewExceptionDialog
          engagementId={engagementId}
          presetResultId={exceptionFor.id}
          presetResultLabel={`${exceptionFor.resultCode} · ${labels.severity[exceptionFor.severity]}`}
          onClose={() => setExceptionFor(null)}
        />
      )}
    </div>
  );
}

function ResultRow({
  r,
  busy,
  onDisposition,
  onCreateException,
}: {
  r: AuditResultDTO;
  busy: boolean;
  onDisposition: (action: DispositionActionKind) => void;
  onCreateException: () => void;
}) {
  const { t } = useT();
  const labels = useLabels();
  const state = r.dispositionState as DispositionStateKind;
  const stateLabel = labels.dispositionState[state] ?? r.dispositionState;
  const stateBadge =
    DISPOSITION_STATE_BADGE[state] ??
    "bg-black/5 text-[rgb(var(--muted))] ring-black/10 dark:bg-white/5";
  const linked = state === "LINKED";
  const [open, setOpen] = useState(false);
  const detail = useQuery({
    queryKey: ["result-detail", r.id],
    queryFn: () => fetchResultDetail(r.id),
    enabled: open,
  });

  return (
    <div className="surface rounded-xl border shadow-card">
      <div className="flex flex-wrap items-center gap-3 p-4">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-black/5 hover:bg-black/10 dark:bg-white/5 dark:hover:bg-white/10"
          aria-label={open ? t("auditResults.hideDetails") : t("auditResults.showDetails")}
          title={open ? t("auditResults.hideDetails") : t("auditResults.showDetails")}
        >
          <ClipboardList className="h-5 w-5 text-brand-600" />
        </button>
        <button type="button" onClick={() => setOpen((v) => !v)} className="min-w-0 flex-1 text-right">
          <p className="truncate font-semibold">{r.resultCode}</p>
          <p className="text-xs text-[rgb(var(--muted))]">
            {r.resultKind} · {t("auditResults.row.score", { score: r.score })}
          </p>
        </button>
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${SEVERITY_BADGE[r.severity]}`}
        >
          {labels.severity[r.severity]}
        </span>
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${stateBadge}`}
        >
          {stateLabel}
        </span>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs hover:bg-black/5 dark:hover:bg-white/5"
          >
            {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {t("auditResults.details")}
          </button>
          <select
            className={smallSelect}
            value=""
            disabled={busy}
            onChange={(e) => {
              const v = e.target.value as DispositionActionKind;
              if (v) onDisposition(v);
              e.target.value = "";
            }}
            aria-label={t("auditResults.recordJudgment")}
          >
            <option value="">{t("auditResults.judgmentPlaceholder")}</option>
            {ACTIONS.map((a) => (
              <option key={a} value={a}>
                {labels.dispositionAction[a]}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={btnBrand}
            onClick={onCreateException}
            disabled={busy || linked}
            title={linked ? t("auditResults.alreadyLinked") : undefined}
          >
            <Plus className="h-3.5 w-3.5" />
            {t("auditResults.openMatter")}
          </button>
        </div>
      </div>

      {open && (
        <div className="border-t p-4 text-sm">
          <div className="mb-2 flex flex-wrap gap-x-6 gap-y-1 text-xs text-[rgb(var(--muted))]">
            <span>{t("auditResults.detail.type", { kind: r.resultKind })}</span>
            <span>{t("auditResults.detail.severity", { severity: labels.severity[r.severity] })}</span>
            <span>{t("auditResults.detail.score", { score: r.score })}</span>
            {detail.data?.resultSemanticFingerprint && (
              <span className="font-mono">{t("auditResults.detail.fingerprint", { fp: detail.data.resultSemanticFingerprint.slice(0, 16) })}</span>
            )}
          </div>
          {detail.isPending ? (
            <p className="flex items-center gap-2 text-[rgb(var(--muted))]"><Loader2 className="h-4 w-4 animate-spin" />{t("auditResults.detail.loadingEvidence")}</p>
          ) : detail.isError ? (
            <p className="text-severity-critical">{t("auditResults.detail.loadFailed")}</p>
          ) : (detail.data?.evidence.length ?? 0) === 0 ? (
            <p className="text-[rgb(var(--muted))]">{t("auditResults.detail.noEvidence")}</p>
          ) : (
            <div className="space-y-3">
              <p className="font-medium">{t("auditResults.detail.evidenceHeading", { count: detail.data!.evidence.length })}</p>
              {detail.data!.evidence.map((e, i) => (
                <div key={i} className="rounded-lg border p-3">
                  <p className="mb-1 text-xs text-[rgb(var(--muted))]">
                    {e.evidenceType}{e.role ? ` · ${e.role}` : ""}{e.sourceRowNo != null ? ` · ${t("auditResults.detail.row", { n: e.sourceRowNo })}` : ""}
                  </p>
                  {e.cells && e.cells.length > 0 ? (
                    <div className="overflow-x-auto">
                      <table className="w-full text-right text-xs">
                        <tbody>
                          {e.cells.map((c, j) => (
                            <tr key={j} className="border-b last:border-0">
                              <td className="py-1 pl-3 font-medium text-[rgb(var(--muted))]">{c.h}</td>
                              <td className="py-1 font-mono">{c.v ?? "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="text-xs text-[rgb(var(--muted))]">{t("auditResults.detail.noCells")}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function EmptyCard({ text, tone }: { text: string; tone?: "error" }) {
  return (
    <div
      className={`surface flex items-center justify-center rounded-xl border p-12 text-sm ${
        tone === "error" ? "text-severity-critical" : "text-[rgb(var(--muted))]"
      }`}
    >
      {text}
    </div>
  );
}
