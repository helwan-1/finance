import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { withTenantContext, type TenantTx } from "@/lib/db/tenant";
import { getStorageAdapter, firmBucket } from "@/lib/storage";
import {
  sha256Bytes, rawHash, datasetHash, mappingHash, type RawCell,
} from "./canonical";
import { readPositional, detectDelimiter, toRawCells } from "./read";
import { buildEffectiveProfile, type ProfileInput } from "./profile";
import { suggestMapping, applyMapping, type MappingIssue } from "./mapping";
import { validateRow, type FieldIssue, type DateInterpretation } from "./validate";
import { TARGET_FIELD_SET_VERSION, NORMALIZER_VERSION, type DatasetKind } from "./vocab";
import { createCanonicalAccounting, type CanonicalRecord } from "@/lib/accounting/canonical";

export interface StartParams {
  auditFirmId: string;
  userId: string | null;
  engagementId: string;
  datasetKind: DatasetKind;
  fileName: string;
  mimeType: string;
  bytes: Buffer;
  idempotencyKey: string;
  mapping?: Record<string, string>;
  profile?: ProfileInput;
  acknowledgeDuplicate?: boolean;
  label?: string;
  /**
   * G3 frozen import provenance (F1/F2). Both are optional and, when supplied,
   * are persisted on the batch's effectiveProfileJson so canonical resolution is
   * explicit and reproducible across retries. Absent → no amount-sign direction
   * is fabricated and no source identity is trusted (NO_RELIABLE_ENTRY_ID).
   */
  amountSignConvention?: "POSITIVE_DEBIT_NEGATIVE_CREDIT" | "POSITIVE_CREDIT_NEGATIVE_DEBIT";
  sourceIdentityMap?: Record<string, string>;
}

export interface StartResult {
  status: "READY" | "DUPLICATE_BLOCKED" | "DEDUPED_EXISTING" | "STORAGE_FAILED" | "NOT_FOUND";
  batchId?: string;
  attemptId?: string;
  datasetId?: string;
  sourceFileId?: string;
  rowsTotal?: number;
  rowsAccepted?: number;
  rowsRejected?: number;
  blockingIssues?: number;
  duplicateOfSourceFileId?: string;
  existingBatchId?: string;
  existingBatchStatus?: string;
}

function isXlsx(name: string, mime: string): boolean {
  return /\.(xlsx|xls)$/i.test(name) || mime.includes("spreadsheetml") || mime.includes("ms-excel");
}

interface PreparedRow {
  sourceRowNo: number;
  cells: RawCell[];
  rawHash: string;
  normalized: Record<string, string | null> | null;
  status: "ACCEPTED" | "ACCEPTED_WITH_WARNING" | "REJECTED";
  fieldIssues: FieldIssue[];
  mapIssues: MappingIssue[];
}

/** Pure per-row preparation: raw cells, rawHash, mapping, validation. */
function prepareRows(
  kind: DatasetKind, headers: (string | null)[], rows: string[][],
  mapJson: Record<string, string>, dateInterp: DateInterpretation,
): PreparedRow[] {
  return rows.map((row, idx) => {
    const cells = toRawCells(headers, row);
    const rh = rawHash(cells);
    const { mapped, issues: mapIssues } = applyMapping(cells, mapJson);
    const v = validateRow(kind, mapped, { dateInterpretation: dateInterp });
    return { sourceRowNo: idx + 1, cells, rawHash: rh, normalized: v.normalized, status: v.status, fieldIssues: v.issues, mapIssues };
  });
}

