import { DashboardShell } from "@/components/layout/dashboard-shell";
import { AnalyticsView } from "@/components/analytics/analytics-view";

export default function AnalyticsPage() {
  return (
    <DashboardShell>
      <div className="mx-auto max-w-5xl space-y-5">
        <div>
          <h1 className="text-xl font-bold">التحليلات</h1>
          <p className="text-sm text-[rgb(var(--muted))]">
            تحليل قانون بنفورد لتوزيع الأرقام الأولى في قيم المعاملات.
          </p>
        </div>
        <AnalyticsView />
      </div>
    </DashboardShell>
  );
}
