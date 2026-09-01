"use client";

import { useLiveUpdates } from "@/hooks/use-live-updates";

/**
 * Small "live" badge in the header. Mounting it also activates the SSE
 * subscription for the whole dashboard, so any tab reflects updates in real
 * time. Hidden on print.
 */
export function LiveIndicator() {
  const { connected } = useLiveUpdates();

  return (
    <span
      className="hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium sm:flex print:hidden"
      title={connected ? "التحديثات المباشرة نشطة" : "غير متصل"}
    >
      <span
        className={`h-2 w-2 rounded-full ${
          connected
            ? "animate-pulse bg-severity-low"
            : "bg-[rgb(var(--muted))]"
        }`}
      />
      <span className="text-[rgb(var(--muted))]">
        {connected ? "مباشر" : "غير متصل"}
      </span>
    </span>
  );
}