/** Create a PENDING Dataset + its ImportedRecords + ImportIssues for one attempt. */
async function persistDatasetAndRecords(
  tx: TenantTx,
  a: {
    auditFirmId: string; engagementId: string; batchId: string; attemptId: string;
    sourceFileId: string | null; kind: DatasetKind; label: string; prepared: PreparedRow[];
  },
): Promise<{ datasetId: string; rowsAccepted: number; rowsRejected: number; blockingIssues: number }> {
  const rowsAccepted = a.prepared.filter((r) => r.status !== "REJECTED").length;
  const rowsRejected = a.prepared.length - rowsAccepted;
  const dataset = await tx.dataset.create({
    data: {
      auditFirmId: a.auditFirmId, engagementId: a.engagementId, importBatchId: a.batchId,
      importAttemptId: a.attemptId, sourceFileId: a.sourceFileId, kind: a.kind,
      label: a.label, lineageClass: "VERIFIED", status: "PENDING",
      rowCountTotal: a.prepared.length, rowCountAccepted: rowsAccepted, rowCountRejected: rowsRejected,
      normalizerVersion: NORMALIZER_VERSION,
    },
    select: { id: true },
  });
  const recordRows: Prisma.ImportedRecordCreateManyInput[] = [];
  const issueRows: Prisma.ImportIssueCreateManyInput[] = [];
  for (const r of a.prepared) {
    const recId = `ir_${randomUUID()}`;
    recordRows.push({
      id: recId, auditFirmId: a.auditFirmId, datasetId: dataset.id, importBatchId: a.batchId,
      sourceFileId: a.sourceFileId, sourceRowNo: r.sourceRowNo,
      rawCells: r.cells as unknown as Prisma.InputJsonValue, rawHash: r.rawHash,
      normalizedJson: (r.normalized ?? undefined) as Prisma.InputJsonValue | undefined, status: r.status,
    });
    for (const mi of r.mapIssues) {
      issueRows.push({
        auditFirmId: a.auditFirmId, importBatchId: a.batchId, importAttemptId: a.attemptId,
        importedRecordId: recId, datasetId: dataset.id, scope: "MAPPING", field: mi.field,
        severity: "WARNING", code: mi.code, message: mi.message, rawValue: mi.rawValue, blocking: false,
      });
    }
    for (const fi of r.fieldIssues) {
      issueRows.push({
        auditFirmId: a.auditFirmId, importBatchId: a.batchId, importAttemptId: a.attemptId,
        importedRecordId: recId, datasetId: dataset.id, scope: "FIELD", field: fi.field,
        severity: fi.severity, code: fi.code, message: fi.message, rawValue: fi.rawValue, blocking: fi.blocking,
      });
    }
  }
  if (recordRows.length) await tx.importedRecord.createMany({ data: recordRows });
  if (issueRows.length) await tx.importIssue.createMany({ data: issueRows });
  return { datasetId: dataset.id, rowsAccepted, rowsRejected, blockingIssues: issueRows.filter((i) => i.blocking).length };
}

async function ensureProfile(
  tx: TenantTx, auditFirmId: string, userId: string | null,
  eff: ReturnType<typeof buildEffectiveProfile>,
): Promise<string> {
  const found = await tx.importProfile.findUnique({
    where: { auditFirmId_profileHash: { auditFirmId, profileHash: eff.hash } }, select: { id: true },
  });
  if (found) return found.id;
  const created = await tx.importProfile.create({
    data: {
      auditFirmId, name: `auto:${eff.format}`, format: eff.format as "CSV" | "XLSX",
      encoding: eff.encoding, delimiter: eff.delimiter, sheet: eff.sheet, headerRow: eff.headerRow,
      locale: eff.locale, dateInterpretation: eff.dateInterpretation, numberInterpretation: eff.numberInterpretation,
      parserVersion: eff.parserVersion, normalizerVersion: eff.normalizerVersion, profileHash: eff.hash, createdById: userId,
    },
    select: { id: true },
  });
  return created.id;
}

