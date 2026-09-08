"use client";

import { useEffect, useRef } from "react";
import { useUIStore } from "@/store/ui-store";

export const THEME_STORAGE_KEY = "sarat-theme";

/**
 * Applies the viewer's light/dark choice to the document and persists it.
 *
 * Rendered once in the app shell. On mount it reads the resolved theme (the
 * no-flash script has already put the right value on <html>) into the store, so
 * the toggle icon matches. On every change it toggles the `dark` class and
 * persists the choice. Server + first client render both start at "light" (no
 * hydration mismatch); the effect immediately reconciles with the real value.
 */
export function ThemeController() {
  const theme = useUIStore((s) => s.theme);
  const setTheme = useUIStore((s) => s.setTheme);
  // Skip the reflect effect for the initial render: at that point `theme` is
  // still the default "light" (the no-flash script has already set the real
  // class on <html>). Writing it back here would flip a dark page to light
  // before the hydrate effect syncs the store. We only reflect real changes.
  const first = useRef(true);

  // Hydrate the store from what the no-flash script resolved onto <html>, so the
  // toggle icon matches the actual theme.
  useEffect(() => {
    const isDark = document.documentElement.classList.contains("dark");
    setTheme(isDark ? "dark" : "light");
  }, [setTheme]);

  // Reflect subsequent theme changes onto the document and persist them.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    document.documentElement.classList.toggle("dark", theme === "dark");
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      /* storage unavailable — class still applied for this session */
    }
  }, [theme]);

  return null;
}

/**
 * Inline script (runs before paint) that resolves the theme into the `dark`
 * class: the saved choice if any, otherwise the OS preference. Keeps the CSS
 * tokens and Tailwind's class-based `dark:` utilities in sync from the first
 * frame, with no flash for returning dark-mode users.
 */
export const THEME_NO_FLASH_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});var d=t?t==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.classList.toggle('dark',d);}catch(e){}})();`;
