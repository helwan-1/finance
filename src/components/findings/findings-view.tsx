"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Gavel, ChevronDown } from "lucide-react";
import { useUIStore } from "@/store/ui-store";
import {
  EXCEPTION_STATUS_BADGE,
  EXCEPTION_STATUS_LABELS_AR,
  MATTER_PRIORITY_BADGE,
  MATTER_PRIORITY_LABELS_AR,
} from "@/lib/labels";
import type {
  ExceptionDTO,
  ExceptionStatus,
  ExceptionsResponse,
} from "@/lib/ui-types";
import { StatCards } from "./stat-cards";
import { ExceptionDetail } from "./exception-detail";
import { NewExceptionDialog } from "./new-exception-dialog";

const selectClass =
  "surface rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500/40";
const primaryBtn =
  "inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60";

const STATUS_OPTIONS: { value: string; labelAr: string }[] = [
  { value: "ALL", labelAr: "كل الحالات" },
  { value: "OPEN", labelAr: EXCEPTION_STATUS_LABELS_AR.OPEN },
  { value: "UNDER_INVESTIGATION", labelAr: EXCEPTION_STATUS_LABELS_AR.UNDER_INVESTIGATION },
  { value: "CONCLUDED_WITH_FINDING", labelAr: EXCEPTION_STATUS_LABELS_AR.CONCLUDED_WITH_FINDING },
  { value: "CLOSED_NO_FINDING", labelAr: EXCEPTION_STATUS_LABELS_AR.CLOSED_NO_FINDING },
];

async function fetchExceptions(
  engagementId: string,
  status: string,
): Promise<ExceptionsResponse> {
  const qs = new URLSearchParams({ engagementId });
  if (status !== "ALL") qs.set("status", status);
  const res = await fetch(`/api/findings?${qs.toString()}`);
  if (!res.ok) throw new Error("فشل تحميل المسائل");
  return (await res.json()) as ExceptionsResponse;
}

export function FindingsView() {
  const engagementId = useUIStore((s) => s.engagementId);
  const [status, setStatus] = useState("ALL");
  const [showNew, setShowNew] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data, isPending, isError } = useQuery({
    queryKey: ["exceptions", engagementId, status],
    queryFn: () => fetchExceptions(engagementId, status),
    enabled: Boolean(engagementId),
  });

  const exceptions = data?.exceptions ?? [];

  return (
    <div className="space-y-5">
      <StatCards exceptions={exceptions} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <select
          className={selectClass}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          aria-label="تصفية حسب الحالة"
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.labelAr}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={primaryBtn}
          onClick={() => setShowNew(true)}
          disabled={!engagementId}
        >
          <Plus className="h-4 w-4" />
          استثناء جديد
        </button>
      </div>

      {!engagementId ? (
        <EmptyCard text="اختر ارتباطًا من الأعلى لعرض المسائل." />
      ) : isPending ? (
        <EmptyCard text="جارٍ التحميل…" />
      ) : isError ? (
        <EmptyCard text="تعذّر تحميل البيانات. حاول مرة أخرى." tone="error" />
      ) : exceptions.length === 0 ? (
        <EmptyCard text="لا توجد مسائل بعد. ابدأ بإنشاء استثناء من نتيجة تدقيق." />
      ) : (
        <div className="space-y-3">
          {exceptions.map((ex) => (
            <ExceptionRow
              key={ex.id}
              ex={ex}
              engagementId={engagementId}
              expanded={expandedId === ex.id}
              onToggle={() =>
                setExpandedId((cur) => (cur === ex.id ? null : ex.id))
              }
            />
          ))}
        </div>
      )}

      {showNew && (
        <NewExceptionDialog
          engagementId={engagementId}
          onClose={() => setShowNew(false)}
        />
      )}
    </div>
  );
}

function ExceptionRow({
  ex,
  engagementId,
  expanded,
  onToggle,
}: {
  ex: ExceptionDTO;
  engagementId: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="surface overflow-hidden rounded-xl border shadow-card">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 p-4 text-right hover:bg-black/5 dark:hover:bg-white/5"
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-black/5 dark:bg-white/5">
          <Gavel className="h-5 w-5 text-brand-600" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{ex.titleAr || ex.title}</p>
          <p className="text-xs text-[rgb(var(--muted))]">
            {ex.linkedResultCount} نتيجة مرتبطة · {ex.findingCount} نتيجة تدقيق
          </p>
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${MATTER_PRIORITY_BADGE[ex.priority]}`}
        >
          {MATTER_PRIORITY_LABELS_AR[ex.priority]}
        </span>
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${EXCEPTION_STATUS_BADGE[ex.status as ExceptionStatus]}`}
        >
          {EXCEPTION_STATUS_LABELS_AR[ex.status as ExceptionStatus]}
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-[rgb(var(--muted))] transition-transform ${expanded ? "rotate-180" : ""}`}
        />
      </button>
      {expanded && (
        <div className="border-t p-4">
          <ExceptionDetail
            exceptionId={ex.id}
            engagementId={engagementId}
          />
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
