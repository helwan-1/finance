import { Prisma } from "@prisma/client";
import type { TenantTx } from "@/lib/db/tenant";
import type { ExecutionContext, TestPin } from "../context";
import type { TestExecutor, ExecPageResult, ResultDescriptor } from "../contracts";
import type { Keyset } from "../population";
import { canonicalize } from "../canonical";

/**
 * DQ_SOURCE_TO_CANONICAL_MISMATCH (C2). Member grain. Compares the FROZEN
 * AuditRunScopeMember.contentHash against the authoritative immutable
 * ImportedRecord.rawHash for the exact member. A mismatch is a lineage/tamper
 * AuditResult (NOT an execution failure). Match → no result. Exhaustion is
 * measured over the full member population (predicate applied in JS).
 */
export const sourceToCanonicalExecutor: TestExecutor = {
  testType: "DATA_QUALITY",
  kind: "SOURCE_TO_CANONICAL_MISMATCH",
  grain: "IMPORTED_RECORD",
  supportedDatasetKinds: ["GENERAL_LEDGER", "TRIAL_BALANCE", "BANK", "OTHER"],
  validateFrozenConfig() { /* no external dependency */ },
  async executePage(tx: TenantTx, ctx: ExecutionContext, pin: TestPin, cursor: unknown, batchSize: number): Promise<ExecPageResult> {
    const after = (cursor as Keyset | null) ?? null;
    const keyset = after ? Prisma.sql`AND (m."datasetId", m."sourceRowNo") > (${after.datasetId}, ${after.sourceRowNo})` : Prisma.empty;
    const rows = await tx.$queryRaw<Array<{ datasetId: string; sourceRowNo: number; eoiFrameHash: string; contentHash: string; importedRecordId: string; rawHash: string }>>(Prisma.sql`
      SELECT m."datasetId" AS "datasetId", m."sourceRowNo" AS "sourceRowNo", m."eoiFrameHash" AS "eoiFrameHash",
             m."contentHash" AS "contentHash", ir."id" AS "importedRecordId", ir."rawHash" AS "rawHash"
      FROM "audit_run_scope_members" m
      JOIN "audit_run_scope_resolutions" r ON r."preparationId"=m."preparationId" AND r."auditTestVersionId"=m."auditTestVersionId" AND r."datasetId"=m."datasetId"
      JOIN "imported_records" ir ON ir."datasetId"=m."datasetId" AND ir."sourceRowNo"=m."sourceRowNo"
      WHERE m."preparationId"=${ctx.preparationId} AND m."auditTestVersionId"=${pin.auditTestVersionId} AND r."eligibility" <> 'NOT_ELIGIBLE'
        ${keyset}
      ORDER BY m."datasetId" ASC, m."sourceRowNo" ASC
      LIMIT ${batchSize}
    `);
    let last = after;
    const descriptors: ResultDescriptor[] = [];
    for (const x of rows) {
      const sourceRowNo = Number(x.sourceRowNo);
      last = { datasetId: x.datasetId, sourceRowNo };
      if (x.contentHash === x.rawHash) continue; // match → no finding
      descriptors.push({
        resultKind: "DATA_QUALITY",
        resultCode: "DQ_SOURCE_TO_CANONICAL_MISMATCH",
        severity: "HIGH",
        payload: canonicalize({ sourceRowNo, expectedRawHash: x.contentHash, actualRawHash: x.rawHash }),
        identityEOIs: [x.eoiFrameHash],
        evidence: [{ evidenceType: "IMPORTED_RECORD", datasetId: x.datasetId, sourceRowNo, importedRecordId: x.importedRecordId, eoiFrameHash: x.eoiFrameHash, role: "subject" }],
        consumedMappingSemanticHashes: [],
      });
    }
    return { descriptors, cursor: last, reachedEnd: rows.length < batchSize };
  },
};
