import { Prisma } from "@prisma/client";
import type { TenantTx } from "@/lib/db/tenant";
import { EvidenceOutOfPopulationError, ExecutionError } from "./errors";

export interface FrozenMember {
  datasetId: string;
  sourceRowNo: number;
  eoiFrameHash: string;
  contentHash: string;
  importedRecordId: string;
  rawHash: string;
  datasetHash: string;
}

export interface Keyset {
  datasetId: string;
  sourceRowNo: number;
}

/**
 * One keyset page of the FROZEN population for (preparation, testVersion),
 * eligible resolutions only. The authoritative relation BEGINS from
 * AuditRunScopeMember and joins ImportedRecord only for those members — it never
 * scans all ImportedRecord in a dataset. Multiplicity is preserved (two members
 * with equal rawHash at different sourceRowNo are two rows). Deterministic order
 * by (datasetId, sourceRowNo). Bounded by `batchSize`. RLS binds auditFirmId.
 */
export async function fetchMemberPage(
  tx: TenantTx,
  preparationId: string,
  auditTestVersionId: string,
  after: Keyset | null,
  batchSize: number,
): Promise<FrozenMember[]> {
  const keyset = after
    ? Prisma.sql`AND (m."datasetId", m."sourceRowNo") > (${after.datasetId}, ${after.sourceRowNo})`
    : Prisma.empty;
  const rows = await tx.$queryRaw<Array<{
    datasetId: string; sourceRowNo: number; eoiFrameHash: string; contentHash: string;
    importedRecordId: string; rawHash: string; datasetHash: string;
  }>>(Prisma.sql`
    SELECT m."datasetId"          AS "datasetId",
           m."sourceRowNo"        AS "sourceRowNo",
           m."eoiFrameHash"       AS "eoiFrameHash",
           m."contentHash"        AS "contentHash",
           ir."id"                AS "importedRecordId",
           ir."rawHash"           AS "rawHash",
           d."datasetHash"        AS "datasetHash"
    FROM "audit_run_scope_members" m
    JOIN "audit_run_scope_resolutions" r
      ON  r."preparationId"      = m."preparationId"
      AND r."auditTestVersionId" = m."auditTestVersionId"
      AND r."datasetId"          = m."datasetId"
    JOIN "audit_run_datasets" d
      ON  d."preparationId" = m."preparationId"
      AND d."datasetId"     = m."datasetId"
    JOIN "imported_records" ir
      ON  ir."datasetId"   = m."datasetId"
      AND ir."sourceRowNo" = m."sourceRowNo"
    WHERE m."preparationId"      = ${preparationId}
      AND m."auditTestVersionId" = ${auditTestVersionId}
      AND r."eligibility" <> 'NOT_ELIGIBLE'
      ${keyset}
    ORDER BY m."datasetId" ASC, m."sourceRowNo" ASC
    LIMIT ${batchSize}
  `);
  return rows.map((x) => ({
    datasetId: x.datasetId,
    sourceRowNo: Number(x.sourceRowNo),
    eoiFrameHash: x.eoiFrameHash,
    contentHash: x.contentHash,
    importedRecordId: x.importedRecordId,
    rawHash: x.rawHash,
    datasetHash: x.datasetHash,
  }));
}

/**
 * Defense-in-depth: prove an ImportedRecord occurrence belongs to the exact
 * frozen population for the executing (preparation, testVersion, dataset) before
 * any evidence referencing it is persisted. Not merely same-tenant/same-dataset:
 * it must be an authoritative AuditRunScopeMember. Cross-population evidence
 * fails closed.
 */
export async function assertMember(
  tx: TenantTx,
  preparationId: string,
  auditTestVersionId: string,
  datasetId: string,
  sourceRowNo: number,
): Promise<void> {
  const m = await tx.auditRunScopeMember.findFirst({
    where: { preparationId, auditTestVersionId, datasetId, sourceRowNo },
    select: { id: true },
  });
  if (!m) throw new EvidenceOutOfPopulationError(datasetId, sourceRowNo);
}

// ── C2 grain-aware iterators ────────────────────────────────────────────────

export interface MemberLine {
  datasetId: string; sourceRowNo: number; eoiFrameHash: string;
  journalLineId: string; lineNo: number;
  transactionDebit: string | null; transactionCredit: string | null;
}

