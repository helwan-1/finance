import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeading } from "@/components/layout/page-heading";
import { RunsView } from "@/components/runs/runs-view";

export default function RunsPage() {
  return (
    <DashboardShell>
      <div className="mx-auto max-w-4xl space-y-5">
        <PageHeading titleKey="page.runs.title" subtitleKey="page.runs.subtitle" />
        <RunsView />
      </div>
    </DashboardShell>
  );
}
