"use client";

import { Moon, Sun } from "lucide-react";
import { useUIStore } from "@/store/ui-store";

/**
 * Light/dark toggle. Shows a moon while in light mode (tap to go dark) and a sun
 * while in dark mode (tap to go light). The ThemeController persists the choice
 * and applies the `dark` class.
 */
export function ThemeToggle() {
  const theme = useUIStore((s) => s.theme);
  const toggleTheme = useUIStore((s) => s.toggleTheme);
  const dark = theme === "dark";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className="rounded-lg p-2 hover:bg-black/5 dark:hover:bg-white/5"
      aria-label={dark ? "التبديل إلى الوضع الفاتح" : "التبديل إلى الوضع الداكن"}
      title={dark ? "الوضع الفاتح" : "الوضع الداكن"}
    >
      {dark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </button>
  );
}
