import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeading } from "@/components/layout/page-heading";
import { AuditTestsView } from "@/components/audit-tests/audit-tests-view";

export default function AuditTestsPage() {
  return (
    <DashboardShell>
      <div className="mx-auto max-w-4xl space-y-5">
        <PageHeading titleKey="page.auditTests.title" subtitleKey="page.auditTests.subtitle" />
        <AuditTestsView />
      </div>
    </DashboardShell>
  );
}
