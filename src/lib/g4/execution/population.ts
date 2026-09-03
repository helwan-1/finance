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

// ── C3 statistical: scope-aware population fingerprints + bounded aggregate pages ──

/**
 * Read the frozen eligiblePopulationFingerprint (g4pop.2) per pinned dataset for
 * one (preparation, testVersion). Feeds the PK-free statistical population/group
 * identity so two frozen scopes over the same dataset+currency never collide.
 */
export async function fetchEligiblePopulationFingerprints(
  tx: TenantTx, preparationId: string, auditTestVersionId: string, datasetIds: string[],
): Promise<Map<string, string>> {
  if (datasetIds.length === 0) return new Map();
  const rows = await tx.$queryRaw<Array<{ datasetId: string; fp: string | null }>>(Prisma.sql`
    SELECT "datasetId" AS "datasetId", "eligiblePopulationFingerprint" AS "fp"
    FROM "audit_run_scope_resolutions"
    WHERE "preparationId"=${preparationId} AND "auditTestVersionId"=${auditTestVersionId}
      AND "eligibility" <> 'NOT_ELIGIBLE'
      AND "datasetId" IN (${Prisma.join(datasetIds)})
  `);
  const map = new Map<string, string>();
  for (const r of rows) if (r.fp) map.set(r.datasetId, r.fp);
  return map;
}

/**
 * The single-sided positive transaction scalar (frozen contract): debit-only or
 * credit-only positive; both-sided / negative / zero / null → NULL. One line
 * contributes AT MOST one scalar. Written with a literal alias so it can appear
 * both in the aggregate (`l`) and the evidence LATERAL (`l2`).
 */
function scalarExpr(a: "l" | "l2"): Prisma.Sql {
  return Prisma.raw(`(CASE
    WHEN ${a}."transactionDebit" > 0 AND (${a}."transactionCredit" IS NULL OR ${a}."transactionCredit" = 0) THEN ${a}."transactionDebit"
    WHEN ${a}."transactionCredit" > 0 AND (${a}."transactionDebit" IS NULL OR ${a}."transactionDebit" = 0) THEN ${a}."transactionCredit"
    ELSE NULL END)`);
}

export interface RoundGroupFlatRow {
  datasetId: string; datasetHash: string; currency: string;
  eligibleCount: bigint; roundCount: bigint;
  evSourceRowNo: number | null; evJournalLineId: string | null; evLineNo: number | null; evEoi: string | null;
}

/**
 * ONE bounded page of ROUND-NUMBER signal groups + their top-K round-line evidence
 * in a SINGLE query (no per-group round-trip). The aggregate groups the frozen,
 * member-anchored single-sided population by (dataset, currency) and applies the
 * exact integer-count breach in HAVING; a LATERAL attaches at most K qualifying
 * ROUND lines per group. Currency ordering/keyset is pinned to COLLATE "C"
 * (deployment-independent, exact-string). At most batchSize×K rows are returned.
 * No OFFSET. Round predicate: exact NUMERIC `mod(scalar, quantum) = 0`.
 */
