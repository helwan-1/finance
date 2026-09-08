"use client";

import { FolderOpen, Search, FileCheck2, Archive } from "lucide-react";
import { useT } from "@/lib/i18n/use-t";
import type { ExceptionDTO } from "@/lib/ui-types";

export function StatCards({ exceptions }: { exceptions: ExceptionDTO[] }) {
  const { t } = useT();
  const count = (s: string) => exceptions.filter((e) => e.status === s).length;

  const stats = [
    { labelAr: t("findings.stat.open"), value: count("OPEN"), icon: FolderOpen, tone: "text-severity-info" },
    {
      labelAr: t("findings.stat.underInvestigation"),
      value: count("UNDER_INVESTIGATION"),
      icon: Search,
      tone: "text-severity-medium",
    },
    {
      labelAr: t("findings.stat.concludedWithFinding"),
      value: count("CONCLUDED_WITH_FINDING"),
      icon: FileCheck2,
      tone: "text-severity-critical",
    },
    {
      labelAr: t("findings.stat.closedNoFinding"),
      value: count("CLOSED_NO_FINDING"),
      icon: Archive,
      tone: "text-[rgb(var(--muted))]",
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
              <p className="text-xs text-[rgb(var(--muted))]">{stat.labelAr}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
