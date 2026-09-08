"use client";

import { useQuery } from "@tanstack/react-query";
import { ShieldAlert, AlertTriangle, CircleCheck, Clock } from "lucide-react";
import { useUIStore } from "@/store/ui-store";
import { useT } from "@/lib/i18n/use-t";
import type { AnomaliesResponse } from "@/lib/ui-types";

async function fetchSummary(engagementId: string): Promise<AnomaliesResponse> {
  const params = new URLSearchParams();
  if (engagementId) params.set("engagementId", engagementId);
  const res = await fetch(`/api/anomalies?${params.toString()}`);
  if (!res.ok) throw new Error("failed");
  return (await res.json()) as AnomaliesResponse;
}

interface Stat {
  labelAr: string;
  value: number;
  icon: typeof ShieldAlert;
  tone: string;
}

export function StatCards() {
  const { t } = useT();
  const engagementId = useUIStore((s) => s.engagementId);
  const { data } = useQuery({
    queryKey: ["anomalies-summary", engagementId],
    queryFn: () => fetchSummary(engagementId),
  });

  const anomalies = data?.anomalies ?? [];
  const critical = anomalies.filter((a) => a.severity === "CRITICAL").length;
  const high = anomalies.filter((a) => a.severity === "HIGH").length;
  const open = anomalies.filter(
    (a) => a.status === "OPEN" || a.status === "IN_REVIEW",
  ).length;
  const resolved = anomalies.filter((a) => a.status === "RESOLVED").length;

  const stats: Stat[] = [
    {
      labelAr: t("anomalies.stat.critical"),
      value: critical,
      icon: ShieldAlert,
      tone: "text-severity-critical",
    },
    {
      labelAr: t("anomalies.stat.high"),
      value: high,
      icon: AlertTriangle,
      tone: "text-severity-high",
    },
    {
      labelAr: t("anomalies.stat.open"),
      value: open,
      icon: Clock,
      tone: "text-severity-medium",
    },
    {
      labelAr: t("anomalies.stat.resolved"),
      value: resolved,
      icon: CircleCheck,
      tone: "text-severity-low",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {stats.map((stat) => {
        const Icon = stat.icon;
        return (
          <div
            key={stat.labelAr}
            className="surface flex items-center gap-3 rounded-xl border p-4 shadow-card"
          >
            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-black/5 dark:bg-white/5">
              <Icon className={`h-5 w-5 ${stat.tone}`} />
            </div>
            <div>
              <p className="text-2xl font-bold tabular-nums">{stat.value}</p>
              <p className="text-xs text-[rgb(var(--muted))]">
                {stat.labelAr}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
