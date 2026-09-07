"use client";

import { useCallback } from "react";
import { useUIStore } from "@/store/ui-store";
import { DIRECTION, type Locale } from "./config";
import { messages, type MessageKey } from "./messages";

/**
 * Translation hook. `t(key, vars?)` returns the string for the active locale,
 * with `{name}`-style placeholders substituted. An unknown key falls back to the
 * key itself so gaps are visible, not blank. Also exposes the active locale, its
 * direction, and setter helpers.
 */
export function useT() {
  const locale = useUIStore((s) => s.locale);
  const setLocale = useUIStore((s) => s.setLocale);

  const t = useCallback(
    (key: MessageKey, vars?: Record<string, string | number>): string => {
      const table = messages[locale] ?? messages.ar;
      let out = table[key] ?? key;
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          out = out.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
        }
      }
      return out;
    },
    [locale],
  );

  const toggleLocale = useCallback(() => {
    setLocale(locale === "ar" ? "en" : "ar");
  }, [locale, setLocale]);

  return {
    t,
    locale,
    dir: DIRECTION[locale],
    setLocale: setLocale as (l: Locale) => void,
    toggleLocale,
  };
}
