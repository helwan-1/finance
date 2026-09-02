import { DashboardShell } from "@/components/layout/dashboard-shell";
import { StatCards } from "@/components/anomalies/stat-cards";
import { FilterBar } from "@/components/anomalies/filter-bar";
import { AnomaliesFeed } from "@/components/anomalies/anomalies-feed";
import { ExportButtons } from "@/components/anomalies/export-buttons";

export default function AnomaliesPage() {
  return (
    <DashboardShell>
      <div className="mx-auto max-w-6xl space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">الحالات الشاذة</h1>
            <p className="text-sm text-[rgb(var(--muted))]">
              جميع الحالات الشاذة المرصودة مع الفلترة والتصدير والمعالجة.
            </p>
          </div>
          <ExportButtons />
        </div>
        <StatCards />
        <FilterBar />
        <AnomaliesFeed />
      </div>
    </DashboardShell>
  );
}
