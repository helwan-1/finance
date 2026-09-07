import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeading } from "@/components/layout/page-heading";
import { AuditLogView } from "@/components/audit-log/audit-log-view";

export default function AuditLogPage() {
  return (
    <DashboardShell>
      <div className="mx-auto max-w-4xl space-y-5">
        <PageHeading titleKey="page.auditLog.title" subtitleKey="page.auditLog.subtitle" />
        <AuditLogView />
      </div>
    </DashboardShell>
  );
}
