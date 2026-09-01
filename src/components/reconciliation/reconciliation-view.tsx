"use client";

import { useQuery } from "@tanstack/react-query";
import { Loader2, ServerCrash, GitCompareArrows } from "lucide-react";
import { useUIStore } from "@/store/ui-store";
import type { ReconciliationResponse } from "@/lib/ui-types";
import { SessionCard } from "./session-card";

async function fetchReconciliation(
  engagementId: string,
): Promise<ReconciliationResponse> {
  const params = new URLSearchParams();
  if (engagementId) params.set("engagementId", engagementId);
  const res = await fetch(`/api/reconciliation?${params.toString()}`);
  if (!res.ok) throw new Error("فشل تحميل جلسات المطابقة");
  return (await res.json()) as ReconciliationResponse;
}

export function ReconciliationView() {
  const engagementId = useUIStore((s) => s.engagementId);
  const { data, isPending, isError } = useQuery({
    queryKey: ["reconciliation", engagementId],
    queryFn: () => fetchReconciliation(engagementId),
  });

  if (isPending) {
    return (
      <div className="surface flex items-center justify-center gap-2 rounded-xl border p-12 text-[rgb(var(--muted))]">
        <Loader2 className="h-5 w-5 animate-spin" />
        جارٍ تحميل جلسات المطابقة...
      </div>
    );
  }

  if (isError) {
    return (
      <div className="surface flex flex-col items-center justify-center gap-2 rounded-xl border p-12 text-severity-critical">
        <ServerCrash className="h-6 w-6" />
        تعذّر تحميل البيانات. حاول مرة أخرى.
      </div>
    );
  }

  if (data.sessions.length === 0) {
    return (
      <div className="surface flex flex-col items-center justify-center gap-2 rounded-xl border p-12 text-[rgb(var(--muted))]">
        <GitCompareArrows className="h-7 w-7" />
        لا توجد جلسات مطابقة لهذه المهمة بعد.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {data.sessions.map((session) => (
        <SessionCard key={session.id} session={session} />
      ))}
    </div>
  );
}
