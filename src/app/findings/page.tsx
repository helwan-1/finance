import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeading } from "@/components/layout/page-heading";
import { FindingsView } from "@/components/findings/findings-view";

export default function FindingsPage() {
  return (
    <DashboardShell>
      <div className="mx-auto max-w-6xl space-y-5">
        <PageHeading titleKey="page.findings.title" subtitleKey="page.findings.subtitle" />
        <FindingsView />
      </div>
    </DashboardShell>
  );
}
