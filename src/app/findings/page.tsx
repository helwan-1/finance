import { DashboardShell } from "@/components/layout/dashboard-shell";
import { FindingsView } from "@/components/findings/findings-view";

export default function FindingsPage() {
  return (
    <DashboardShell>
      <div className="mx-auto max-w-6xl space-y-5">
        <div>
          <h1 className="text-xl font-bold">النتائج والأحكام المهنية</h1>
          <p className="text-sm text-[rgb(var(--muted))]">
            إدارة الاستثناءات (المسائل) وتحويلها إلى نتائج تدقيق موثّقة، مع دورة
            إعداد ومراجعة واعتماد.
          </p>
        </div>
        <FindingsView />
      </div>
    </DashboardShell>
  );
}
