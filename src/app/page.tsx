import { DashboardShell } from "@/components/layout/dashboard-shell";
import { StatCards } from "@/components/anomalies/stat-cards";
import { FilterBar } from "@/components/anomalies/filter-bar";
import { AnomaliesFeed } from "@/components/anomalies/anomalies-feed";
import { ExportButtons } from "@/components/anomalies/export-buttons";

export default function DashboardPage() {
  return (
    <DashboardShell>
      <div className="mx-auto max-w-6xl space-y-5">
        {/* Print-only report header (visible when exporting to PDF). */}
        <div className="hidden print:block">
          <h1 className="text-xl font-bold">تقرير الحالات الشاذة</h1>
          <p className="text-sm text-[rgb(var(--muted))]">
            مدقق مالي — {new Intl.DateTimeFormat("ar-SA", { dateStyle: "long" }).format(new Date())}
          </p>
        </div>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">لوحة التدقيق</h1>
            <p className="text-sm text-[rgb(var(--muted))]">
              رصد الحالات الشاذة في القيود والمعاملات المالية لحظياً.
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
