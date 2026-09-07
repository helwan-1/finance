import { create } from "zustand";
import type { AnomalyFilters } from "@/lib/ui-types";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/config";

/** Default (empty) filter state for the anomalies feed. */
export const EMPTY_FILTERS: AnomalyFilters = {
  search: "",
  severity: "ALL",
  ruleCode: "ALL",
  status: "ALL",
  from: null,
  to: null,
};

interface UIState {
  /** Currently selected engagement id (multi-tenant scope for all views). */
  engagementId: string;
  sidebarOpen: boolean;
  filters: AnomalyFilters;
  /** UI language. Starts at the default on both server and client (no hydration
   *  mismatch); the persisted choice is applied by the LocaleController effect. */
  locale: Locale;
  setEngagement: (id: string) => void;
  toggleSidebar: () => void;
  setFilters: (patch: Partial<AnomalyFilters>) => void;
  resetFilters: () => void;
  setLocale: (locale: Locale) => void;
}

export const useUIStore = create<UIState>((set) => ({
  // Empty until real engagements load from the DB (see EngagementSwitcher).
  engagementId: "",
  sidebarOpen: true,
  filters: EMPTY_FILTERS,
  locale: DEFAULT_LOCALE,
  setEngagement: (id) => set({ engagementId: id }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setFilters: (patch) => set((s) => ({ filters: { ...s.filters, ...patch } })),
  resetFilters: () => set({ filters: EMPTY_FILTERS }),
  setLocale: (locale) => set({ locale }),
}));
