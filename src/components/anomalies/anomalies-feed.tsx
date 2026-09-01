"use client";

import { useQuery } from "@tanstack/react-query";
import { Loader2, ShieldCheck, ServerCrash } from "lucide-react";
import { useUIStore } from "@/store/ui-store";
import type { AnomaliesResponse, AnomalyFilters } from "@/lib/ui-types";
import { AnomalyCard } from "./anomaly-card";

function buildQuery(engagementId: string, filters: AnomalyFilters): string {
  const params = new URLSearchParams();
  if (engagementId) params.set("engagementId", engagementId);
  if (filters.search) params.set("search", filters.search);
  if (filters.severity !== "ALL") params.set("severity", filters.severity);
  if (filters.ruleCode !== "ALL") params.set("ruleCode", filters.ruleCode);
  if (filters.status !== "ALL") params.set("status", filters.status);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  return params.toString();
}

async function fetchAnomalies(
  engagementId: string,
  filters: AnomalyFilters,
): Promise<AnomaliesResponse> {
  const qs = buildQuery(engagementId, filters);
  const res = await fetch(`/api/anomalies?${qs}`);
  if (!res.ok) throw new Error("فشل تحميل الحالات الشاذة");
  return (await res.json()) as AnomaliesResponse;
}

export function AnomaliesFeed() {
  const engagementId = useUIStore((s) => s.engagementId);
  const filters = useUIStore((s) => s.filters);

  const { data, isPending, isError } = useQuery({
    queryKey: ["anomalies", engagementId, filters],
    queryFn: () => fetchAnomalies(engagementId, filters),
  });

  if (isPending) {
    return (
      <div className="surface flex items-center justify-center gap-2 rounded-xl border p-12 text-[rgb(var(--muted))]">
        <Loader2 className="h-5 w-5 animate-spin" />
        جارٍ تحميل الحالات الشاذة...
      </div>
    );
  }

  if (isError) {
    return (
      <div className="surface flex flex-col items-center justify-center gap-2 rounded-xl border p-12 text-severity-critical">
        <ServerCrash className="h-6 w-6" />
        تعذّر تحميل البيانات. حاول مرة أخرى.
      </div>
    );
  }

  if (data.anomalies.length === 0) {
    return (
      <div className="surface flex flex-col items-center justify-center gap-2 rounded-xl border p-12 text-[rgb(var(--muted))]">
        <ShieldCheck className="h-7 w-7 text-severity-low" />
        لا توجد حالات شاذة مطابقة للمرشحات الحالية.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-[rgb(var(--muted))]">
        {data.total} حالة شاذة
      </p>
      {data.anomalies.map((anomaly) => (
        <AnomalyCard key={anomaly.id} anomaly={anomaly} />
      ))}
    </div>
  );
}
