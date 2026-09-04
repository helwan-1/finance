"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, FileText } from "lucide-react";
import {
  FINDING_STATUS_BADGE,
  FINDING_STATUS_LABELS_AR,
} from "@/lib/labels";
import type {
  ExceptionDetailResponse,
  ExceptionDetailDTO,
  FindingDTO,
  FindingVersionDTO,
} from "@/lib/ui-types";
import { FindingFormDialog } from "./finding-form-dialog";

const btn = "rounded-lg border px-3 py-1.5 text-xs font-medium hover:bg-black/5 dark:hover:bg-white/5";
const btnBrand =
  "inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700";
const btnDanger =
  "rounded-lg border border-severity-critical/40 px-3 py-1.5 text-xs font-medium text-severity-critical hover:bg-severity-critical/5";

async function fetchDetail(
  exceptionId: string,
  engagementId: string,
): Promise<ExceptionDetailResponse> {
  const res = await fetch(
    `/api/findings/${exceptionId}?engagementId=${encodeURIComponent(engagementId)}`,
  );
  if (!res.ok) throw new Error("فشل تحميل التفاصيل");
  return (await res.json()) as ExceptionDetailResponse;
}

export function ExceptionDetail({
  exceptionId,
  engagementId,
}: {
  exceptionId: string;
  engagementId: string;
}) {
  const queryClient = useQueryClient();
  const [showNewFinding, setShowNewFinding] = useState(false);
  const [reviseTarget, setReviseTarget] = useState<FindingDTO | null>(null);

  const { data, isPending, isError } = useQuery({
    queryKey: ["exception", exceptionId],
    queryFn: () => fetchDetail(exceptionId, engagementId),
  });

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ["exception", exceptionId] });
    await queryClient.invalidateQueries({ queryKey: ["exceptions"] });
  };

  const exceptionAction = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const res = await fetch(`/api/findings/${exceptionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error || "فشل تنفيذ العملية");
      }
    },
    onSuccess: invalidate,
    onError: (e) => alert(e instanceof Error ? e.message : "فشل تنفيذ العملية"),
  });

  const findingAction = useMutation({
    mutationFn: async ({
      findingId,
      payload,
    }: {
      findingId: string;
      payload: Record<string, unknown>;
    }) => {
      const res = await fetch(`/api/findings/items/${findingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error || "فشل تنفيذ العملية");
      }
    },
    onSuccess: invalidate,
    onError: (e) => alert(e instanceof Error ? e.message : "فشل تنفيذ العملية"),
  });

  if (isPending) {
    return <p className="text-sm text-[rgb(var(--muted))]">جارٍ التحميل…</p>;
  }
  if (isError || !data) {
    return <p className="text-sm text-severity-critical">تعذّر تحميل التفاصيل.</p>;
  }

  const ex: ExceptionDetailDTO = data.exception;
  const open = ex.status === "OPEN" || ex.status === "UNDER_INVESTIGATION";
  const closed = ex.status === "CLOSED_NO_FINDING" || ex.status === "CONCLUDED_WITH_FINDING";

  return (
    <div className="space-y-4">
      {ex.description && (
        <p className="text-sm text-[rgb(var(--foreground))]">{ex.description}</p>
      )}

      {ex.linkedResultIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-[rgb(var(--muted))]">النتائج المرتبطة:</span>
          {ex.linkedResultIds.map((id) => (
            <span
              key={id}
              className="rounded-md bg-black/5 px-2 py-0.5 font-mono text-[11px] dark:bg-white/5"
            >
              {id.slice(0, 10)}
            </span>
          ))}
        </div>
      )}

      {/* Exception lifecycle */}
      <div className="flex flex-wrap gap-2">
        {open && (
          <>
            <button
              type="button"
              className={btn}
              disabled={exceptionAction.isPending}
              onClick={() => {
                if (window.confirm("اعتماد إنهاء المسألة بنتيجة؟ يتطلب وجود نتيجة معتمدة.")) {
                  exceptionAction.mutate({ action: "CONCLUDE" });
                }
              }}
            >
              إنهاء بنتيجة
            </button>
            <button
              type="button"
              className={btnDanger}
              disabled={exceptionAction.isPending}
              onClick={() => {
                const rationale = window.prompt("سبب الإغلاق بلا نتيجة:");
                if (rationale && rationale.trim()) {
                  exceptionAction.mutate({ action: "DISMISS", rationale: rationale.trim() });
                }
              }}
            >
              إغلاق بلا نتيجة
            </button>
          </>
        )}
        {closed && (
          <button
            type="button"
            className={btn}
            disabled={exceptionAction.isPending}
            onClick={() => {
              const reason = window.prompt("سبب إعادة الفتح:");
              if (reason && reason.trim()) {
                exceptionAction.mutate({ action: "REOPEN", reason: reason.trim() });
              }
            }}
          >
            إعادة الفتح
          </button>
        )}
      </div>

      {/* Findings */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold">نتائج التدقيق ({ex.findings.length})</h3>
          <button type="button" className={btnBrand} onClick={() => setShowNewFinding(true)}>
            <Plus className="h-3.5 w-3.5" />
            نتيجة جديدة
          </button>
        </div>

        {ex.findings.length === 0 ? (
          <p className="text-sm text-[rgb(var(--muted))]">لا توجد نتائج بعد.</p>
        ) : (
          ex.findings.map((f) => (
            <FindingBlock
              key={f.id}
              finding={f}
              busy={findingAction.isPending}
              onRevise={() => setReviseTarget(f)}
              onSubmit={() => {
                if (window.confirm("إرسال النتيجة للمراجعة؟")) {
                  findingAction.mutate({ findingId: f.id, payload: { action: "SUBMIT" } });
                }
              }}
              onApprove={() => {
                if (!f.currentVersionId) return;
                if (window.confirm("اعتماد النتيجة؟")) {
                  findingAction.mutate({
                    findingId: f.id,
                    payload: {
                      action: "REVIEW",
                      reviewAction: "APPROVE",
                      findingVersionId: f.currentVersionId,
                    },
                  });
                }
              }}
              onReturn={() => {
                if (!f.currentVersionId) return;
                const note = window.prompt("ملاحظة الإرجاع (اختياري):") ?? undefined;
                findingAction.mutate({
                  findingId: f.id,
                  payload: {
                    action: "REVIEW",
                    reviewAction: "RETURN",
                    findingVersionId: f.currentVersionId,
                    note: note && note.trim() ? note.trim() : null,
                  },
                });
              }}
            />
          ))
        )}
      </div>

      {showNewFinding && (
        <FindingFormDialog
          mode="create"
          exceptionId={exceptionId}
          engagementId={engagementId}
          onClose={() => setShowNewFinding(false)}
        />
      )}
      {reviseTarget && (
        <FindingFormDialog
          mode="revise"
          exceptionId={exceptionId}
          engagementId={engagementId}
          findingId={reviseTarget.id}
          initial={reviseTarget.currentVersion}
          onClose={() => setReviseTarget(null)}
        />
      )}
    </div>
  );
}

