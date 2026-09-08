import type { Locale } from "./config";
import { shellAr, shellEn } from "./messages/shell";
import { commonAr, commonEn } from "./messages/common";
import { documentsAr, documentsEn } from "./messages/documents";
import { anomaliesAr, anomaliesEn } from "./messages/anomalies";
import { runsAr, runsEn } from "./messages/runs";
import { auditTestsAr, auditTestsEn } from "./messages/auditTests";
import { findingsAr, findingsEn } from "./messages/findings";
import { auditResultsAr, auditResultsEn } from "./messages/auditResults";
import { reconciliationAr, reconciliationEn } from "./messages/reconciliation";
import { analyticsAr, analyticsEn } from "./messages/analytics";
import { auditLogAr, auditLogEn } from "./messages/auditLog";
import { settingsAr, settingsEn } from "./messages/settings";
import { layoutAr, layoutEn } from "./messages/layout";
import { guideAr, guideEn } from "./messages/guide";
import { rulesAr, rulesEn } from "./messages/rules";

/**
 * UI message catalog, aggregated from per-module dictionaries so screens can be
 * translated independently. Arabic is the source of truth; each module's English
 * map mirrors it key-for-key (enforced per module by a Record type).
 *
 * Keys are dotted for grouping only (no nesting). A missing key falls back to the
 * key string itself (see use-t.ts), so an untranslated string is visible.
 */
const ar = {
  ...shellAr,
  ...commonAr,
  ...documentsAr,
  ...anomaliesAr,
  ...runsAr,
  ...auditTestsAr,
  ...findingsAr,
  ...auditResultsAr,
  ...reconciliationAr,
  ...analyticsAr,
  ...auditLogAr,
  ...settingsAr,
  ...layoutAr,
  ...guideAr,
  ...rulesAr,
};

export type MessageKey = keyof typeof ar;

const en: Record<MessageKey, string> = {
  ...shellEn,
  ...commonEn,
  ...documentsEn,
  ...anomaliesEn,
  ...runsEn,
  ...auditTestsEn,
  ...findingsEn,
  ...auditResultsEn,
  ...reconciliationEn,
  ...analyticsEn,
  ...auditLogEn,
  ...settingsEn,
  ...layoutEn,
  ...guideEn,
  ...rulesEn,
};

export const messages: Record<Locale, Record<MessageKey, string>> = { ar, en };
