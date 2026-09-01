import type { AuditLogDTO } from "./ui-types";

/** In-memory demo audit trail; API fallback when no database is provisioned. */
export const DEMO_AUDIT_LOGS: AuditLogDTO[] = [
  {
    id: "log-1",
    action: "RUN_ANALYSIS",
    entityType: "AuditEngagement",
    entityId: "eng-nakheel-2025",
    userNameAr: "سارة الحربي",
    createdAt: "2026-08-30T08:15:00Z",
    metadata: { findings: 12 },
  },
  {
    id: "log-2",
    action: "RUN_RECONCILIATION",
    entityType: "ReconciliationSession",
    entityId: "recon-nakheel-2025",
    userNameAr: "سارة الحربي",
    createdAt: "2026-08-30T08:20:00Z",
    metadata: { matched: 7, unmatched: 1 },
  },
  {
    id: "log-3",
    action: "RESOLVE_ANOMALY",
    entityType: "AnomalyFlag",
    entityId: "an-005",
    userNameAr: "خالد العتيبي",
    createdAt: "2026-08-30T09:05:00Z",
    metadata: { note: "تمت مراجعة القيد واعتماده" },
  },
  {
    id: "log-4",
    action: "VIEW_DOCUMENT",
    entityType: "Document",
    entityId: "doc-bank-q3",
    userNameAr: "خالد العتيبي",
    createdAt: "2026-08-30T09:12:00Z",
    metadata: null,
  },
  {
    id: "log-5",
    action: "EXPORT_DATA",
    entityType: "AnomalyFlag",
    entityId: null,
    userNameAr: "سارة الحربي",
    createdAt: "2026-08-30T09:40:00Z",
    metadata: { format: "xlsx", rows: 12, filters: { severity: "CRITICAL" } },
  },
  {
    id: "log-6",
    action: "ESCALATE_ANOMALY",
    entityType: "AnomalyFlag",
    entityId: "an-006",
    userNameAr: "خالد العتيبي",
    createdAt: "2026-08-30T10:02:00Z",
    metadata: { to: "شريك المراجعة" },
  },
];
