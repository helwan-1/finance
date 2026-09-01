import { DashboardShell } from "@/components/layout/dashboard-shell";
import { RulesView } from "@/components/rules/rules-view";

export default function RulesPage() {
  return (
    <DashboardShell>
      <div className="mx-auto max-w-5xl space-y-5">
        <div>
          <h1 className="text-xl font-bold">قواعد التدقيق</h1>
          <p className="text-sm text-[rgb(var(--muted))]">
            محرّك قواعد حتمي: عرّف القوانين والإجراءات، ثم شغّل التدقيق لتطبيقها
            على المعاملات — بدون ذكاء اصطناعي، وكل نتيجة قابلة للتفسير.
          </p>
        </div>
        <RulesView />
      </div>
    </DashboardShell>
  );
}
