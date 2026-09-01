import { DashboardShell } from "@/components/layout/dashboard-shell";
import { AuditLogView } from "@/components/audit-log/audit-log-view";

export default function AuditLogPage() {
  return (
    <DashboardShell>
      <div className="mx-auto max-w-4xl space-y-5">
        <div>
          <h1 className="text-xl font-bold">سجل التدقيق</h1>
          <p className="text-sm text-[rgb(var(--muted))]">
            سجل زمني غير قابل للتعديل لكل إجراءات المستخدمين على المهمة.
          </p>
        </div>
        <AuditLogView />
      </div>
    </DashboardShell>
  );
}
