import type { FirmSettings } from "./ui-types";

/** Default firm-level audit configuration (KSA conventions). */
export const DEFAULT_FIRM_SETTINGS: FirmSettings = {
  vatRatePct: 15,
  businessStartHour: 7,
  businessEndHour: 19,
  weekendDays: [5, 6], // Friday, Saturday
  timeZone: "Asia/Riyadh",
};

/** Merge stored (partial/unknown) settings over the defaults, safely. */
export function normalizeSettings(raw: unknown): FirmSettings {
  const s = (raw ?? {}) as Partial<Record<keyof FirmSettings, unknown>>;
  const num = (v: unknown, fallback: number): number =>
    typeof v === "number" && Number.isFinite(v) ? v : fallback;
  return {
    vatRatePct: num(s.vatRatePct, DEFAULT_FIRM_SETTINGS.vatRatePct),
    businessStartHour: num(s.businessStartHour, DEFAULT_FIRM_SETTINGS.businessStartHour),
    businessEndHour: num(s.businessEndHour, DEFAULT_FIRM_SETTINGS.businessEndHour),
    weekendDays: Array.isArray(s.weekendDays)
      ? (s.weekendDays.filter((d) => typeof d === "number") as number[])
      : DEFAULT_FIRM_SETTINGS.weekendDays,
    timeZone:
      typeof s.timeZone === "string" && s.timeZone
        ? s.timeZone
        : DEFAULT_FIRM_SETTINGS.timeZone,
  };
}
