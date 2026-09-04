import { DashboardShell } from "@/components/layout/dashboard-shell";
import { AuditResultsView } from "@/components/audit-results/results-view";

export default function AuditResultsPage() {
  return (
    <DashboardShell>
      <div className="mx-auto max-w-6xl space-y-5">
        <div>
          <h1 className="text-xl font-bold">نتائج التدقيق</h1>
          <p className="text-sm text-[rgb(var(--muted))]">
            نتائج محرّك التدقيق (G4) مع حالتها المهنية — سجّل حكمًا على أي نتيجة أو
            حوّلها إلى استثناء (مسألة) مباشرةً.
          </p>
        </div>
        <AuditResultsView />
      </div>
    </DashboardShell>
  );
}
