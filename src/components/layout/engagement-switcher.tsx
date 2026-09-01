"use client";

import { useState, useRef, useEffect } from "react";
import { Briefcase, ChevronDown, Check } from "lucide-react";
import { useUIStore } from "@/store/ui-store";
import { DEMO_ENGAGEMENTS } from "@/lib/demo-data";

/**
 * Engagement switcher — selecting an engagement changes the tenant scope for
 * every downstream query (multi-tenant isolation by engagementId).
 */
export function EngagementSwitcher() {
  const engagementId = useUIStore((s) => s.engagementId);
  const setEngagement = useUIStore((s) => s.setEngagement);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const current =
    DEMO_ENGAGEMENTS.find((e) => e.id === engagementId) ?? DEMO_ENGAGEMENTS[0];

  useEffect(() => {
    function onClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

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
          {current?.clientNameAr}
        </span>
        <span className="text-[rgb(var(--muted))]">
          — {current?.fiscalYear}
        </span>
        <ChevronDown className="h-4 w-4 text-[rgb(var(--muted))]" />
      </button>

      {open && (
        <ul
          role="listbox"
          className="surface absolute left-0 top-full z-20 mt-2 w-72 overflow-hidden rounded-xl border shadow-card"
        >
          {DEMO_ENGAGEMENTS.map((e) => {
            const selected = e.id === engagementId;
            return (
              <li key={e.id} role="option" aria-selected={selected}>
                <button
                  type="button"
                  onClick={() => {
                    setEngagement(e.id);
                    setOpen(false);
                  }}
                  className="flex w-full items-start gap-2 px-4 py-3 text-right hover:bg-black/5 dark:hover:bg-white/5"
                >
                  <Check
                    className={`mt-0.5 h-4 w-4 shrink-0 ${
                      selected ? "text-brand-600" : "opacity-0"
                    }`}
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">
                      {e.clientNameAr}
                    </span>
                    <span className="block truncate text-xs text-[rgb(var(--muted))]">
                      {e.titleAr}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
