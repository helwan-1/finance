import { canonicalize, type CanonicalNode } from "../canonical";
import type { FrozenMember } from "../population";

/**
 * DQ_POPULATION_MEMBER (ADR-G4-C1-10) — the C1 infrastructure-proof test. The
 * simplest deterministic imported-record-grain DATA_QUALITY predicate: attest
 * each frozen population member as one immutable result with exactly one
 * evidence occurrence. Grouping is deliberately avoided so every unit stays
 * bounded-memory. Not commercially useful — it exercises the whole pipeline
 * (frozen consumption, result creation, 1:1 evidence, g4occ.2/g4sem.3, retry
 * idempotency, lease fencing, keyset-exhaustion completion).
 */
export const DQ_POPULATION_MEMBER_CODE = "DQ_POPULATION_MEMBER";
/** definitionJson discriminator that selects this test in the executor. */
export const DQ_POPULATION_MEMBER_KIND = "POPULATION_MEMBER";

export interface EvidenceRef {
  evidenceType: "IMPORTED_RECORD";
  importedRecordId: string;
  datasetId: string;
  sourceRowNo: number;
  eoiFrameHash: string;
}

export interface ResultDescriptor {
  resultCode: string;
  payload: CanonicalNode;
  evidence: EvidenceRef[]; // ordered; multiplicity-preserving
  consumedMappingSemanticHashes: string[];
}

/** One member → one result with one IMPORTED_RECORD evidence occurrence. */
export function evaluatePopulationMember(member: FrozenMember): ResultDescriptor {
  return {
    resultCode: DQ_POPULATION_MEMBER_CODE,
    payload: canonicalize({ sourceRowNo: member.sourceRowNo, contentHash: member.contentHash }),
    evidence: [{
      evidenceType: "IMPORTED_RECORD",
      importedRecordId: member.importedRecordId,
      datasetId: member.datasetId,
      sourceRowNo: member.sourceRowNo,
      eoiFrameHash: member.eoiFrameHash,
    }],
    consumedMappingSemanticHashes: [], // C1 test consumes no account mapping
  };
}
