import type { TenantTx } from "@/lib/db/tenant";
import type { ExecutionContext, TestPin } from "./context";
import type { CanonicalNode } from "./canonical";

/** AnomalySeverity enum values (schema). */
export type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";

/**
 * Typed, frozen-population evidence reference. Each variant carries exactly one
 * typed target (matching AuditResultEvidence's one-target CHECK) plus the fields
 * needed to (a) prove membership before persistence and (b) fill the occurrence
 * columns. `eoiFrameHash` is the PK-free semantic identity of the occurrence.
 */
export type EvidenceRef =
  | { evidenceType: "IMPORTED_RECORD"; datasetId: string; sourceRowNo: number; importedRecordId: string; eoiFrameHash: string; role?: string }
  | { evidenceType: "JOURNAL_LINE"; datasetId: string; sourceRowNo: number; journalLineId: string; lineNo: number; eoiFrameHash: string; role?: string }
  | { evidenceType: "JOURNAL_ENTRY"; datasetId: string; journalEntryId: string; sourceEntryId: string; eoiFrameHash: string; role?: string }
  | { evidenceType: "TRIAL_BALANCE_ROW"; datasetId: string; sourceRowNo: number; trialBalanceRowId: string; eoiFrameHash: string; role?: string };

/**
 * One deterministic finding to persist. `identityEOIs` feeds BOTH g4occ.2 (run-
 * local) and g4sem.3 (cross-run) as the ordered occurrence identity — it is NOT
 * necessarily the evidence-row EOIs (e.g. a TB-duplicate result keys on the
 * account identity while attaching a bounded sample of rows).
 */
export interface ResultDescriptor {
  resultKind: string;
  resultCode: string;
  severity: Severity;
  payload: CanonicalNode;
  identityEOIs: string[];
  evidence: EvidenceRef[];
  consumedMappingSemanticHashes: string[];
}

/** Result of executing one bounded page for a test (execute.ts persists the descriptors). */
export interface ExecPageResult {
  descriptors: ResultDescriptor[];
  cursor: unknown; // opaque, grain-specific, in-memory keyset cursor
  reachedEnd: boolean; // this attempt observed the terminal short page
}

/**
 * A registered deterministic test executor. execute.ts stays generic: it fences,
 * calls executePage, persists descriptors atomically, and loops on the returned
 * cursor until reachedEnd. Executors own their grain SQL + predicate + payload +
 * evidence + EOIs; they never persist.
 */
export interface TestExecutor {
  testType: string;
  kind: string;
  grain: "IMPORTED_RECORD" | "JOURNAL_LINE" | "JOURNAL_ENTRY" | "TB_ACCOUNT" | "STAT_CURRENCY_POP" | "STAT_AMOUNT_GROUP";
  supportedDatasetKinds: string[];
  /** Preflight: throw ConfigError if this frozen pin cannot be executed. Read-only. */
  validateFrozenConfig(ctx: ExecutionContext, pin: TestPin): void;
  /** Execute one bounded page inside the caller's fenced transaction. */
  executePage(tx: TenantTx, ctx: ExecutionContext, pin: TestPin, cursor: unknown, batchSize: number): Promise<ExecPageResult>;
}

/** Frozen test kind discriminator: C2 uses `kind`; C1 population-member uses `dqKind`. */
export function pinKind(pin: TestPin): string | null {
  const d = pin.definitionJson as { kind?: string; dqKind?: string } | null;
  return d?.kind ?? d?.dqKind ?? null;
}
