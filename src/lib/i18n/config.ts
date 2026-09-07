/**
 * i18n core config. Dependency-free, Arabic-first: Arabic is the default locale
 * and RTL is the default direction. Adding a language is: extend `LOCALES`, add a
 * column to every entry in `messages`, and (if RTL) map its direction here.
 */
export type Locale = "ar" | "en";

export const LOCALES: Locale[] = ["ar", "en"];
export const DEFAULT_LOCALE: Locale = "ar";

/** Writing direction per locale. */
export const DIRECTION: Record<Locale, "rtl" | "ltr"> = {
  ar: "rtl",
  en: "ltr",
};

/** The locale's own endonym (shown in the switcher). */
export const LOCALE_ENDONYM: Record<Locale, string> = {
  ar: "عربي",
  en: "English",
};

/** localStorage key holding the viewer's chosen locale. */
export const LOCALE_STORAGE_KEY = "sarat.locale";

export function isLocale(v: unknown): v is Locale {
  return v === "ar" || v === "en";
}
