import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeading } from "@/components/layout/page-heading";
import { GuideView } from "@/components/guide/guide-view";

export default function GuidePage() {
  return (
    <DashboardShell>
      <div className="mx-auto max-w-5xl space-y-5">
        <PageHeading titleKey="page.guide.title" subtitleKey="page.guide.subtitle" />
        <GuideView />
      </div>
    </DashboardShell>
  );
}
