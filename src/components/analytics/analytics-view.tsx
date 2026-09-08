"use client";

import { useQuery } from "@tanstack/react-query";
import { Loader2, ServerCrash, ShieldAlert, ShieldCheck } from "lucide-react";
import { useUIStore } from "@/store/ui-store";
import type { AnalyticsResponse } from "@/lib/ui-types";
import { useT } from "@/lib/i18n/use-t";
import { BenfordChart } from "./benford-chart";

async function fetchAnalytics(
  engagementId: string,
): Promise<AnalyticsResponse> {
  const params = new URLSearchParams();
  if (engagementId) params.set("engagementId", engagementId);
  const res = await fetch(`/api/analytics?${params.toString()}`);
  if (!res.ok) throw new Error("فشل تحميل التحليلات");
  return (await res.json()) as AnalyticsResponse;
}

export function AnalyticsView() {
  const { t } = useT();
  const engagementId = useUIStore((s) => s.engagementId);
  const { data, isPending, isError } = useQuery({
    queryKey: ["analytics", engagementId],
    queryFn: () => fetchAnalytics(engagementId),
  });

  if (isPending) {
    return (
      <div className="surface flex items-center justify-center gap-2 rounded-xl border p-12 text-[rgb(var(--muted))]">
        <Loader2 className="h-5 w-5 animate-spin" />
        {t("analytics.loading")}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="surface flex flex-col items-center justify-center gap-2 rounded-xl border p-12 text-severity-critical">
        <ServerCrash className="h-6 w-6" />
        {t("analytics.error.generic")}
      </div>
    );
  }

  const rejects = data.rejectsBenford;

  return (
    <div className="space-y-5">
      {/* Verdict banner */}
      <div
        className={`surface flex items-start gap-3 rounded-xl border p-4 shadow-card ${
          rejects ? "ring-1 ring-severity-high/30" : ""
        }`}
      >
        <div
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ${
            rejects
              ? "bg-severity-high/10 text-severity-high"
              : "bg-severity-low/10 text-severity-low"
          }`}
        >
          {rejects ? (
            <ShieldAlert className="h-5 w-5" />
          ) : (
            <ShieldCheck className="h-5 w-5" />
          )}
        </div>
        <div>
          <h2 className="font-semibold">
            {rejects
              ? t("analytics.verdict.reject")
              : t("analytics.verdict.ok")}
          </h2>
          <p className="mt-0.5 text-sm text-[rgb(var(--muted))]">
            {t("analytics.benford.stats", {
              chiSquare: data.chiSquare,
              criticalValue: data.criticalValue,
              sampleSize: data.sampleSize,
            })}
            {rejects
              ? t("analytics.benford.adviceReview")
              : t("analytics.benford.adviceOk")}
          </p>
        </div>
      </div>

      {/* Chart */}
      <div className="surface rounded-xl border p-4 shadow-card">
        <h3 className="mb-3 font-semibold">{t("analytics.firstDigit.title")}</h3>
        <BenfordChart digits={data.digits} />
      </div>
    </div>
  );
}
