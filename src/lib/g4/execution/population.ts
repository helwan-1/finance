import { Prisma } from "@prisma/client";
import type { TenantTx } from "@/lib/db/tenant";
import { EvidenceOutOfPopulationError } from "./errors";

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
