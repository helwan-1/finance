import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeading } from "@/components/layout/page-heading";
import { AnalyticsView } from "@/components/analytics/analytics-view";

export default function AnalyticsPage() {
  return (
    <DashboardShell>
      <div className="mx-auto max-w-5xl space-y-5">
        <PageHeading titleKey="page.analytics.title" subtitleKey="page.analytics.subtitle" />
        <AnalyticsView />
      </div>
    </DashboardShell>
  );
}
