"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ClipboardList, Plus } from "lucide-react";
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
  if (!res.ok) throw new Error("فشل تحميل نتائج التدقيق");
  return (await res.json()) as AuditResultsResponse;
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
        <span className="text-sm text-[rgb(var(--muted))]">{results.length} نتيجة</span>
      </div>

      {!engagementId ? (
        <EmptyCard text="اختر ارتباطًا من الأعلى لعرض النتائج." />
      ) : isPending ? (
        <EmptyCard text="جارٍ التحميل…" />
      ) : isError ? (
        <EmptyCard text="تعذّر تحميل البيانات. حاول مرة أخرى." tone="error" />
      ) : results.length === 0 ? (
        <EmptyCard text="لا توجد نتائج تدقيق مطابقة. شغّل محرّك التدقيق (G4) لإنتاج نتائج." />
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

  return (
    <div className="surface flex flex-wrap items-center gap-3 rounded-xl border p-4 shadow-card">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-black/5 dark:bg-white/5">
        <ClipboardList className="h-5 w-5 text-brand-600" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{r.resultCode}</p>
        <p className="text-xs text-[rgb(var(--muted))]">
          {r.resultKind} · درجة {r.score}
        </p>
      </div>
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
          title={linked ? "مرتبطة بمسألة بالفعل" : undefined}
        >
          <Plus className="h-3.5 w-3.5" />
          استثناء
        </button>
      </div>
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
