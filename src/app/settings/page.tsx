import { DashboardShell } from "@/components/layout/dashboard-shell";
import { SettingsView } from "@/components/settings/settings-view";

export default function SettingsPage() {
  return (
    <DashboardShell>
      <div className="mx-auto max-w-4xl space-y-5">
        <div>
          <h1 className="text-xl font-bold">الإعدادات</h1>
          <p className="text-sm text-[rgb(var(--muted))]">
            معلومات المكتب ومعاملات التدقيق الافتراضية.
          </p>
        </div>
        <SettingsView />
      </div>
    </DashboardShell>
  );
}
