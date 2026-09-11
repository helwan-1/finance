"use client";

import { useT } from "./use-t";
import * as L from "@/lib/labels";

/**
 * Locale-aware enum labels. Returns the active language's map for each enum
 * (severity, status, rule code, category, role, document type/status, match
 * status, finding/exception status, matter priority, disposition state/action,
 * audit-action). Badge/color maps stay imported directly from `@/lib/labels`
 * (they are locale-independent).
 *
 * Usage: `const labels = useLabels();` then `labels.severity[value]`.
 */
export function useLabels() {
  const { locale } = useT();
  const en = locale === "en";
  return {
    severity: en ? L.SEVERITY_LABELS_EN : L.SEVERITY_LABELS_AR,
    status: en ? L.STATUS_LABELS_EN : L.STATUS_LABELS_AR,
    rule: en ? L.RULE_LABELS_EN : L.RULE_LABELS_AR,
    matchStatus: en ? L.MATCH_STATUS_LABELS_EN : L.MATCH_STATUS_LABELS_AR,
    ruleCategory: en ? L.RULE_CATEGORY_LABELS_EN : L.RULE_CATEGORY_LABELS_AR,
    role: en ? L.ROLE_LABELS_EN : L.ROLE_LABELS_AR,
    documentType: en ? L.DOCUMENT_TYPE_LABELS_EN : L.DOCUMENT_TYPE_LABELS_AR,
    documentStatus: en ? L.DOCUMENT_STATUS_LABELS_EN : L.DOCUMENT_STATUS_LABELS_AR,
    auditAction: en ? L.AUDIT_ACTION_LABELS_EN : L.AUDIT_ACTION_LABELS_AR,
    exceptionStatus: en ? L.EXCEPTION_STATUS_LABELS_EN : L.EXCEPTION_STATUS_LABELS_AR,
    findingStatus: en ? L.FINDING_STATUS_LABELS_EN : L.FINDING_STATUS_LABELS_AR,
    matterPriority: en ? L.MATTER_PRIORITY_LABELS_EN : L.MATTER_PRIORITY_LABELS_AR,
    dispositionState: en ? L.DISPOSITION_STATE_LABELS_EN : L.DISPOSITION_STATE_LABELS_AR,
    dispositionAction: en ? L.DISPOSITION_ACTION_LABELS_EN : L.DISPOSITION_ACTION_LABELS_AR,
  } as const;
}
