"use client";

import { useEffect } from "react";
import { useUIStore } from "@/store/ui-store";
import { DIRECTION, LOCALE_STORAGE_KEY, isLocale } from "@/lib/i18n/config";

/**
 * Applies the viewer's chosen UI language to the document and persists it.
 *
 * Rendered once in the app shell. On mount it reads the persisted locale and
 * applies it to the store (server + first client render both start at the default,
 * so there is no hydration mismatch). On every locale change it writes the choice
 * to localStorage and updates <html dir/lang>. A tiny inline script in <head>
 * (see layout.tsx) sets dir/lang before paint so there is no flash for returning
 * English users.
 */
export function LocaleController() {
  const locale = useUIStore((s) => s.locale);
  const setLocale = useUIStore((s) => s.setLocale);

  // Hydrate the persisted choice once.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(LOCALE_STORAGE_KEY);
      if (isLocale(saved)) setLocale(saved);
    } catch {
      /* storage unavailable — keep the default */
    }
  }, [setLocale]);

  // Reflect the active locale onto the document and persist it.
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("lang", locale);
    root.setAttribute("dir", DIRECTION[locale]);
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    } catch {
      /* storage unavailable — direction still applied for this session */
    }
  }, [locale]);

  return null;
}

/** Inline script (runs before hydration) that applies the saved dir/lang, avoiding a flash. */
export const LOCALE_NO_FLASH_SCRIPT = `(function(){try{var l=localStorage.getItem(${JSON.stringify(
  LOCALE_STORAGE_KEY,
)});if(l==='en'||l==='ar'){var d=document.documentElement;d.setAttribute('lang',l);d.setAttribute('dir',l==='en'?'ltr':'rtl');}}catch(e){}})();`;
