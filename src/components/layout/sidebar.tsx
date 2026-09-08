"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Route } from "next";
import {
  LayoutDashboard,
  FileText,
  GitCompareArrows,
  ShieldAlert,
  ScrollText,
  BarChart3,
  Settings,
  ShieldCheck,
  Scale,
  Gavel,
  ClipboardList,
  Play,
  FlaskConical,
  BookOpen,
} from "lucide-react";
import { useUIStore } from "@/store/ui-store";
import { useT } from "@/lib/i18n/use-t";
import type { MessageKey } from "@/lib/i18n/messages";

interface NavItem {
  labelKey: MessageKey;
  icon: typeof LayoutDashboard;
  /** Route when the destination exists; omit for not-yet-built sections. */
  href?: Route;
}

const NAV_ITEMS: NavItem[] = [
  { labelKey: "nav.dashboard", icon: LayoutDashboard, href: "/" },
  { labelKey: "nav.documents", icon: FileText, href: "/documents" },
  { labelKey: "nav.reconciliation", icon: GitCompareArrows, href: "/reconciliation" },
  { labelKey: "nav.rules", icon: Scale, href: "/rules" },
  { labelKey: "nav.anomalies", icon: ShieldAlert, href: "/anomalies" },
  { labelKey: "nav.auditTests", icon: FlaskConical, href: "/audit-tests" as Route },
  { labelKey: "nav.runs", icon: Play, href: "/runs" as Route },
  { labelKey: "nav.auditResults", icon: ClipboardList, href: "/audit-results" },
  { labelKey: "nav.findings", icon: Gavel, href: "/findings" },
  { labelKey: "nav.analytics", icon: BarChart3, href: "/analytics" },
  { labelKey: "nav.auditLog", icon: ScrollText, href: "/audit-log" },
  { labelKey: "nav.settings", icon: Settings, href: "/settings" },
  { labelKey: "nav.guide", icon: BookOpen, href: "/guide" as Route },
];

export function Sidebar() {
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);
  const pathname = usePathname();
  const { t } = useT();

  return (
    <aside
      className={`surface hidden shrink-0 border-e transition-[width] duration-200 md:flex md:flex-col print:!hidden ${
        sidebarOpen ? "md:w-64" : "md:w-20"
      }`}
      aria-label={t("nav.primary")}
    >
      <div className="flex h-16 items-center gap-3 border-b px-5 surface">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 text-white">
          <ShieldCheck className="h-5 w-5" />
        </div>
        {sidebarOpen && (
          <div className="leading-tight">
            <p className="text-sm font-bold">{t("brand.name")}</p>
            <p className="text-[11px] text-[rgb(var(--muted))]">
              {t("brand.tagline")}
            </p>
          </div>
        )}
      </div>

      <nav className="flex-1 space-y-1 p-3">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = item.href !== undefined && pathname === item.href;
          const classes = `flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
            active
              ? "bg-brand-50 font-semibold text-brand-700 dark:bg-brand-700/15"
              : "text-[rgb(var(--muted))] hover:bg-black/5 dark:hover:bg-white/5"
          }`;

          if (item.href) {
            return (
              <Link
                key={item.labelKey}
                href={item.href}
                className={classes}
                aria-current={active ? "page" : undefined}
              >
                <Icon className="h-5 w-5 shrink-0" />
                {sidebarOpen && <span>{t(item.labelKey)}</span>}
              </Link>
            );
          }

          return (
            <button
              key={item.labelKey}
              type="button"
              disabled
              className={`${classes} cursor-not-allowed opacity-50`}
              title={t("nav.comingSoon")}
            >
              <Icon className="h-5 w-5 shrink-0" />
              {sidebarOpen && <span>{t(item.labelKey)}</span>}
            </button>
          );
        })}
      </nav>

      {sidebarOpen && (
        <div className="border-t p-4 text-[11px] text-[rgb(var(--muted))]">
          {t("brand.version")}
        </div>
      )}
    </aside>
  );
}
