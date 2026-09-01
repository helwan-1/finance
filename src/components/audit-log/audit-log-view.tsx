"use client";

import { useQuery } from "@tanstack/react-query";
import { Loader2, ServerCrash, ScrollText, Lock } from "lucide-react";
import { useUIStore } from "@/store/ui-store";
import type { AuditLogDTO, AuditLogResponse } from "@/lib/ui-types";
import { AUDIT_ACTION_LABELS_AR } from "@/lib/labels";
import { formatDateTime } from "@/lib/format";

async function fetchAuditLog(engagementId: string): Promise<AuditLogResponse> {
  const params = new URLSearchParams();
  if (engagementId) params.set("engagementId", engagementId);
  const res = await fetch(`/api/audit-log?${params.toString()}`);
  if (!res.ok) throw new Error("فشل تحميل سجل التدقيق");
  return (await res.json()) as AuditLogResponse;
}

export function AuditLogView() {
  const engagementId = useUIStore((s) => s.engagementId);
  const { data, isPending, isError } = useQuery({
    queryKey: ["audit-log", engagementId],
    queryFn: () => fetchAuditLog(engagementId),
  });

  if (isPending) {
    return (
      <div className="surface flex items-center justify-center gap-2 rounded-xl border p-12 text-[rgb(var(--muted))]">
        <Loader2 className="h-5 w-5 animate-spin" />
        جارٍ تحميل سجل التدقيق...
      </div>
    );
  }

  if (isError) {
    return (
      <div className="surface flex flex-col items-center justify-center gap-2 rounded-xl border p-12 text-severity-critical">
        <ServerCrash className="h-6 w-6" />
        تعذّر تحميل البيانات.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs text-[rgb(var(--muted))]">
        <Lock className="h-3.5 w-3.5" />
        سجل غير قابل للتعديل — {data.logs.length} حدث
      </div>

      <ol className="surface overflow-hidden rounded-xl border shadow-card">
        {data.logs.map((log, index) => (
          <LogRow key={log.id} log={log} isLast={index === data.logs.length - 1} />
        ))}
      </ol>
    </div>
  );
}

function LogRow({ log, isLast }: { log: AuditLogDTO; isLast: boolean }) {
  const actionLabel = AUDIT_ACTION_LABELS_AR[log.action] ?? log.action;
  return (
    <li
      className={`flex items-start gap-3 p-4 ${
        isLast ? "" : "border-b border-[rgb(var(--border))]/60"
      }`}
    >
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-black/5 dark:bg-white/5">
        <ScrollText className="h-4 w-4 text-brand-600" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-medium">{actionLabel}</span>
          <span className="text-xs text-[rgb(var(--muted))]">
            · {log.userNameAr}
          </span>
        </div>
        <p className="mt-0.5 text-xs text-[rgb(var(--muted))]">
          {log.entityType}
          {log.entityId ? ` · ${log.entityId}` : ""}
        </p>
        {log.metadata && (
          <pre
            dir="ltr"
            className="mt-2 overflow-x-auto rounded-lg bg-black/5 p-2 text-[11px] text-[rgb(var(--muted))] dark:bg-white/5"
          >
            {JSON.stringify(log.metadata, null, 2)}
          </pre>
        )}
      </div>
      <time className="shrink-0 text-xs text-[rgb(var(--muted))]">
        {formatDateTime(log.createdAt)}
      </time>
    </li>
  );
}
