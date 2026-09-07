import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeading } from "@/components/layout/page-heading";
import { StatCards } from "@/components/anomalies/stat-cards";
import { FilterBar } from "@/components/anomalies/filter-bar";
import { AnomaliesFeed } from "@/components/anomalies/anomalies-feed";
import { ExportButtons } from "@/components/anomalies/export-buttons";

export default function AnomaliesPage() {
  return (
    <DashboardShell>
      <div className="mx-auto max-w-6xl space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <PageHeading titleKey="page.anomalies.title" subtitleKey="page.anomalies.subtitle" />
          <ExportButtons />
        </div>
        <StatCards />
        <FilterBar />
        <AnomaliesFeed />
      </div>
    </DashboardShell>
  );
}
