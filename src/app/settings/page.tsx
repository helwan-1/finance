import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeading } from "@/components/layout/page-heading";
import { SettingsView } from "@/components/settings/settings-view";

export default function SettingsPage() {
  return (
    <DashboardShell>
      <div className="mx-auto max-w-4xl space-y-5">
        <PageHeading titleKey="page.settings.title" subtitleKey="page.settings.subtitle" />
        <SettingsView />
      </div>
    </DashboardShell>
  );
}
