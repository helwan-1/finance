import { DashboardShell } from "@/components/layout/dashboard-shell";
import { DocumentsView } from "@/components/documents/documents-view";

export default function DocumentsPage() {
  return (
    <DashboardShell>
      <div className="mx-auto max-w-6xl space-y-5">
        <div>
          <h1 className="text-xl font-bold">المستندات</h1>
          <p className="text-sm text-[rgb(var(--muted))]">
            رفع المستندات المالية وتحليلها آلياً (OCR) لاستخراج الحركات.
          </p>
        </div>
        <DocumentsView />
      </div>
    </DashboardShell>
  );
}
