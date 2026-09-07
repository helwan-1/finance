import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeading } from "@/components/layout/page-heading";
import { RulesView } from "@/components/rules/rules-view";

export default function RulesPage() {
  return (
    <DashboardShell>
      <div className="mx-auto max-w-5xl space-y-5">
        <PageHeading titleKey="page.rules.title" subtitleKey="page.rules.subtitle" />
        <RulesView />
      </div>
    </DashboardShell>
  );
}
