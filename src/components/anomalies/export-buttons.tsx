"use client";

import { useState } from "react";
import { FileSpreadsheet, Printer, Loader2 } from "lucide-react";
import { useUIStore } from "@/store/ui-store";
import type { AnomalyFilters } from "@/lib/ui-types";

function buildExportQuery(
  engagementId: string,
  filters: AnomalyFilters,
): string {
  const params = new URLSearchParams();
  if (engagementId) params.set("engagementId", engagementId);
  if (filters.search) params.set("search", filters.search);
  if (filters.severity !== "ALL") params.set("severity", filters.severity);
  if (filters.ruleCode !== "ALL") params.set("ruleCode", filters.ruleCode);
  if (filters.status !== "ALL") params.set("status", filters.status);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  return params.toString();
}

/** Export the current anomalies view to Excel (.xlsx) or print/PDF. */
export function ExportButtons() {
  const engagementId = useUIStore((s) => s.engagementId);
  const filters = useUIStore((s) => s.filters);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState(false);

  async function exportExcel() {
    setError(false);
    setDownloading(true);
    try {
      const qs = buildExportQuery(engagementId, filters);
      const res = await fetch(`/api/anomalies/export?${qs}`);
      if (!res.ok) {
        setError(true);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `anomalies-${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError(true);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="flex items-center gap-2 print:hidden">
      <button
        type="button"
        onClick={exportExcel}
        disabled={downloading}
        className="surface flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-black/5 disabled:opacity-60 dark:hover:bg-white/5"
      >
        {downloading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <FileSpreadsheet className="h-4 w-4 text-severity-low" />
        )}
        تصدير Excel
      </button>
      <button
        type="button"
        onClick={() => window.print()}
        className="surface flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/5"
      >
        <Printer className="h-4 w-4 text-brand-600" />
        تصدير PDF
      </button>
      {error && (
        <span className="text-xs text-severity-critical">تعذّر التصدير</span>
      )}
    </div>
  );
}
