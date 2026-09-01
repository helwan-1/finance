/**
 * Off-hours and weekend transaction detection.
 *
 * Entries posted outside normal business hours or on the weekend are a common
 * red flag for override of controls. The weekend is configurable to support
 * different regional conventions (default: Friday & Saturday, per KSA).
 */

import type {
  AnalyzableTransaction,
  DetectedAnomaly,
} from "./types";

export interface OffHoursOptions {
  /** First business hour (inclusive), 0-23. Default 7. */
  businessStartHour: number;
  /** Last business hour (exclusive), 0-23. Default 19. */
  businessEndHour: number;
  /** Weekend day indices (0 = Sunday ... 6 = Saturday). Default [5, 6]. */
  weekendDays: readonly number[];
  /** IANA timezone used to interpret postedAt. Default "Asia/Riyadh". */
  timeZone: string;
}

const DEFAULT_OPTIONS: OffHoursOptions = {
  businessStartHour: 7,
  businessEndHour: 19,
  weekendDays: [5, 6], // Friday, Saturday
  timeZone: "Asia/Riyadh",
};

interface ZonedParts {
  hour: number;
  weekday: number; // 0 = Sunday ... 6 = Saturday
}

/**
 * Resolve the wall-clock hour and weekday for an instant in a given timezone,
 * without pulling in a date library. Uses Intl for correctness across DST.
 */
export function zonedParts(iso: string, timeZone: string): ZonedParts {
  const date = new Date(iso);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    hour12: false,
    weekday: "short",
  });
  const parts = formatter.formatToParts(date);
  const hourPart = parts.find((p) => p.type === "hour")?.value ?? "0";
  const weekdayPart = parts.find((p) => p.type === "weekday")?.value ?? "Sun";

  // "24" is emitted for midnight by some engines; normalize to 0.
  const hour = Number.parseInt(hourPart, 10) % 24;
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const weekday = weekdayMap[weekdayPart] ?? 0;
  return { hour, weekday };
}

export function detectOffHours(
  transactions: readonly AnalyzableTransaction[],
  options: Partial<OffHoursOptions> = {},
): DetectedAnomaly[] {
  const opts: OffHoursOptions = { ...DEFAULT_OPTIONS, ...options };
  const weekend = new Set(opts.weekendDays);
  const anomalies: DetectedAnomaly[] = [];

  for (const txn of transactions) {
    const { hour, weekday } = zonedParts(txn.postedAt, opts.timeZone);
    const isWeekend = weekend.has(weekday);
    const isOffHours =
      hour < opts.businessStartHour || hour >= opts.businessEndHour;

    if (isWeekend) {
      anomalies.push({
        ruleCode: "WEEKEND_ENTRY",
        severity: "LOW",
        score: 45,
        title: "Weekend entry",
        titleAr: "قيد في عطلة نهاية الأسبوع",
        description: `Transaction ${txn.reference} was posted on a weekend day.`,
        descriptionAr: `تم تسجيل المعاملة ${txn.reference} في يوم عطلة نهاية الأسبوع.`,
        transactionIds: [txn.id],
        evidence: { postedAt: txn.postedAt, weekday, timeZone: opts.timeZone },
      });
    }

    // Off-hours on a weekday is a separate, slightly stronger signal.
    if (isOffHours && !isWeekend) {
      anomalies.push({
        ruleCode: "OFF_HOURS_ENTRY",
        severity: "MEDIUM",
        score: 55,
        title: "Off-hours entry",
        titleAr: "قيد خارج ساعات العمل",
        description: `Transaction ${txn.reference} was posted at ${hour
          .toString()
          .padStart(2, "0")}:00, outside business hours (${opts.businessStartHour}:00–${opts.businessEndHour}:00).`,
        descriptionAr: `تم تسجيل المعاملة ${txn.reference} الساعة ${hour
          .toString()
          .padStart(2, "0")}:00، خارج ساعات العمل (${opts.businessStartHour}:00–${opts.businessEndHour}:00).`,
        transactionIds: [txn.id],
        evidence: {
          postedAt: txn.postedAt,
          hour,
          businessStartHour: opts.businessStartHour,
          businessEndHour: opts.businessEndHour,
          timeZone: opts.timeZone,
        },
      });
    }
  }

  return anomalies;
}
