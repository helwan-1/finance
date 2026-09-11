"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useT } from "@/lib/i18n/use-t";
import { useLabels } from "@/lib/i18n/use-labels";
import type {
  AuditResultsResponse,
  MatterPriority,
} from "@/lib/ui-types";

const input =
  "surface w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500/40";
const primaryBtn =
  "rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60";
const secondaryBtn = "rounded-lg border px-4 py-2 text-sm";

async function fetchResults(engagementId: string): Promise<AuditResultsResponse> {
  const res = await fetch(`/api/audit-results?engagementId=${encodeURIComponent(engagementId)}`);
  if (!res.ok) throw new Error("فشل تحميل مؤشّرات التدقيق");
  return (await res.json()) as AuditResultsResponse;
}

export function NewExceptionDialog({
  engagementId,
  onClose,
  presetResultId,
  presetResultLabel,
}: {
  engagementId: string;
  onClose: () => void;
  /** When set, the source result is fixed and the picker is hidden. */
  presetResultId?: string;
  presetResultLabel?: string;
}) {
  const { t } = useT();
  const labels = useLabels();
  const queryClient = useQueryClient();
  const [firstResultId, setFirstResultId] = useState(presetResultId ?? "");
  const [title, setTitle] = useState("");
  const [titleAr, setTitleAr] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<MatterPriority>("MEDIUM");
  const [error, setError] = useState<string | null>(null);

  const { data, isPending } = useQuery({
    queryKey: ["audit-results", engagementId],
    queryFn: () => fetchResults(engagementId),
    enabled: Boolean(engagementId) && !presetResultId,
  });

  const results = data?.results ?? [];

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/findings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          engagementId,
          firstResultId,
          title: title || titleAr,
          titleAr: titleAr || null,
          description: description || null,
          priority,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || t("findings.newException.openError"));
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["exceptions"] });
      await queryClient.invalidateQueries({ queryKey: ["audit-results"] });
      onClose();
    },
    onError: (e) => setError(e instanceof Error ? e.message : t("findings.newException.openError")),
  });

  const canSubmit = Boolean(firstResultId) && Boolean(title || titleAr) && !mutation.isPending;

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={onClose}
    >
      <form
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (canSubmit) mutation.mutate();
        }}
        className="surface max-h-[85vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-2xl border p-5 shadow-card"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">{t("findings.newException.title")}</h2>
          <button type="button" onClick={onClose} aria-label={t("findings.close")}>
            <X className="h-5 w-5 text-[rgb(var(--muted))]" />
          </button>
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium">{t("findings.newException.sourceResult")}</label>
          {!presetResultId && (
            <p className="text-xs text-[rgb(var(--muted))]">
              {t("findings.newException.hint")}
            </p>
          )}
          {presetResultId ? (
            <p className="rounded-lg border p-3 text-sm font-mono">
              {presetResultLabel ?? presetResultId}
            </p>
          ) : isPending ? (
            <p className="text-sm text-[rgb(var(--muted))]">{t("findings.newException.loadingResults")}</p>
          ) : results.length === 0 ? (
            <p className="rounded-lg border p-3 text-sm text-[rgb(var(--muted))]">
              {t("findings.newException.noResults")}
            </p>
          ) : (
            <select
              className={input}
              value={firstResultId}
              onChange={(e) => setFirstResultId(e.target.value)}
              required
            >
              <option value="">{t("findings.newException.selectResult")}</option>
              {results.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.resultCode} · {labels.severity[r.severity]} · {r.dispositionState}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium">{t("findings.newException.titleAr")}</label>
          <input
            className={input}
            value={titleAr}
            onChange={(e) => setTitleAr(e.target.value)}
            placeholder={t("findings.newException.titlePlaceholder")}
          />
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium">{t("findings.newException.titleEn")}</label>
          <input
            className={input}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Matter title"
          />
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium">{t("findings.newException.description")}</label>
          <textarea
            className={input}
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium">{t("findings.newException.priority")}</label>
          <select
            className={input}
            value={priority}
            onChange={(e) => setPriority(e.target.value as MatterPriority)}
          >
            <option value="LOW">{t("findings.priority.low")}</option>
            <option value="MEDIUM">{t("findings.priority.medium")}</option>
            <option value="HIGH">{t("findings.priority.high")}</option>
          </select>
        </div>

        {error && <p className="text-sm text-severity-critical">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" className={secondaryBtn} onClick={onClose}>
            {t("findings.cancel")}
          </button>
          <button type="submit" className={primaryBtn} disabled={!canSubmit}>
            {mutation.isPending ? t("findings.newException.creating") : t("findings.newException.create")}
          </button>
        </div>
      </form>
    </div>
  );
}
