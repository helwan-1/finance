import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeading } from "@/components/layout/page-heading";
import { ReconciliationView } from "@/components/reconciliation/reconciliation-view";

export default function ReconciliationPage() {
  return (
    <DashboardShell>
      <div className="mx-auto max-w-6xl space-y-5">
        <PageHeading titleKey="page.reconciliation.title" subtitleKey="page.reconciliation.subtitle" />
        <ReconciliationView />
      </div>
    </DashboardShell>
  );
}
