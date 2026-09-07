"use client";

import { Languages } from "lucide-react";
import { useT } from "@/lib/i18n/use-t";
import { LOCALE_ENDONYM } from "@/lib/i18n/config";

/**
 * Language toggle (Arabic ⇄ English). Shows the label of the language it will
 * switch TO, so the action is obvious. Direction and persistence are handled by
 * the LocaleController effect.
 */
export function LanguageSwitcher() {
  const { locale, toggleLocale, t } = useT();
  const other = locale === "ar" ? "en" : "ar";

  return (
    <button
      type="button"
      onClick={toggleLocale}
      title={t("lang.switchTo")}
      aria-label={t("lang.switchTo")}
      className="surface flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/5"
    >
      <Languages className="h-4 w-4" />
      <span className="font-medium">{LOCALE_ENDONYM[other]}</span>
    </button>
  );
}
