"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useT } from "@/lib/i18n/use-t";
import type { MessageKey } from "@/lib/i18n/messages";
import type {
  FindingCategoriesResponse,
  FindingContentDTO,
  FindingVersionDTO,
} from "@/lib/ui-types";

const input =
  "surface w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500/40";
const primaryBtn =
  "rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60";
const secondaryBtn = "rounded-lg border px-4 py-2 text-sm";

const FIELDS: { key: keyof FindingContentDTO; labelKey: MessageKey; rows?: number }[] = [
  { key: "condition", labelKey: "findings.form.condition", rows: 2 },
  { key: "criteria", labelKey: "findings.form.criteria", rows: 2 },
  { key: "cause", labelKey: "findings.form.cause", rows: 2 },
  { key: "effect", labelKey: "findings.form.effect", rows: 2 },
  { key: "auditorConclusion", labelKey: "findings.form.conclusion", rows: 2 },
  { key: "recommendation", labelKey: "findings.form.recommendation", rows: 2 },
];

async function fetchCategories(): Promise<FindingCategoriesResponse> {
  const res = await fetch("/api/finding-categories");
  if (!res.ok) throw new Error("فشل تحميل الفئات");
  return (await res.json()) as FindingCategoriesResponse;
}

function emptyContent(): FindingContentDTO {
  return {
    category: "",
    condition: "",
    criteria: "",
    cause: "",
    effect: "",
    auditorConclusion: "",
    recommendation: "",
    observedAmount: "",
    observedCurrency: "SAR",
    estimatedExposureAmount: "",
    estimatedExposureCurrency: "SAR",
  };
}

export function FindingFormDialog({
  mode,
  exceptionId,
  engagementId,
  findingId,
  initial,
  onClose,
}: {
  mode: "create" | "revise";
  exceptionId: string;
  engagementId: string;
  findingId?: string;
  initial?: FindingVersionDTO | null;
  onClose: () => void;
}) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const [content, setContent] = useState<FindingContentDTO>(() => {
    if (initial) {
      return {
        category: initial.category,
        condition: initial.condition,
        criteria: initial.criteria,
        cause: initial.cause,
        effect: initial.effect,
        auditorConclusion: initial.auditorConclusion,
        recommendation: initial.recommendation ?? "",
        observedAmount: initial.observedAmount ?? "",
        observedCurrency: initial.observedCurrency ?? "",
        estimatedExposureAmount: initial.estimatedExposureAmount ?? "",
        estimatedExposureCurrency: initial.estimatedExposureCurrency ?? "",
      };
    }
    return emptyContent();
  });
  const [error, setError] = useState<string | null>(null);

  const { data: catData } = useQuery({
    queryKey: ["finding-categories"],
    queryFn: fetchCategories,
  });
  const categories = catData?.categories ?? [];

  const set = (key: keyof FindingContentDTO, value: string) =>
    setContent((c) => ({ ...c, [key]: value }));

  const mutation = useMutation({
    mutationFn: async () => {
      const url =
        mode === "create"
          ? `/api/findings/${exceptionId}/items`
          : `/api/findings/items/${findingId}`;
      const payload =
        mode === "create"
          ? { engagementId, content }
          : { action: "REVISE", content };
      const res = await fetch(url, {
        method: mode === "create" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || t("findings.form.saveError"));
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["exception", exceptionId] });
      await queryClient.invalidateQueries({ queryKey: ["exceptions"] });
      onClose();
    },
    onError: (e) => setError(e instanceof Error ? e.message : t("findings.form.saveError")),
  });

  const canSubmit =
    content.category.trim() !== "" &&
    content.condition.trim() !== "" &&
    content.criteria.trim() !== "" &&
    content.cause.trim() !== "" &&
    content.effect.trim() !== "" &&
    content.auditorConclusion.trim() !== "" &&
    !mutation.isPending;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={onClose}
    >
      <form
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (canSubmit) mutation.mutate();
        }}
        className="surface max-h-[88vh] w-full max-w-2xl space-y-3 overflow-y-auto rounded-2xl border p-5 shadow-card"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">
            {mode === "create" ? t("findings.form.titleCreate") : t("findings.form.titleRevise")}
          </h2>
          <button type="button" onClick={onClose} aria-label={t("findings.close")}>
            <X className="h-5 w-5 text-[rgb(var(--muted))]" />
          </button>
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium">{t("findings.form.category")}</label>
          <select
            className={input}
            value={content.category}
            onChange={(e) => set("category", e.target.value)}
            required
          >
            <option value="">{t("findings.form.selectCategory")}</option>
            {categories.map((c) => (
              <option key={c.code} value={c.code}>
                {c.labelAr}
              </option>
            ))}
          </select>
        </div>

        {FIELDS.map((f) => (
          <div key={f.key} className="space-y-1">
            <label className="text-sm font-medium">{t(f.labelKey)}</label>
            <textarea
              className={input}
              rows={f.rows ?? 2}
              value={content[f.key] ?? ""}
              onChange={(e) => set(f.key, e.target.value)}
            />
          </div>
        ))}

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-sm font-medium">{t("findings.form.observedAmount")}</label>
            <input
              className={input}
              value={content.observedAmount ?? ""}
              onChange={(e) => set("observedAmount", e.target.value)}
              placeholder="0.00"
              inputMode="decimal"
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">{t("findings.form.currency")}</label>
            <input
              className={input}
              value={content.observedCurrency ?? ""}
              onChange={(e) => set("observedCurrency", e.target.value)}
              placeholder="SAR"
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">{t("findings.form.estimatedExposure")}</label>
            <input
              className={input}
              value={content.estimatedExposureAmount ?? ""}
              onChange={(e) => set("estimatedExposureAmount", e.target.value)}
              placeholder="0.00"
              inputMode="decimal"
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">{t("findings.form.currency")}</label>
            <input
              className={input}
              value={content.estimatedExposureCurrency ?? ""}
              onChange={(e) => set("estimatedExposureCurrency", e.target.value)}
              placeholder="SAR"
            />
          </div>
        </div>

        {error && <p className="text-sm text-severity-critical">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className={secondaryBtn} onClick={onClose}>
            {t("findings.cancel")}
          </button>
          <button type="submit" className={primaryBtn} disabled={!canSubmit}>
            {mutation.isPending ? t("findings.form.saving") : t("findings.form.save")}
          </button>
        </div>
      </form>
    </div>
  );
}
