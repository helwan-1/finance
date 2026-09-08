/** auditLog message dictionary. Arabic source of truth; English mirrors key-for-key. */
export const auditLogAr = {
  "auditLog.loading": "جارٍ تحميل سجل التدقيق...",
  "auditLog.error.generic": "تعذّر تحميل البيانات.",
  "auditLog.immutable": "سجل غير قابل للتعديل — {count} حدث",
} as const;

export const auditLogEn: Record<keyof typeof auditLogAr, string> = {
  "auditLog.loading": "Loading the audit log...",
  "auditLog.error.generic": "Could not load the data.",
  "auditLog.immutable": "Immutable log — {count} events",
};