export async function fetchRoundNumberSignalPage(
  tx: TenantTx, preparationId: string, auditTestVersionId: string, datasetIds: string[],
  quantum: string, minPop: number, minRound: number, rateNum: number, rateDenom: number,
  after: { datasetId: string; currency: string } | null, batchSize: number, k: number,
): Promise<RoundGroupFlatRow[]> {
  const sL = scalarExpr("l");
  const sL2 = scalarExpr("l2");
  const keyset = after
    ? Prisma.sql`AND ( m."datasetId" COLLATE "C" > ${after.datasetId} COLLATE "C"
        OR ( m."datasetId" COLLATE "C" = ${after.datasetId} COLLATE "C"
             AND l."transactionCurrency" COLLATE "C" > ${after.currency} COLLATE "C" ) )`
    : Prisma.empty;
  return tx.$queryRaw<RoundGroupFlatRow[]>(Prisma.sql`
    SELECT g."datasetId" AS "datasetId", g."datasetHash" AS "datasetHash", g."currency" AS "currency",
           g."eligibleCount" AS "eligibleCount", g."roundCount" AS "roundCount",
           ev."sourceRowNo" AS "evSourceRowNo", ev."journalLineId" AS "evJournalLineId",
           ev."lineNo" AS "evLineNo", ev."eoiFrameHash" AS "evEoi"
    FROM (
      SELECT m."datasetId" AS "datasetId", d."datasetHash" AS "datasetHash", l."transactionCurrency" AS "currency",
             count(*) AS "eligibleCount",
             count(*) FILTER (WHERE mod(${sL}, ${quantum}::numeric) = 0) AS "roundCount"
      FROM "audit_run_scope_members" m
      JOIN "audit_run_scope_resolutions" r ON r."preparationId"=m."preparationId" AND r."auditTestVersionId"=m."auditTestVersionId" AND r."datasetId"=m."datasetId"
      JOIN "audit_run_datasets" d ON d."preparationId"=m."preparationId" AND d."datasetId"=m."datasetId"
      JOIN "imported_records" ir ON ir."datasetId"=m."datasetId" AND ir."sourceRowNo"=m."sourceRowNo"
      JOIN "journal_lines" l ON l."datasetId"=m."datasetId" AND l."importedRecordId"=ir."id"
      WHERE m."preparationId"=${preparationId} AND m."auditTestVersionId"=${auditTestVersionId} AND r."eligibility" <> 'NOT_ELIGIBLE'
        AND m."datasetId" IN (${Prisma.join(datasetIds)})
        AND l."transactionCurrency" IS NOT NULL
        AND ${sL} IS NOT NULL
        ${keyset}
      GROUP BY m."datasetId", d."datasetHash", l."transactionCurrency"
      HAVING count(*) >= ${minPop}
         AND count(*) FILTER (WHERE mod(${sL}, ${quantum}::numeric) = 0) >= ${minRound}
         AND count(*) FILTER (WHERE mod(${sL}, ${quantum}::numeric) = 0) * ${rateDenom}::bigint >= ${rateNum}::bigint * count(*)
      ORDER BY m."datasetId" COLLATE "C" ASC, l."transactionCurrency" COLLATE "C" ASC
      LIMIT ${batchSize}
    ) g
    LEFT JOIN LATERAL (
      SELECT ir2."sourceRowNo" AS "sourceRowNo", l2."id" AS "journalLineId", l2."lineNo" AS "lineNo", m2."eoiFrameHash" AS "eoiFrameHash"
      FROM "audit_run_scope_members" m2
      JOIN "audit_run_scope_resolutions" r2 ON r2."preparationId"=m2."preparationId" AND r2."auditTestVersionId"=m2."auditTestVersionId" AND r2."datasetId"=m2."datasetId"
      JOIN "imported_records" ir2 ON ir2."datasetId"=m2."datasetId" AND ir2."sourceRowNo"=m2."sourceRowNo"
      JOIN "journal_lines" l2 ON l2."datasetId"=m2."datasetId" AND l2."importedRecordId"=ir2."id"
      WHERE m2."preparationId"=${preparationId} AND m2."auditTestVersionId"=${auditTestVersionId} AND r2."eligibility" <> 'NOT_ELIGIBLE'
        AND m2."datasetId" = g."datasetId"
        AND l2."transactionCurrency" COLLATE "C" = g."currency" COLLATE "C"
        AND ${sL2} IS NOT NULL
        AND mod(${sL2}, ${quantum}::numeric) = 0
      ORDER BY m2."datasetId" COLLATE "C" ASC, ir2."sourceRowNo" ASC
      LIMIT ${k}
    ) ev ON true
    ORDER BY g."datasetId" COLLATE "C" ASC, g."currency" COLLATE "C" ASC, ev."sourceRowNo" ASC NULLS LAST
  `);
}

export interface DuplicateGroupFlatRow {
  datasetId: string; datasetHash: string; currency: string; scalar: string; occurrenceCount: bigint;
  evSourceRowNo: number | null; evJournalLineId: string | null; evLineNo: number | null; evEoi: string | null;
}

/**
 * ONE bounded page of DUPLICATE-AMOUNT signal groups + their top-K member-line
 * evidence in a SINGLE query. Groups the frozen, member-anchored single-sided
 * population by (dataset, currency, scalar) with `count(*) >= minOccurrence`; a
 * LATERAL attaches at most K lines per group (exact NUMERIC scalar equality).
 * occurrenceCount is the FULL DB-side group count; only ≤ K evidence rows cross
 * into materialization even for a 100k-row group. COLLATE "C" currency ordering,
 * NUMERIC scalar ordering, keyset, no OFFSET.
 */