async function ensureMappingVersion(
  tx: TenantTx, auditFirmId: string, userId: string | null,
  kind: DatasetKind, mapJson: Record<string, string>, mHash: string,
): Promise<string> {
  const existing = await tx.importMappingVersion.findUnique({
    where: { auditFirmId_mappingHash: { auditFirmId, mappingHash: mHash } }, select: { id: true },
  });
  if (existing) return existing.id;
  let mapping = await tx.importMapping.findFirst({
    where: { auditFirmId, name: `auto:${kind}`, datasetKind: kind, clientCompanyId: null }, select: { id: true },
  });
  if (!mapping) {
    mapping = await tx.importMapping.create({ data: { auditFirmId, name: `auto:${kind}`, datasetKind: kind }, select: { id: true } });
  }
  const last = await tx.importMappingVersion.findFirst({
    where: { importMappingId: mapping.id }, orderBy: { version: "desc" }, select: { version: true },
  });
  const version = (last?.version ?? 0) + 1;
  const created = await tx.importMappingVersion.create({
    data: {
      auditFirmId, importMappingId: mapping.id, version, mapJson: mapJson as Prisma.InputJsonValue,
      targetFieldSetVersion: TARGET_FIELD_SET_VERSION, mappingHash: mHash, createdById: userId,
    },
    select: { id: true },
  });
  await tx.importMapping.update({ where: { id: mapping.id }, data: { currentVersionId: created.id } });
  return created.id;
}

/**
 * Upload → SourceFile RETAINED → Batch → Attempt #1 → Profile → Mapping →
 * VALIDATING → Dataset + ImportedRecords + ImportIssues → READY (halt).
 */
export async function startImport(p: StartParams): Promise<StartResult> {
  const sha = sha256Bytes(p.bytes);
  const format: "CSV" | "XLSX" = isXlsx(p.fileName, p.mimeType) ? "XLSX" : "CSV";
  const delimiter = format === "CSV" ? detectDelimiter(p.bytes.toString("utf8")) : null;
  const eff = buildEffectiveProfile({ ...(p.profile ?? {}), format, delimiter });
  const table = await readPositional(p.fileName, p.mimeType, p.bytes, delimiter ?? ",");
  const mapJson = p.mapping ?? suggestMapping(p.datasetKind, table.headers);
  const mHash = mappingHash(p.datasetKind, TARGET_FIELD_SET_VERSION, mapJson);

  const pre = await withTenantContext(p.auditFirmId, async (tx) => {
    const existing = await tx.importBatch.findUnique({
      where: { auditFirmId_idempotencyKey: { auditFirmId: p.auditFirmId, idempotencyKey: p.idempotencyKey } },
      select: { id: true, status: true },
    });
    const dup = await tx.sourceFile.findFirst({ where: { sha256: sha }, select: { id: true } });
    return { existing, dupId: dup?.id ?? null };
  });
  if (pre.existing) {
    return { status: "DEDUPED_EXISTING", existingBatchId: pre.existing.id, batchId: pre.existing.id, existingBatchStatus: pre.existing.status };
  }
  if (pre.dupId && !p.acknowledgeDuplicate) {
    return { status: "DUPLICATE_BLOCKED", duplicateOfSourceFileId: pre.dupId };
  }

  const adapter = getStorageAdapter();
  const bucket = firmBucket(p.auditFirmId);
  await adapter.put(bucket, sha, p.bytes);
  const st = await adapter.stat(bucket, sha);
  const retained = !!st && st.sizeBytes === p.bytes.length && (await adapter.exists(bucket, sha));
  if (!retained) return { status: "STORAGE_FAILED" };

  const prepared = prepareRows(p.datasetKind, table.headers, table.rows, mapJson, eff.dateInterpretationEnum);

  return withTenantContext(p.auditFirmId, async (tx) => {
    const profileId = await ensureProfile(tx, p.auditFirmId, p.userId, eff);
    const mappingVersionId = await ensureMappingVersion(tx, p.auditFirmId, p.userId, p.datasetKind, mapJson, mHash);
    const sf = await tx.sourceFile.create({
      data: {
        auditFirmId: p.auditFirmId, engagementId: p.engagementId, originalFileName: p.fileName,
        mimeType: p.mimeType, sizeBytes: BigInt(p.bytes.length), sha256: sha, uploadedById: p.userId,
        storageProvider: "OBJECT_STORE", storageBucket: bucket, storageObjectKey: sha,
        custodyStatus: "RETAINED", processingBoundary: "INTERNAL",
      },
      select: { id: true },
    });
    const batch = await tx.importBatch.create({
      data: {
        auditFirmId: p.auditFirmId, engagementId: p.engagementId, sourceFileId: sf.id,
        importProfileId: profileId, importMappingVersionId: mappingVersionId, datasetKind: p.datasetKind,
        status: "VALIDATING", idempotencyKey: p.idempotencyKey, startedById: p.userId,
        rowsTotal: prepared.length, rowsAccepted: prepared.filter((r) => r.status !== "REJECTED").length,
        rowsRejected: prepared.filter((r) => r.status === "REJECTED").length,
        // Freeze G3 provenance alongside the effective profile (reproducible on retry).
        effectiveProfileJson: {
          ...(eff as unknown as Record<string, unknown>),
          g3: {
            amountSignConvention: p.amountSignConvention ?? null,
            sourceIdentityMap: p.sourceIdentityMap ?? null,
          },
        } as unknown as Prisma.InputJsonValue,
        effectiveProfileHash: eff.hash,
      },
      select: { id: true },
    });
    const attempt = await tx.importAttempt.create({
      data: { auditFirmId: p.auditFirmId, importBatchId: batch.id, attemptNo: 1, status: "RUNNING", startedById: p.userId },
      select: { id: true },
    });
    const ds = await persistDatasetAndRecords(tx, {
      auditFirmId: p.auditFirmId, engagementId: p.engagementId, batchId: batch.id, attemptId: attempt.id,
      sourceFileId: sf.id, kind: p.datasetKind, label: p.label ?? `${p.datasetKind} import`, prepared,
    });
    await tx.importBatch.update({ where: { id: batch.id }, data: { status: "READY" } });
    return {
      status: "READY", batchId: batch.id, attemptId: attempt.id, datasetId: ds.datasetId, sourceFileId: sf.id,
      rowsTotal: prepared.length, rowsAccepted: ds.rowsAccepted, rowsRejected: ds.rowsRejected, blockingIssues: ds.blockingIssues,
    };
  });
}

