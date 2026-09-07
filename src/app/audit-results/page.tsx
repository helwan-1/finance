import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeading } from "@/components/layout/page-heading";
import { AuditResultsView } from "@/components/audit-results/results-view";

export default function AuditResultsPage() {
  return (
    <DashboardShell>
      <div className="mx-auto max-w-6xl space-y-5">
        <PageHeading titleKey="page.auditResults.title" subtitleKey="page.auditResults.subtitle" />
        <AuditResultsView />
      </div>
    </DashboardShell>
  );
}
