import { DashboardShell } from "@/components/layout/dashboard-shell";
import { ReconciliationView } from "@/components/reconciliation/reconciliation-view";

export default function ReconciliationPage() {
  return (
    <DashboardShell>
      <div className="mx-auto max-w-6xl space-y-5">
        <div>
          <h1 className="text-xl font-bold">المطابقة</h1>
          <p className="text-sm text-[rgb(var(--muted))]">
            مطابقة الحركات البنكية مع قيود دفتر الأستاذ وإبراز غير المطابَق.
          </p>
        </div>
        <ReconciliationView />
      </div>
    </DashboardShell>
  );
}