/**
 * One keyset page of frozen members that are GL JournalLines (member 1:1 line),
 * eligible resolutions only. Predicate evaluation is done by the caller in JS so
 * exhaustion is measured over the FULL population, not a filtered subset.
 */
export async function fetchMemberLinePage(
  tx: TenantTx, preparationId: string, auditTestVersionId: string, after: Keyset | null, batchSize: number,
): Promise<MemberLine[]> {
  const keyset = after ? Prisma.sql`AND (m."datasetId", m."sourceRowNo") > (${after.datasetId}, ${after.sourceRowNo})` : Prisma.empty;
  const rows = await tx.$queryRaw<Array<{ datasetId: string; sourceRowNo: number; eoiFrameHash: string; journalLineId: string; lineNo: number; transactionDebit: string | null; transactionCredit: string | null }>>(Prisma.sql`
    SELECT m."datasetId" AS "datasetId", m."sourceRowNo" AS "sourceRowNo", m."eoiFrameHash" AS "eoiFrameHash",
           l."id" AS "journalLineId", l."lineNo" AS "lineNo",
           l."transactionDebit"::text AS "transactionDebit", l."transactionCredit"::text AS "transactionCredit"
    FROM "audit_run_scope_members" m
    JOIN "audit_run_scope_resolutions" r ON r."preparationId"=m."preparationId" AND r."auditTestVersionId"=m."auditTestVersionId" AND r."datasetId"=m."datasetId"
    JOIN "imported_records" ir ON ir."datasetId"=m."datasetId" AND ir."sourceRowNo"=m."sourceRowNo"
    JOIN "journal_lines" l ON l."datasetId"=m."datasetId" AND l."importedRecordId"=ir."id"
    WHERE m."preparationId"=${preparationId} AND m."auditTestVersionId"=${auditTestVersionId} AND r."eligibility" <> 'NOT_ELIGIBLE'
      ${keyset}
    ORDER BY m."datasetId" ASC, m."sourceRowNo" ASC
    LIMIT ${batchSize}
  `);
  return rows.map((x) => ({ ...x, sourceRowNo: Number(x.sourceRowNo), lineNo: Number(x.lineNo) }));
}

export interface EligibleJE {
  journalEntryId: string; sourceEntryId: string; datasetId: string; datasetHash: string;
  balanceStatus: string | null; debitTotal: string | null; creditTotal: string | null; difference: string | null; balanceCurrency: string | null;
}

/**
 * One keyset page of JournalEntries eligible for a test: a JE in a pinned dataset
 * whose lines are ALL frozen members for (preparation, testVersion). A JE with
 * SOME member and SOME non-member lines is a broken frozen invariant → fail closed
 * (VALIDATION). A JE with zero member lines is simply out of population (skipped).
 * Keyset over journalEntry.id; one row per JE (never per line).
 */
