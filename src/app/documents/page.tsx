import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeading } from "@/components/layout/page-heading";
import { DocumentsView } from "@/components/documents/documents-view";

export default function DocumentsPage() {
  return (
    <DashboardShell>
      <div className="mx-auto max-w-6xl space-y-5">
        <PageHeading titleKey="page.documents.title" subtitleKey="page.documents.subtitle" />
        <DocumentsView />
      </div>
    </DashboardShell>
  );
}