/**
 * Retry a batch whose latest attempt failed (or is a stuck RUNNING attempt):
 * marks it FAILED (its forensic Dataset/records retained, non-consumable), then
 * creates attempt #N+1 by RE-INGESTING the stored SourceFile bytes into a new
 * PENDING Dataset. No AuditJob/queue.
 */
export async function retryImport(
  auditFirmId: string, userId: string | null, batchId: string,
): Promise<StartResult> {
  const info = await withTenantContext(auditFirmId, async (tx) => {
    const batch = await tx.importBatch.findUnique({
      where: { id: batchId },
      select: {
        id: true, resultDatasetId: true, datasetKind: true, engagementId: true, sourceFileId: true,
        importMappingVersionId: true, effectiveProfileJson: true,
      },
    });
    if (!batch) return { kind: "not_found" as const };
    if (batch.resultDatasetId) return { kind: "done" as const };

    const latest = await tx.importAttempt.findFirst({
      where: { importBatchId: batch.id }, orderBy: { attemptNo: "desc" }, select: { id: true, attemptNo: true, status: true },
    });
    // Recover an interrupted RUNNING attempt → FAILED (+ its PENDING dataset).
    if (latest && latest.status === "RUNNING") {
      await tx.importAttempt.update({ where: { id: latest.id }, data: { status: "FAILED", endedAt: new Date(), failureReason: "interrupted-running" } });
      await tx.dataset.updateMany({ where: { importAttemptId: latest.id, status: "PENDING" }, data: { status: "FAILED" } });
    }
    const sf = batch.sourceFileId
      ? await tx.sourceFile.findUnique({ where: { id: batch.sourceFileId }, select: { storageBucket: true, storageObjectKey: true, originalFileName: true, mimeType: true } })
      : null;
    const mv = batch.importMappingVersionId
      ? await tx.importMappingVersion.findUnique({ where: { id: batch.importMappingVersionId }, select: { mapJson: true } })
      : null;
    return { kind: "retry" as const, batch, sf, mv, nextAttemptNo: (latest?.attemptNo ?? 0) + 1 };
  });

  if (info.kind === "not_found") return { status: "NOT_FOUND" };
  if (info.kind === "done") return { status: "DEDUPED_EXISTING", batchId, existingBatchStatus: "COMPLETED" };
  if (!info.sf?.storageObjectKey || !info.sf.storageBucket) return { status: "STORAGE_FAILED" };

  const adapter = getStorageAdapter();
  const bytes = await adapter.get(info.sf.storageBucket, info.sf.storageObjectKey);
  const eff = info.batch.effectiveProfileJson as unknown as { dateInterpretationEnum: DateInterpretation };
  const kind = info.batch.datasetKind as DatasetKind;
  const mapJson = (info.mv?.mapJson ?? {}) as Record<string, string>;
  const fname = info.sf.originalFileName;
  const fmime = info.sf.mimeType;
  const format: "CSV" | "XLSX" = isXlsx(fname, fmime) ? "XLSX" : "CSV";
  const delimiter = format === "CSV" ? detectDelimiter(bytes.toString("utf8")) : null;
  const table = await readPositional(fname, fmime, bytes, delimiter ?? ",");
  const prepared = prepareRows(kind, table.headers, table.rows, mapJson, eff?.dateInterpretationEnum ?? "ISO");

  return withTenantContext(auditFirmId, async (tx) => {
    const attempt = await tx.importAttempt.create({
      data: { auditFirmId, importBatchId: batchId, attemptNo: info.nextAttemptNo, status: "RUNNING", startedById: userId },
      select: { id: true },
    });
    const ds = await persistDatasetAndRecords(tx, {
      auditFirmId, engagementId: info.batch.engagementId, batchId, attemptId: attempt.id,
      sourceFileId: info.batch.sourceFileId, kind, label: `${kind} import (retry ${info.nextAttemptNo})`, prepared,
    });
    await tx.importBatch.update({ where: { id: batchId }, data: { status: "READY", failureReason: null } });
    return {
      status: "READY", batchId, attemptId: attempt.id, datasetId: ds.datasetId,
      rowsTotal: prepared.length, rowsAccepted: ds.rowsAccepted, rowsRejected: ds.rowsRejected, blockingIssues: ds.blockingIssues,
    };
  });
}