export async function fetchEligibleJEPage(
  tx: TenantTx, preparationId: string, auditTestVersionId: string, frozenDatasetIds: string[], afterId: string | null, batchSize: number,
): Promise<EligibleJE[]> {
  const after = afterId ? Prisma.sql`AND je."id" > ${afterId}` : Prisma.empty;
  const rows = await tx.$queryRaw<Array<{ journalEntryId: string; sourceEntryId: string; datasetId: string; datasetHash: string; balanceStatus: string | null; debitTotal: string | null; creditTotal: string | null; difference: string | null; balanceCurrency: string | null; totalLines: bigint; memberLines: bigint }>>(Prisma.sql`
    SELECT je."id" AS "journalEntryId", je."sourceEntryId" AS "sourceEntryId", je."datasetId" AS "datasetId",
           d."datasetHash" AS "datasetHash", je."balanceStatus"::text AS "balanceStatus",
           je."debitTotal"::text AS "debitTotal", je."creditTotal"::text AS "creditTotal", je."difference"::text AS "difference", je."balanceCurrency" AS "balanceCurrency",
           (SELECT count(*) FROM "journal_lines" l WHERE l."journalEntryId"=je."id") AS "totalLines",
           (SELECT count(*) FROM "journal_lines" l
              JOIN "imported_records" ir ON ir."id"=l."importedRecordId"
              JOIN "audit_run_scope_members" m ON m."preparationId"=${preparationId} AND m."auditTestVersionId"=${auditTestVersionId} AND m."datasetId"=je."datasetId" AND m."sourceRowNo"=ir."sourceRowNo"
            WHERE l."journalEntryId"=je."id") AS "memberLines"
    FROM "journal_entries" je
    JOIN "audit_run_datasets" d ON d."preparationId"=${preparationId} AND d."datasetId"=je."datasetId"
    WHERE je."datasetId" IN (${Prisma.join(frozenDatasetIds)})
      ${after}
      AND EXISTS (SELECT 1 FROM "journal_lines" l
        JOIN "imported_records" ir ON ir."id"=l."importedRecordId"
        JOIN "audit_run_scope_members" m ON m."preparationId"=${preparationId} AND m."auditTestVersionId"=${auditTestVersionId} AND m."datasetId"=je."datasetId" AND m."sourceRowNo"=ir."sourceRowNo"
        WHERE l."journalEntryId"=je."id")
    ORDER BY je."id" ASC
    LIMIT ${batchSize}
  `);
  return rows.map((x) => {
    const total = Number(x.totalLines);
    const member = Number(x.memberLines);
    if (member < total) {
      // Partial JE: some lines are outside the frozen population → broken invariant.
      throw new ExecutionError("VALIDATION", true, `partial journal entry ${x.sourceEntryId} in dataset ${x.datasetId}: ${member}/${total} lines are frozen members`);
    }
    return {
      journalEntryId: x.journalEntryId, sourceEntryId: x.sourceEntryId, datasetId: x.datasetId, datasetHash: x.datasetHash,
      balanceStatus: x.balanceStatus, debitTotal: x.debitTotal, creditTotal: x.creditTotal, difference: x.difference, balanceCurrency: x.balanceCurrency,
    };
  });
}

/** Defense-in-depth: prove every line of a JE is a frozen member before persisting JE evidence. */
export async function assertJEFullyInPopulation(
  tx: TenantTx, preparationId: string, auditTestVersionId: string, journalEntryId: string, datasetId: string,
): Promise<void> {
  const r = await tx.$queryRaw<Array<{ total: bigint; member: bigint }>>(Prisma.sql`
    SELECT (SELECT count(*) FROM "journal_lines" l WHERE l."journalEntryId"=${journalEntryId}) AS "total",
           (SELECT count(*) FROM "journal_lines" l
              JOIN "imported_records" ir ON ir."id"=l."importedRecordId"
              JOIN "audit_run_scope_members" m ON m."preparationId"=${preparationId} AND m."auditTestVersionId"=${auditTestVersionId} AND m."datasetId"=${datasetId} AND m."sourceRowNo"=ir."sourceRowNo"
            WHERE l."journalEntryId"=${journalEntryId}) AS "member"
  `);
  const total = Number(r[0]?.total ?? 0);
  const member = Number(r[0]?.member ?? 0);
  if (total === 0 || member !== total) {
    throw new ExecutionError("VALIDATION", true, `journal entry ${journalEntryId} not fully in frozen population (${member}/${total})`);
  }
}

export interface TBDupGroup {
  trialBalanceId: string; datasetId: string; accountSnapshotId: string; datasetHash: string;
  sourceSystem: string | null; sourceEntity: string | null; sourceLedger: string | null; sourceAccountCode: string;
  occurrenceCount: number;
}
export interface TBDupRow { trialBalanceRowId: string; sourceRowNo: number; eoiFrameHash: string; }

/**
 * One keyset page of DUPLICATE TB account groups (count>1) within a TrialBalance,
 * restricted to frozen members. Grouped by (trialBalanceId, accountSnapshotId) —
 * the same source account code under different datasets/contexts has distinct
 * accountSnapshotId, so it is never cross-grouped. Bounded: one row per group.
 */