function Row({ labelAr, value }: { labelAr: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-2 text-sm">
      <span className="text-[rgb(var(--muted))]">{labelAr}</span>
      <span className="whitespace-pre-wrap">{value}</span>
    </div>
  );
}

function FindingBlock({
  finding,
  busy,
  onRevise,
  onSubmit,
  onApprove,
  onReturn,
}: {
  finding: FindingDTO;
  busy: boolean;
  onRevise: () => void;
  onSubmit: () => void;
  onApprove: () => void;
  onReturn: () => void;
}) {
  const v: FindingVersionDTO | null = finding.currentVersion;
  const isDraft = finding.status === "DRAFT";
  const inReview = finding.status === "IN_REVIEW";

  return (
    <div className="rounded-lg border p-3">
      <div className="mb-2 flex items-center gap-2">
        <FileText className="h-4 w-4 text-brand-600" />
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${FINDING_STATUS_BADGE[finding.status]}`}
        >
          {FINDING_STATUS_LABELS_AR[finding.status]}
        </span>
        {v && (
          <span className="text-[11px] text-[rgb(var(--muted))]">نسخة {v.versionNo}</span>
        )}
      </div>

      {v && (
        <div className="space-y-1.5">
          <Row labelAr="الحالة" value={v.condition} />
          <Row labelAr="المعيار" value={v.criteria} />
          <Row labelAr="السبب" value={v.cause} />
          <Row labelAr="الأثر" value={v.effect} />
          <Row labelAr="الاستنتاج" value={v.auditorConclusion} />
          <Row labelAr="التوصية" value={v.recommendation} />
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {isDraft && (
          <>
            <button type="button" className={btn} disabled={busy} onClick={onRevise}>
              تعديل
            </button>
            <button type="button" className={btnBrand} disabled={busy} onClick={onSubmit}>
              إرسال للمراجعة
            </button>
          </>
        )}
        {inReview && (
          <>
            <button type="button" className={btnBrand} disabled={busy} onClick={onApprove}>
              اعتماد
            </button>
            <button type="button" className={btn} disabled={busy} onClick={onReturn}>
              إرجاع
            </button>
          </>
        )}
      </div>
    </div>
  );
}