export interface ConfirmResult {
  status: "COMPLETED" | "COMPLETED_WITH_ISSUES" | "ALREADY_COMPLETED" | "NOT_READY" | "FAILED";
  datasetId?: string;
  datasetHash?: string;
  transactionsCreated?: number;
  canonical?: {
    contexts: number;
    datasetAccounts: number;
    journalEntries: number;
    journalLines: number;
    trialBalances: number;
    trialBalanceRows: number;
  };
}

export interface ConfirmOptions {
  /** Test-only fault injection: throw after transactions are created, before finalize. */
  faultAfterTransactions?: boolean;
}

function toTransaction(
  kind: DatasetKind, n: Record<string, string | null>, sourceRowNo: number, defaultCurrency: string,
): Omit<Prisma.TransactionCreateManyInput, "auditFirmId" | "engagementId" | "importedRecordId" | "datasetId"> | null {
  if (kind === "GENERAL_LEDGER") {
    const amount = n.debit ?? n.credit ?? n.amount;
    if (amount == null) return null;
    const type: "DEBIT" | "CREDIT" = n.credit != null && n.debit == null ? "CREDIT" : "DEBIT";
    const posted = n.postingDate ? new Date(n.postingDate) : new Date();
    return {
      reference: n.reference ?? n.documentNumber ?? `R-${sourceRowNo}`, description: n.description ?? "—",
      amount: Math.abs(Number.parseFloat(amount)).toFixed(2), currency: n.currency ?? defaultCurrency,
      type, source: "LEDGER", counterparty: n.counterparty ?? null, account: n.accountCode ?? null,
      postedAt: posted, valueDate: n.documentDate ? new Date(n.documentDate) : posted,
    };
  }
  if (kind === "BANK") {
    if (n.amount == null || n.transactionDate == null) return null;
    const num = Number.parseFloat(n.amount);
    const posted = new Date(n.transactionDate);
    return {
      reference: n.reference ?? `B-${sourceRowNo}`, description: n.description ?? "—",
      amount: Math.abs(num).toFixed(2), currency: n.currency ?? defaultCurrency,
      type: num < 0 ? "CREDIT" : "DEBIT", source: "BANK", counterparty: n.counterparty ?? null,
      account: n.bankAccount ?? null, postedAt: posted, valueDate: n.valueDate ? new Date(n.valueDate) : posted,
    };
  }
  return null;
}

