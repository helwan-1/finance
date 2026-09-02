/**
 * Provider-neutral storage port (Closure C1). The domain/schema depend only on
 * this interface — never on a vendor. Concrete adapters (filesystem, an
 * S3-compatible endpoint, …) are selected by configuration.
 */
export interface StoredObjectStat {
  bucket: string;
  objectKey: string;
  sizeBytes: number;
  version?: string | null;
}

export interface StorageAdapter {
  /** Adapter id recorded as provenance (not a vendor brand in the domain). */
  readonly provider: string;
  put(bucket: string, objectKey: string, bytes: Buffer): Promise<StoredObjectStat>;
  get(bucket: string, objectKey: string): Promise<Buffer>;
  exists(bucket: string, objectKey: string): Promise<boolean>;
  stat(bucket: string, objectKey: string): Promise<StoredObjectStat | null>;
}
