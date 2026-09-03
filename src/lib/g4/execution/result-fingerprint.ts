import { fingerprint, fields, seq, multiset, str, int } from "@/lib/g4/framing";
import { toFrame, type CanonicalNode } from "./canonical";

/**
 * g4occ.2 — RUN-LOCAL occurrence fingerprint (ADR-G4-C1-08). May use the
 * relational runId (occurrence identity is scoped to one run). Distinguishes
 * separate occurrences within a run; a retry re-deriving the same occurrence
 * yields the same value → the (auditFirmId, runId, resultOccurrenceFingerprint)
 * unique index dedups. Evidence EOIs are ordered and multiplicity-preserving.
 */
export function resultOccurrenceFingerprint(a: {
  runId: string;
  auditRunTestVersionId: string;
  resultCode: string;
  evidenceEOIsOrdered: string[];
}): string {
  return fingerprint("g4occ.2", fields([
    ["runId", str(a.runId)],
    ["auditRunTestVersionId", str(a.auditRunTestVersionId)],
    ["resultCode", str(a.resultCode)],
    ["evidence", seq(a.evidenceEOIsOrdered.map(str))],
  ]));
}

/**
 * g4sem.3 — CROSS-RUN semantic fingerprint (ADR-G4-C1-08). PK-free: built only
 * from reproducible semantic identities (scope anchor, test key/version/hash,
 * rule version hash, effective-parameters hash, consumed mapping semantic hashes,
 * result code, ordered evidence EOIs, canonical payload). Reproduces across
 * equivalent re-imports/runs/deployments; NON-unique (cross-run comparison).
 */
export function resultSemanticFingerprint(a: {
  semanticScopeAnchor: string;
  testKey: string;
  testVersion: number;
  testVersionHash: string;
  ruleVersionHash: string | null; // NULL for DATA_QUALITY (no rule dependency)
  effectiveParametersHash: string;
  consumedMappingSemanticHashes: string[];
  resultCode: string;
  evidenceEOIsOrdered: string[];
  payload: CanonicalNode;
}): string {
  return fingerprint("g4sem.3", fields([
    ["scopeAnchor", str(a.semanticScopeAnchor)],
    ["test", fields([
      ["key", str(a.testKey)],
      ["version", int(a.testVersion)],
      ["versionHash", str(a.testVersionHash)],
    ])],
    ["rule", str(a.ruleVersionHash)],
    ["effectiveParametersHash", str(a.effectiveParametersHash)],
    ["dependencies", multiset(a.consumedMappingSemanticHashes.map(str))],
    ["resultCode", str(a.resultCode)],
    ["evidence", seq(a.evidenceEOIsOrdered.map(str))],
    ["payload", toFrame(a.payload)],
  ]));
}