/**
 * READY → (explicit confirmation) → IMPORTING → transactions for ACCEPTED
 * records only → finalize (datasetHash) → SUCCEEDED / COMPLETED*. On failure the
 * attempt + its dataset are marked FAILED (retained, non-consumable) and the
 * batch is left FAILED for retry — no transactions survive (atomic rollback).
 */
export async function confirmImport(
  auditFirmId: string, userId: string | null, batchId: string, opts?: ConfirmOptions,
): Promise<ConfirmResult> {
  let recover: { attemptId: string; datasetId: string } | null = null;
  try {
    return await withTenantContext(auditFirmId, async (tx) => {
      const batch = await tx.importBatch.findUnique({
        where: { id: batchId },
        select: { id: true, status: true, datasetKind: true, engagementId: true, resultDatasetId: true, effectiveProfileHash: true, effectiveProfileJson: true, importMappingVersionId: true },
      });
      if (!batch) return { status: "NOT_READY" };
      if (batch.resultDatasetId) return { status: "ALREADY_COMPLETED", datasetId: batch.resultDatasetId };
      if (batch.status !== "READY") return { status: "NOT_READY" };

      const dataset = await tx.dataset.findFirst({
        where: { importBatchId: batch.id, status: "PENDING" }, orderBy: { createdAt: "desc" },
        select: { id: true, importAttemptId: true, rowCountRejected: true, sourceFileId: true },
      });
      if (!dataset) return { status: "NOT_READY" };
      recover = { attemptId: dataset.importAttemptId, datasetId: dataset.id };

      const records = await tx.importedRecord.findMany({
        where: { datasetId: dataset.id }, orderBy: { sourceRowNo: "asc" },
        select: { id: true, sourceRowNo: true, rawHash: true, rawCells: true, normalizedJson: true, status: true },
      });
      const eng = await tx.auditEngagement.findUnique({ where: { id: batch.engagementId }, select: { currency: true, clientCompanyId: true } });
      const currency = eng?.currency ?? "SAR";
      const mapJson = batch.importMappingVersionId
        ? ((await tx.importMappingVersion.findUnique({ where: { id: batch.importMappingVersionId }, select: { mapJson: true } }))?.mapJson ?? {})
        : {};

      await tx.importBatch.update({ where: { id: batch.id }, data: { status: "IMPORTING" } });

      let created = 0;
      for (const rec of records) {
        if (rec.status === "REJECTED") continue;
        const payload = toTransaction(batch.datasetKind as DatasetKind, (rec.normalizedJson ?? {}) as Record<string, string | null>, rec.sourceRowNo, currency);
        if (!payload) continue;
        await tx.transaction.create({ data: { ...payload, auditFirmId, engagementId: batch.engagementId, importedRecordId: rec.id, datasetId: dataset.id } });
        created += 1;
      }

      // G3: canonical accounting facts, from the SAME ImportedRecords (single
      // source of truth). Constructed here, before finalize — so a fault rolls
      // them back atomically with the bridge (Section K). Direction + source
      // identity come only from the frozen provenance persisted at start (F1/F2).
      const g3 = ((batch.effectiveProfileJson as { g3?: { amountSignConvention?: "POSITIVE_DEBIT_NEGATIVE_CREDIT" | "POSITIVE_CREDIT_NEGATIVE_DEBIT" | null; sourceIdentityMap?: Record<string, string> | null } } | null)?.g3) ?? {};
      const canonical = await createCanonicalAccounting(tx, {
        auditFirmId, engagementId: batch.engagementId, clientCompanyId: eng?.clientCompanyId ?? null,
        datasetId: dataset.id, kind: batch.datasetKind as DatasetKind,
        mapJson: mapJson as Record<string, string>,
        amountSignConvention: g3.amountSignConvention ?? null,
        sourceIdentityMap: g3.sourceIdentityMap ?? null,
        records: records.map((r) => ({
          id: r.id, sourceRowNo: r.sourceRowNo,
          rawCells: (r.rawCells ?? []) as unknown as RawCell[],
          normalizedJson: (r.normalizedJson ?? null) as Record<string, string | null> | null,
          status: r.status,
        })) as CanonicalRecord[],
      });

      if (opts?.faultAfterTransactions) throw new Error("injected-fault-before-finalize");

      const sfSha = dataset.sourceFileId
        ? (await tx.sourceFile.findUnique({ where: { id: dataset.sourceFileId }, select: { sha256: true } }))?.sha256 ?? null : null;
      const mHash = batch.importMappingVersionId
        ? (await tx.importMappingVersion.findUnique({ where: { id: batch.importMappingVersionId }, select: { mappingHash: true } }))?.mappingHash ?? "" : "";
      const dHash = datasetHash({
        sourceFileSha256: sfSha, effectiveProfileHash: batch.effectiveProfileHash ?? "", mappingHash: mHash,
        datasetKind: batch.datasetKind, normalizerVersion: NORMALIZER_VERSION, orderedRawHashes: records.map((r) => r.rawHash),
      });
      const finalStatus = dataset.rowCountRejected > 0 ? "COMPLETED_WITH_ISSUES" : "COMPLETED";
      await tx.dataset.update({ where: { id: dataset.id }, data: { status: finalStatus, datasetHash: dHash, finalizedAt: new Date() } });
      await tx.importAttempt.update({ where: { id: dataset.importAttemptId }, data: { status: "SUCCEEDED", endedAt: new Date(), confirmedById: userId, confirmedAt: new Date() } });
      await tx.importBatch.update({ where: { id: batch.id }, data: { status: finalStatus, resultDatasetId: dataset.id, completedAt: new Date() } });
      return { status: finalStatus, datasetId: dataset.id, datasetHash: dHash, transactionsCreated: created, canonical };
    });
  } catch (e) {
    if (recover) {
      const r: { attemptId: string; datasetId: string } = recover;
      // The failed tx rolled back (no transactions persisted). Mark the attempt
      // and its dataset FAILED (retained, non-consumable); batch → FAILED for retry.
      await withTenantContext(auditFirmId, async (tx) => {
        await tx.importAttempt.update({ where: { id: r.attemptId }, data: { status: "FAILED", endedAt: new Date(), failureReason: "confirm-failed" } });
        await tx.dataset.update({ where: { id: r.datasetId }, data: { status: "FAILED" } });
        await tx.importBatch.update({ where: { id: batchId }, data: { status: "FAILED", failureReason: "attempt failed during confirmation" } });
      });
      return { status: "FAILED", datasetId: r.datasetId };
    }
    throw e;
  }
}
