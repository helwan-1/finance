import { DashboardShell } from "@/components/layout/dashboard-shell";
import { AuditTestsView } from "@/components/audit-tests/audit-tests-view";

export default function AuditTestsPage() {
  return (
    <DashboardShell>
      <div className="mx-auto max-w-4xl space-y-5">
        <div>
          <h1 className="text-xl font-bold">اختبارات التدقيق</h1>
          <p className="text-sm text-[rgb(var(--muted))]">
            أنشئ اختبارات التدقيق التي يطبّقها المحرّك على البيانات المستوردة، وفعّلها لتصبح
            متاحة للاختيار عند تجهيز نطاق الفحص في عملية التدقيق.
          </p>
        </div>
        <AuditTestsView />
      </div>
    </DashboardShell>
  );
}