export async function fetchTBDuplicateGroups(
  tx: TenantTx, preparationId: string, auditTestVersionId: string, frozenDatasetIds: string[],
  after: { trialBalanceId: string; accountSnapshotId: string } | null, batchSize: number,
): Promise<TBDupGroup[]> {
  const keyset = after ? Prisma.sql`AND (tbr."trialBalanceId", tbr."accountSnapshotId") > (${after.trialBalanceId}, ${after.accountSnapshotId})` : Prisma.empty;
  const rows = await tx.$queryRaw<Array<{ trialBalanceId: string; datasetId: string; accountSnapshotId: string; datasetHash: string; sourceSystem: string | null; sourceEntity: string | null; sourceLedger: string | null; sourceAccountCode: string; occurrenceCount: bigint }>>(Prisma.sql`
    SELECT tbr."trialBalanceId" AS "trialBalanceId", tbr."datasetId" AS "datasetId", tbr."accountSnapshotId" AS "accountSnapshotId",
           d."datasetHash" AS "datasetHash", ctx."sourceSystem" AS "sourceSystem", ctx."sourceEntity" AS "sourceEntity", ctx."sourceLedger" AS "sourceLedger",
           da."sourceAccountCode" AS "sourceAccountCode", count(*) AS "occurrenceCount"
    FROM "trial_balance_rows" tbr
    JOIN "audit_run_datasets" d ON d."preparationId"=${preparationId} AND d."datasetId"=tbr."datasetId"
    JOIN "imported_records" ir ON ir."datasetId"=tbr."datasetId" AND ir."id"=tbr."importedRecordId"
    JOIN "audit_run_scope_members" m ON m."preparationId"=${preparationId} AND m."auditTestVersionId"=${auditTestVersionId} AND m."datasetId"=tbr."datasetId" AND m."sourceRowNo"=ir."sourceRowNo"
    JOIN "dataset_accounts" da ON da."id"=tbr."accountSnapshotId"
    JOIN "source_accounting_contexts" ctx ON ctx."id"=da."sourceAccountingContextId"
    WHERE tbr."datasetId" IN (${Prisma.join(frozenDatasetIds)})
      ${keyset}
    GROUP BY tbr."trialBalanceId", tbr."datasetId", tbr."accountSnapshotId", d."datasetHash", ctx."sourceSystem", ctx."sourceEntity", ctx."sourceLedger", da."sourceAccountCode"
    HAVING count(*) > 1
    ORDER BY tbr."trialBalanceId" ASC, tbr."accountSnapshotId" ASC
    LIMIT ${batchSize}
  `);
  return rows.map((x) => ({
    trialBalanceId: x.trialBalanceId, datasetId: x.datasetId, accountSnapshotId: x.accountSnapshotId, datasetHash: x.datasetHash,
    sourceSystem: x.sourceSystem, sourceEntity: x.sourceEntity, sourceLedger: x.sourceLedger, sourceAccountCode: x.sourceAccountCode,
    occurrenceCount: Number(x.occurrenceCount),
  }));
}

/** Bounded representative rows for a duplicate group: first K by sourceRowNo (all frozen members). */
export async function fetchTBGroupRows(
  tx: TenantTx, preparationId: string, auditTestVersionId: string, trialBalanceId: string, accountSnapshotId: string, k: number,
): Promise<TBDupRow[]> {
  const rows = await tx.$queryRaw<Array<{ trialBalanceRowId: string; sourceRowNo: number; eoiFrameHash: string }>>(Prisma.sql`
    SELECT tbr."id" AS "trialBalanceRowId", ir."sourceRowNo" AS "sourceRowNo", m."eoiFrameHash" AS "eoiFrameHash"
    FROM "trial_balance_rows" tbr
    JOIN "imported_records" ir ON ir."datasetId"=tbr."datasetId" AND ir."id"=tbr."importedRecordId"
    JOIN "audit_run_scope_members" m ON m."preparationId"=${preparationId} AND m."auditTestVersionId"=${auditTestVersionId} AND m."datasetId"=tbr."datasetId" AND m."sourceRowNo"=ir."sourceRowNo"
    WHERE tbr."trialBalanceId"=${trialBalanceId} AND tbr."accountSnapshotId"=${accountSnapshotId}
    ORDER BY ir."sourceRowNo" ASC
    LIMIT ${k}
  `);
  return rows.map((x) => ({ trialBalanceRowId: x.trialBalanceRowId, sourceRowNo: Number(x.sourceRowNo), eoiFrameHash: x.eoiFrameHash }));
}
