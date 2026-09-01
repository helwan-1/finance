"use client";

import { Menu, Bell, Search } from "lucide-react";
import { useUIStore } from "@/store/ui-store";
import { EngagementSwitcher } from "./engagement-switcher";
import { UserMenu } from "@/components/auth/user-menu";
import { LiveIndicator } from "./live-indicator";

export function Header() {
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);

  return (
    <header className="surface sticky top-0 z-10 flex h-16 items-center justify-between gap-4 border-b px-4 md:px-6 print:hidden">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={toggleSidebar}
          className="rounded-lg p-2 hover:bg-black/5 dark:hover:bg-white/5"
          aria-label="تبديل القائمة الجانبية"
        >
          <Menu className="h-5 w-5" />
        </button>
        <EngagementSwitcher />
      </div>

      <div className="flex items-center gap-2">
        <LiveIndicator />
        <div className="relative hidden sm:block">
          <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[rgb(var(--muted))]" />
          <input
            type="search"
            placeholder="بحث سريع..."
            className="surface w-56 rounded-lg border py-2 pr-9 pl-3 text-sm outline-none focus:ring-2 focus:ring-brand-500/40"
          />
        </div>
        <button
          type="button"
          className="relative rounded-lg p-2 hover:bg-black/5 dark:hover:bg-white/5"
          aria-label="الإشعارات"
        >
          <Bell className="h-5 w-5" />
          <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-severity-critical" />
        </button>
        <UserMenu />
      </div>
    </header>
  );
}