export async function fetchDuplicateAmountSignalPage(
  tx: TenantTx, preparationId: string, auditTestVersionId: string, datasetIds: string[],
  minOccurrence: number,
  after: { datasetId: string; currency: string; scalar: string } | null, batchSize: number, k: number,
): Promise<DuplicateGroupFlatRow[]> {
  const sL = scalarExpr("l");
  const sL2 = scalarExpr("l2");
  const keyset = after
    ? Prisma.sql`AND ( m."datasetId" COLLATE "C" > ${after.datasetId} COLLATE "C"
        OR ( m."datasetId" COLLATE "C" = ${after.datasetId} COLLATE "C" AND l."transactionCurrency" COLLATE "C" > ${after.currency} COLLATE "C" )
        OR ( m."datasetId" COLLATE "C" = ${after.datasetId} COLLATE "C" AND l."transactionCurrency" COLLATE "C" = ${after.currency} COLLATE "C" AND ${sL} > ${after.scalar}::numeric ) )`
    : Prisma.empty;
  return tx.$queryRaw<DuplicateGroupFlatRow[]>(Prisma.sql`
    SELECT g."datasetId" AS "datasetId", g."datasetHash" AS "datasetHash", g."currency" AS "currency",
           g."scalar" AS "scalar", g."occurrenceCount" AS "occurrenceCount",
           ev."sourceRowNo" AS "evSourceRowNo", ev."journalLineId" AS "evJournalLineId",
           ev."lineNo" AS "evLineNo", ev."eoiFrameHash" AS "evEoi"
    FROM (
      SELECT m."datasetId" AS "datasetId", d."datasetHash" AS "datasetHash", l."transactionCurrency" AS "currency",
             ${sL} AS "scalarNum", (${sL})::text AS "scalar",
             count(*) AS "occurrenceCount"
      FROM "audit_run_scope_members" m
      JOIN "audit_run_scope_resolutions" r ON r."preparationId"=m."preparationId" AND r."auditTestVersionId"=m."auditTestVersionId" AND r."datasetId"=m."datasetId"
      JOIN "audit_run_datasets" d ON d."preparationId"=m."preparationId" AND d."datasetId"=m."datasetId"
      JOIN "imported_records" ir ON ir."datasetId"=m."datasetId" AND ir."sourceRowNo"=m."sourceRowNo"
      JOIN "journal_lines" l ON l."datasetId"=m."datasetId" AND l."importedRecordId"=ir."id"
      WHERE m."preparationId"=${preparationId} AND m."auditTestVersionId"=${auditTestVersionId} AND r."eligibility" <> 'NOT_ELIGIBLE'
        AND m."datasetId" IN (${Prisma.join(datasetIds)})
        AND l."transactionCurrency" IS NOT NULL
        AND ${sL} IS NOT NULL
        ${keyset}
      GROUP BY m."datasetId", d."datasetHash", l."transactionCurrency", ${sL}
      HAVING count(*) >= ${minOccurrence}
      ORDER BY m."datasetId" COLLATE "C" ASC, l."transactionCurrency" COLLATE "C" ASC, ${sL} ASC
      LIMIT ${batchSize}
    ) g
    LEFT JOIN LATERAL (
      SELECT ir2."sourceRowNo" AS "sourceRowNo", l2."id" AS "journalLineId", l2."lineNo" AS "lineNo", m2."eoiFrameHash" AS "eoiFrameHash"
      FROM "audit_run_scope_members" m2
      JOIN "audit_run_scope_resolutions" r2 ON r2."preparationId"=m2."preparationId" AND r2."auditTestVersionId"=m2."auditTestVersionId" AND r2."datasetId"=m2."datasetId"
      JOIN "imported_records" ir2 ON ir2."datasetId"=m2."datasetId" AND ir2."sourceRowNo"=m2."sourceRowNo"
      JOIN "journal_lines" l2 ON l2."datasetId"=m2."datasetId" AND l2."importedRecordId"=ir2."id"
      WHERE m2."preparationId"=${preparationId} AND m2."auditTestVersionId"=${auditTestVersionId} AND r2."eligibility" <> 'NOT_ELIGIBLE'
        AND m2."datasetId" = g."datasetId"
        AND l2."transactionCurrency" COLLATE "C" = g."currency" COLLATE "C"
        AND ${sL2} = g."scalarNum"
      ORDER BY m2."datasetId" COLLATE "C" ASC, ir2."sourceRowNo" ASC
      LIMIT ${k}
    ) ev ON true
    ORDER BY g."datasetId" COLLATE "C" ASC, g."currency" COLLATE "C" ASC, g."scalarNum" ASC, ev."sourceRowNo" ASC NULLS LAST
  `);
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
