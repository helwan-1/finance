"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ClipboardList, Plus, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { useUIStore } from "@/store/ui-store";
import {
  SEVERITY_LABELS_AR,
  SEVERITY_BADGE,
  DISPOSITION_STATE_LABELS_AR,
  DISPOSITION_STATE_BADGE,
  DISPOSITION_ACTION_LABELS_AR,
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

const STATE_FILTER: { value: string; labelAr: string }[] = [
  { value: "ALL", labelAr: "كل الحالات" },
  { value: "UNREVIEWED", labelAr: DISPOSITION_STATE_LABELS_AR.UNREVIEWED },
  { value: "UNDER_REVIEW", labelAr: DISPOSITION_STATE_LABELS_AR.UNDER_REVIEW },
  { value: "INVESTIGATING", labelAr: DISPOSITION_STATE_LABELS_AR.INVESTIGATING },
  { value: "DISPOSED", labelAr: DISPOSITION_STATE_LABELS_AR.DISPOSED },
  { value: "LINKED", labelAr: DISPOSITION_STATE_LABELS_AR.LINKED },
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
        throw new Error(b.error || "فشل تسجيل الحكم");
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["audit-results"] }),
    onError: (e) => alert(e instanceof Error ? e.message : "فشل تسجيل الحكم"),
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
          aria-label="تصفية حسب الحالة"
        >
          {STATE_FILTER.map((o) => (
            <option key={o.value} value={o.value}>
              {o.labelAr}
            </option>
          ))}
        </select>
        <span className="text-sm text-[rgb(var(--muted))]">{results.length} مؤشّر</span>
      </div>

      {!engagementId ? (
        <EmptyCard text="اختر ارتباطًا من الأعلى لعرض المؤشّرات." />
      ) : isPending ? (
        <EmptyCard text="جارٍ التحميل…" />
      ) : isError ? (
        <EmptyCard text="تعذّر تحميل البيانات. حاول مرة أخرى." tone="error" />
      ) : results.length === 0 ? (
        <EmptyCard text="لا توجد مؤشّرات تدقيق مطابقة. شغّل محرّك التدقيق (G4) لإنتاج مؤشّرات." />
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
          presetResultLabel={`${exceptionFor.resultCode} · ${SEVERITY_LABELS_AR[exceptionFor.severity]}`}
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
  const state = r.dispositionState as DispositionStateKind;
  const stateLabel = DISPOSITION_STATE_LABELS_AR[state] ?? r.dispositionState;
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
          aria-label={open ? "إخفاء التفاصيل" : "عرض التفاصيل"}
          title={open ? "إخفاء التفاصيل" : "عرض التفاصيل"}
        >
          <ClipboardList className="h-5 w-5 text-brand-600" />
        </button>
        <button type="button" onClick={() => setOpen((v) => !v)} className="min-w-0 flex-1 text-right">
          <p className="truncate font-semibold">{r.resultCode}</p>
          <p className="text-xs text-[rgb(var(--muted))]">
            {r.resultKind} · درجة {r.score}
          </p>
        </button>
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${SEVERITY_BADGE[r.severity]}`}
        >
          {SEVERITY_LABELS_AR[r.severity]}
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
            التفاصيل
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
            aria-label="تسجيل حكم"
          >
            <option value="">— حكم —</option>
            {ACTIONS.map((a) => (
              <option key={a} value={a}>
                {DISPOSITION_ACTION_LABELS_AR[a]}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={btnBrand}
            onClick={onCreateException}
            disabled={busy || linked}
            title={linked ? "مرتبطة بمسألة تدقيق بالفعل" : undefined}
          >
            <Plus className="h-3.5 w-3.5" />
            فتح مسألة تدقيق
          </button>
        </div>
      </div>

      {open && (
        <div className="border-t p-4 text-sm">
          <div className="mb-2 flex flex-wrap gap-x-6 gap-y-1 text-xs text-[rgb(var(--muted))]">
            <span>النوع: {r.resultKind}</span>
            <span>الخطورة: {SEVERITY_LABELS_AR[r.severity]}</span>
            <span>الدرجة: {r.score}</span>
            {detail.data?.resultSemanticFingerprint && (
              <span className="font-mono">البصمة: {detail.data.resultSemanticFingerprint.slice(0, 16)}…</span>
            )}
          </div>
          {detail.isPending ? (
            <p className="flex items-center gap-2 text-[rgb(var(--muted))]"><Loader2 className="h-4 w-4 animate-spin" />جارٍ تحميل الدليل…</p>
          ) : detail.isError ? (
            <p className="text-severity-critical">تعذّر تحميل التفاصيل.</p>
          ) : (detail.data?.evidence.length ?? 0) === 0 ? (
            <p className="text-[rgb(var(--muted))]">لا يوجد دليل مرتبط بهذا المؤشّر.</p>
          ) : (
            <div className="space-y-3">
              <p className="font-medium">الدليل — السجلات المصدرية ({detail.data!.evidence.length})</p>
              {detail.data!.evidence.map((e, i) => (
                <div key={i} className="rounded-lg border p-3">
                  <p className="mb-1 text-xs text-[rgb(var(--muted))]">
                    {e.evidenceType}{e.role ? ` · ${e.role}` : ""}{e.sourceRowNo != null ? ` · صف ${e.sourceRowNo}` : ""}
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
                    <p className="text-xs text-[rgb(var(--muted))]">لا تتوفّر خلايا مصدرية لهذا الدليل.</p>
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
