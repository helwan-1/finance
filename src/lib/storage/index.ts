import type { StorageAdapter } from "./types";
import { LocalFsStorageAdapter } from "./local-fs";
import { isProduction } from "@/lib/security/env";

export type { StorageAdapter, StoredObjectStat } from "./types";

/**
 * Resolve the configured storage adapter. Provider selection is operational
 * (ADR-012): the domain records `storageProvider = OBJECT_STORE` + bucket/key,
 * never a vendor. Default is the filesystem adapter (works locally and in
 * Private Mode). An S3-compatible adapter can be added here without touching
 * the domain, schema, or call sites.
 */
let cached: StorageAdapter | null = null;

/**
 * Durability guard (pure, testable): RETAINED custody must not rest on an
 * ephemeral root. In production a persistent, absolute, non-/tmp directory is
 * required; a missing or ephemeral root throws so no false-RETAINED SourceFile
 * is ever created (fail-closed). Dev/test may use /tmp.
 */
export function validateStorageRoot(root: string | undefined, production: boolean): void {
  if (!production) return;
  if (!root || !root.startsWith("/") || root.startsWith("/tmp")) {
    throw new Error(
      "STORAGE_LOCAL_DIR must be an absolute, persistent (non-/tmp) path in production; refusing ephemeral custody.",
    );
  }
}

export function getStorageAdapter(): StorageAdapter {
  if (cached) return cached;
  const kind = process.env.STORAGE_PROVIDER ?? "local-fs";
  switch (kind) {
    case "local-fs":
    default: {
      const root = process.env.STORAGE_LOCAL_DIR;
      validateStorageRoot(root, isProduction());
      cached = new LocalFsStorageAdapter(root);
      break;
    }
  }
  return cached;
}

/** Tenant-scoped bucket name for a firm's source artifacts. */
export function firmBucket(auditFirmId: string): string {
  return `firm-${auditFirmId}`;
}
