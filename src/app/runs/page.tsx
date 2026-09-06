import { DashboardShell } from "@/components/layout/dashboard-shell";
import { RunsView } from "@/components/runs/runs-view";

export default function RunsPage() {
  return (
    <DashboardShell>
      <div className="mx-auto max-w-4xl space-y-5">
        <div>
          <h1 className="text-xl font-bold">عمليات التدقيق</h1>
          <p className="text-sm text-[rgb(var(--muted))]">
            أنشئ عملية تدقيق، اختر مجموعات البيانات والاختبارات، ابدأ الإعداد، ثم انشر
            لتجميد التدقيق وإدراجه للتنفيذ في الخلفية، وراجع النتائج.
          </p>
        </div>
        <RunsView />
      </div>
    </DashboardShell>
  );
}
