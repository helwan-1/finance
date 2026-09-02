import { promises as fs } from "node:fs";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { StorageAdapter, StoredObjectStat } from "./types";

/**
 * Filesystem-backed, content-addressed object store — a working adapter for the
 * current deployment/test environment and for Private Audit Mode (no egress).
 * Objects live under a root dir; the objectKey is content-addressed (the file
 * SHA-256), so identical bytes map to one physical object (C2 physical dedup)
 * without collapsing distinct SourceFile provenance rows. Writes are atomic
 * (temp file + rename).
 */
export class LocalFsStorageAdapter implements StorageAdapter {
  readonly provider = "local-fs";
  private readonly root: string;

  constructor(root?: string) {
    this.root =
      root ?? process.env.STORAGE_LOCAL_DIR ?? "/tmp/sarat-object-store";
  }

  private path(bucket: string, objectKey: string): string {
    // Guard against traversal in the key segments.
    const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]/g, "_");
    return join(this.root, safe(bucket), safe(objectKey));
  }

  async put(
    bucket: string,
    objectKey: string,
    bytes: Buffer,
  ): Promise<StoredObjectStat> {
    const target = this.path(bucket, objectKey);
    await fs.mkdir(dirname(target), { recursive: true });
    // Idempotent for identical content-addressed keys: if present, keep it.
    try {
      const st = await fs.stat(target);
      if (st.isFile() && st.size === bytes.length) {
        return { bucket, objectKey, sizeBytes: st.size, version: null };
      }
    } catch {
      /* not present — write it */
    }
    const tmp = `${target}.${randomUUID()}.tmp`;
    await fs.writeFile(tmp, bytes);
    await fs.rename(tmp, target);
    const st = await fs.stat(target);
    return { bucket, objectKey, sizeBytes: st.size, version: null };
  }

  async get(bucket: string, objectKey: string): Promise<Buffer> {
    return fs.readFile(this.path(bucket, objectKey));
  }

  async exists(bucket: string, objectKey: string): Promise<boolean> {
    try {
      const st = await fs.stat(this.path(bucket, objectKey));
      return st.isFile();
    } catch {
      return false;
    }
  }

  async stat(
    bucket: string,
    objectKey: string,
  ): Promise<StoredObjectStat | null> {
    try {
      const st = await fs.stat(this.path(bucket, objectKey));
      if (!st.isFile()) return null;
      return { bucket, objectKey, sizeBytes: st.size, version: null };
    } catch {
      return null;
    }
  }
}
