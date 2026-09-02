"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Briefcase, ChevronDown, Check, Plus, Loader2 } from "lucide-react";
import { useUIStore } from "@/store/ui-store";
import type { EngagementSummary } from "@/lib/ui-types";

interface EngagementsResponse {
  engagements: EngagementSummary[];
}

async function fetchEngagements(): Promise<EngagementsResponse> {
  const res = await fetch("/api/engagements");
  if (!res.ok) throw new Error("failed");
  return (await res.json()) as EngagementsResponse;
}

/**
 * Engagement switcher — loads the caller's real engagements from the DB and
 * scopes every downstream query to the selected one (multi-tenant isolation).
 */
export function EngagementSwitcher() {
  const engagementId = useUIStore((s) => s.engagementId);
  const setEngagement = useUIStore((s) => s.setEngagement);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  const { data } = useQuery({ queryKey: ["engagements"], queryFn: fetchEngagements });
  const engagements = useMemo(() => data?.engagements ?? [], [data]);

  // Auto-select the first engagement once loaded (if none chosen yet).
  useEffect(() => {
    if (!engagementId && engagements.length > 0) {
      setEngagement(engagements[0]!.id);
    }
  }, [engagementId, engagements, setEngagement]);

  useEffect(() => {
    function onClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const current =
    engagements.find((e) => e.id === engagementId) ?? engagements[0];

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="surface flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/5"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <Briefcase className="h-4 w-4 text-brand-600" />
        <span className="max-w-[220px] truncate font-medium">
          {current?.clientNameAr ?? "لا توجد مهام"}
        </span>
        {current && (
          <span className="text-[rgb(var(--muted))]">— {current.fiscalYear}</span>
        )}
        <ChevronDown className="h-4 w-4 text-[rgb(var(--muted))]" />
      </button>

      {open && (
        <div className="surface absolute left-0 top-full z-20 mt-2 w-72 overflow-hidden rounded-xl border shadow-card">
          <ul role="listbox" className="max-h-72 overflow-y-auto">
            {engagements.map((e) => {
              const selected = e.id === engagementId;
              return (
                <li key={e.id} role="option" aria-selected={selected}>
                  <button
                    type="button"
                    onClick={() => { setEngagement(e.id); setOpen(false); }}
                    className="flex w-full items-start gap-2 px-4 py-3 text-right hover:bg-black/5 dark:hover:bg-white/5"
                  >
                    <Check className={`mt-0.5 h-4 w-4 shrink-0 ${selected ? "text-brand-600" : "opacity-0"}`} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{e.clientNameAr}</span>
                      <span className="block truncate text-xs text-[rgb(var(--muted))]">{e.titleAr}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="border-t p-2">
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-brand-700 hover:bg-brand-50 dark:hover:bg-brand-700/15"
            >
              <Plus className="h-4 w-4" />
              مهمة تدقيق جديدة
            </button>
          </div>
        </div>
      )}

      {creating && (
        <NewEngagementDialog
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            void queryClient.invalidateQueries({ queryKey: ["engagements"] });
            setEngagement(id);
            setCreating(false);
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}

function NewEngagementDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [clientNameAr, setClientNameAr] = useState("");
  const [titleAr, setTitleAr] = useState("");
  const [fiscalYear, setFiscalYear] = useState(String(new Date().getFullYear()));
  const input = "surface w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500/40";

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/engagements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientNameAr,
          titleAr,
          fiscalYear: Number.parseInt(fiscalYear, 10),
        }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(d.error ?? "فشل الإنشاء");
      }
      return (await res.json()) as { engagement: EngagementSummary };
    },
    onSuccess: (r) => onCreated(r.engagement.id),
  });

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4" onMouseDown={onClose}>
      <form
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); mutation.mutate(); }}
        className="surface w-full max-w-md space-y-4 rounded-2xl border p-5 shadow-card"
      >
        <h3 className="font-semibold">مهمة تدقيق جديدة</h3>
        <label className="block space-y-1 text-sm">
          <span className="text-[rgb(var(--muted))]">اسم العميل</span>
          <input className={input} value={clientNameAr} onChange={(e) => setClientNameAr(e.target.value)} required placeholder="شركة ..." />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="text-[rgb(var(--muted))]">عنوان المهمة</span>
          <input className={input} value={titleAr} onChange={(e) => setTitleAr(e.target.value)} required placeholder="المراجعة النظامية 2026" />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="text-[rgb(var(--muted))]">السنة المالية</span>
          <input className={input} type="number" value={fiscalYear} onChange={(e) => setFiscalYear(e.target.value)} required />
        </label>
        {mutation.isError && <p className="text-sm text-severity-critical">{(mutation.error as Error).message}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border px-4 py-2 text-sm">إلغاء</button>
          <button type="submit" disabled={mutation.isPending} className="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60">
            {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            إنشاء
          </button>
        </div>
      </form>
    </div>
  );
}
