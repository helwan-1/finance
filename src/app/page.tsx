import { DashboardShell } from "@/components/layout/dashboard-shell";
import { StatCards } from "@/components/anomalies/stat-cards";
import { FilterBar } from "@/components/anomalies/filter-bar";
import { AnomaliesFeed } from "@/components/anomalies/anomalies-feed";

export default function DashboardPage() {
  return (
    <DashboardShell>
      <div className="mx-auto max-w-6xl space-y-5">
        <div>
          <h1 className="text-xl font-bold">لوحة التدقيق</h1>
          <p className="text-sm text-[rgb(var(--muted))]">
            رصد الحالات الشاذة في القيود والمعاملات المالية لحظياً.
          </p>
        </div>

        <StatCards />
        <FilterBar />
        <AnomaliesFeed />
      </div>
    </DashboardShell>
  );
}
