import type { UserRole } from "@prisma/client";

/**
 * Role-based access control matrix.
 *
 * Permissions are coarse-grained capabilities checked in API routes and the UI.
 * The tenant boundary (firm/engagement isolation) is enforced separately in the
 * guards — RBAC governs *what* an authenticated user may do within their firm.
 */
export type Permission =
  | "documents:view"
  | "documents:upload"
  | "anomalies:view"
  | "anomalies:resolve"
  | "reconciliation:view"
  | "reconciliation:run"
  | "analytics:view"
  | "auditlog:view"
  | "data:export"
  | "engagement:manage";

const ALL: Permission[] = [
  "documents:view",
  "documents:upload",
  "anomalies:view",
  "anomalies:resolve",
  "reconciliation:view",
  "reconciliation:run",
  "analytics:view",
  "auditlog:view",
  "data:export",
  "engagement:manage",
];

const READ_ONLY: Permission[] = [
  "documents:view",
  "anomalies:view",
  "reconciliation:view",
  "analytics:view",
  "auditlog:view",
];

const FIELD_WORK: Permission[] = [
  ...READ_ONLY,
  "documents:upload",
  "anomalies:resolve",
  "reconciliation:run",
  "data:export",
];

export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  ADMIN: ALL,
  PARTNER: ALL,
  MANAGER: [...FIELD_WORK, "engagement:manage"],
  SENIOR: FIELD_WORK,
  STAFF: [
    "documents:view",
    "documents:upload",
    "anomalies:view",
    "reconciliation:view",
    "analytics:view",
  ],
  REVIEWER: READ_ONLY,
};

/** Whether a role holds a given permission. */
export function can(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
