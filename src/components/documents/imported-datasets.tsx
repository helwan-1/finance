"use client";

import { useQuery } from "@tanstack/react-query";
import { Database, Loader2 } from "lucide-react";
import { useUIStore } from "@/store/ui-store";

interface DatasetOption { id: string; kind: string; status: string; datasetHash: string | null; createdAt: string }

const KIND_LABEL_AR: Record<string, string> = {
  GENERAL_LEDGER: "دفتر الأستاذ",
  TRIAL_BALANCE: "ميزان المراجعة",
  BANK: "كشف بنكي",
  OTHER: "أخرى",
};
const STATUS_LABEL_AR: Record<string, string> = {
  COMPLETED: "مكتملة",
  COMPLETED_WITH_ISSUES: "مكتملة مع ملاحظات",
};

async function fetchDatasets(engagementId: string): Promise<{ datasets: DatasetOption[] }> {
  const res = await fetch(`/api/datasets?engagementId=${encodeURIComponent(engagementId)}`);
  if (!res.ok) throw new Error("فشل تحميل البيانات المستوردة");
  return (await res.json()) as { datasets: DatasetOption[] };
}

function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat("ar", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/**
 * Imported datasets for the current engagement. CSV import creates a Dataset
 * (not a "document"), so this list is where the auditor confirms an import was
 * saved — separate from the OCR documents count above. Refetches on the shared
 * ["datasets"] key that the import invalidates, so it updates right after import.
 */
export function ImportedDatasets() {
  const engagementId = useUIStore((s) => s.engagementId);
  const { data, isPending } = useQuery({
    queryKey: ["datasets", engagementId],
    queryFn: () => fetchDatasets(engagementId),
    enabled: Boolean(engagementId),
  });
  const datasets = data?.datasets ?? [];

  return (
    <div className="surface rounded-xl border p-4">
      <div className="mb-3 flex items-center gap-2">
        <Database className="h-4 w-4 text-brand-600" />
        <h2 className="font-semibold">البيانات المستوردة</h2>
        <span className="rounded-full border px-2 py-0.5 text-xs text-[rgb(var(--muted))]">{datasets.length}</span>
      </div>

      {isPending ? (
        <p className="flex items-center gap-2 text-sm text-[rgb(var(--muted))]">
          <Loader2 className="h-4 w-4 animate-spin" /> جارٍ التحميل…
        </p>
      ) : datasets.length === 0 ? (
        <p className="text-sm text-[rgb(var(--muted))]">
          لا توجد بيانات مستوردة بعد. استخدم «استيراد معاملات (CSV)» أعلاه لإنشاء أول مجموعة.
        </p>
      ) : (
        <ul className="divide-y">
          {datasets.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <span className="flex items-center gap-2">
                <span className="font-medium">{KIND_LABEL_AR[d.kind] ?? d.kind}</span>
                {d.datasetHash && (
                  <span className="rounded bg-black/5 px-1.5 py-0.5 font-mono text-[11px] dark:bg-white/5" title={d.datasetHash}>
                    {d.datasetHash.slice(0, 10)}
                  </span>
                )}
              </span>
              <span className="flex items-center gap-3 text-xs text-[rgb(var(--muted))]">
                <span className="rounded-full border px-2 py-0.5">{STATUS_LABEL_AR[d.status] ?? d.status}</span>
                <span>{formatDate(d.createdAt)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
