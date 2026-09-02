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
} from "lucide-react";
import { useUIStore } from "@/store/ui-store";

interface NavItem {
  labelAr: string;
  icon: typeof LayoutDashboard;
  /** Route when the destination exists; omit for not-yet-built sections. */
  href?: Route;
}

const NAV_ITEMS: NavItem[] = [
  { labelAr: "لوحة التحكم", icon: LayoutDashboard, href: "/" },
  { labelAr: "المستندات", icon: FileText, href: "/documents" },
  { labelAr: "المطابقة", icon: GitCompareArrows, href: "/reconciliation" },
  { labelAr: "قواعد التدقيق", icon: Scale, href: "/rules" },
  { labelAr: "الحالات الشاذة", icon: ShieldAlert, href: "/anomalies" },
  { labelAr: "التحليلات", icon: BarChart3, href: "/analytics" },
  { labelAr: "سجل التدقيق", icon: ScrollText, href: "/audit-log" },
  { labelAr: "الإعدادات", icon: Settings, href: "/settings" },
];

export function Sidebar() {
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);
  const pathname = usePathname();

  return (
    <aside
      className={`surface hidden shrink-0 border-l transition-[width] duration-200 md:flex md:flex-col print:!hidden ${
        sidebarOpen ? "md:w-64" : "md:w-20"
      }`}
      aria-label="التنقل الرئيسي"
    >
      <div className="flex h-16 items-center gap-3 border-b px-5 surface">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 text-white">
          <ShieldCheck className="h-5 w-5" />
        </div>
        {sidebarOpen && (
          <div className="leading-tight">
            <p className="text-sm font-bold">مدقق مالي</p>
            <p className="text-[11px] text-[rgb(var(--muted))]">
              لوحة التدقيق الذكية
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
                key={item.labelAr}
                href={item.href}
                className={classes}
                aria-current={active ? "page" : undefined}
              >
                <Icon className="h-5 w-5 shrink-0" />
                {sidebarOpen && <span>{item.labelAr}</span>}
              </Link>
            );
          }

          return (
            <button
              key={item.labelAr}
              type="button"
              disabled
              className={`${classes} cursor-not-allowed opacity-50`}
              title="قريباً"
            >
              <Icon className="h-5 w-5 shrink-0" />
              {sidebarOpen && <span>{item.labelAr}</span>}
            </button>
          );
        })}
      </nav>

      {sidebarOpen && (
        <div className="border-t p-4 text-[11px] text-[rgb(var(--muted))]">
          الإصدار 0.1.0 — نسخة تجريبية (MVP)
        </div>
      )}
    </aside>
  );
}
