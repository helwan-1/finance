/**
 * Arabic-first formatting helpers. Currency in ر.س, dates in ar-SA locale.
 */

const AR_LOCALE = "ar-SA";

/** Format a decimal string amount as SAR currency for display. */
export function formatCurrency(amount: string, currency = "SAR"): string {
  const value = Number.parseFloat(amount);
  // Display-only: parsing to Number here is acceptable (never used for math).
  const formatted = new Intl.NumberFormat(AR_LOCALE, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);
  return formatted;
}

/** Format an ISO timestamp as a full Arabic date + time. */
export function formatDateTime(iso: string | Date): string {
  const date = typeof iso === "string" ? new Date(iso) : iso;
  return new Intl.DateTimeFormat(AR_LOCALE, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

/** Format an ISO timestamp as an Arabic date (no time). */
export function formatDate(iso: string | Date): string {
  const date = typeof iso === "string" ? new Date(iso) : iso;
  return new Intl.DateTimeFormat(AR_LOCALE, { dateStyle: "medium" }).format(
    date,
  );
}

/** Format a byte count in Arabic-friendly units. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} بايت`;
  const units = ["ك.ب", "م.ب", "غ.ب"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

/** Relative "منذ ..." style label for recent timestamps. */
export function formatRelative(iso: string | Date): string {
  const date = typeof iso === "string" ? new Date(iso) : iso;
  const diffMs = date.getTime() - Date.now();
  const rtf = new Intl.RelativeTimeFormat(AR_LOCALE, { numeric: "auto" });
  const minutes = Math.round(diffMs / 60000);
  const abs = Math.abs(minutes);
  if (abs < 60) return rtf.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return rtf.format(hours, "hour");
  const days = Math.round(hours / 24);
  return rtf.format(days, "day");
}
