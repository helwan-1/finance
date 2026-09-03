import { fingerprint, framed, seq, fields, str, int, hashHex } from "./framing";

/**
 * G4 semantic identities (C7/C9). Built ONLY from reproducible content/natural
 * keys — never database row PKs. Two semantically-equivalent things across
 * different DB rows / runs / deployments produce identical identities.
 */

/**
 * Evidence Occurrence Identity for an ImportedRecord (C7). Uses only proven G2
 * fields: datasetHash (reproducible content id) + sourceRowNo (source-location
 * discriminator, positional & deterministic) + rawHash (integrity). Two rows
 * with identical rawHash but different sourceRowNo yield DIFFERENT EOIs.
 */
export function importedRecordEOI(a: { datasetHash: string; sourceRowNo: number; rawHash: string }): string {
  return fingerprint("g4eoi.1", seq([str(a.datasetHash), int(a.sourceRowNo), str(a.rawHash)]));
}

/** Reproducible semantic identity of a DatasetAccount (per-dataset source account). */
export function datasetAccountSemanticId(a: {
  datasetHash: string;
  sourceSystem: string | null;
  sourceEntity: string | null;
  sourceLedger: string | null;
  sourceAccountCode: string;
}): string {
  return fingerprint("g4da.1", fields([
    ["datasetHash", str(a.datasetHash)],
    ["sourceSystem", str(a.sourceSystem)],
    ["sourceEntity", str(a.sourceEntity)],
    ["sourceLedger", str(a.sourceLedger)],
    ["sourceAccountCode", str(a.sourceAccountCode)],
  ]));
}

/**
 * G4-owned frozen dependency hash for a consumed AccountMappingVersion (g4map.1).
 * Over immutable G3 fields only: the dataset-account semantic id, the mapping
 * version's monotonic version, its basis, and the TARGET account's semantic key
 * (AccountingScope.key + Account.accountCode). No G3 row PK enters the hash.
 */
export function mappingSemanticHash(a: {
  datasetAccountSemanticId: string;
  mappingVersion: number;
  basis: string;
  accountingScopeKey: string;
  accountCode: string;
}): string {
  return fingerprint("g4map.1", fields([
    ["datasetAccount", str(a.datasetAccountSemanticId)],
    ["mappingVersion", int(a.mappingVersion)],
    ["basis", str(a.basis)],
    ["targetAccount", str(accountSemanticKey({ accountingScopeKey: a.accountingScopeKey, accountCode: a.accountCode }))],
  ]));
}

/** Target-account semantic key (natural keys only). */
export function accountSemanticKey(a: { accountingScopeKey: string; accountCode: string }): string {
  return fingerprint("g4acct.1", fields([
    ["scopeKey", str(a.accountingScopeKey)],
    ["accountCode", str(a.accountCode)],
  ]));
}

/**
 * Journal-entry occurrence identity (g4je.1 · C2). PK-free: the reproducible
 * dataset content id + the source-asserted entry id (unique per dataset). Same
 * content re-imported → same EOI; same sourceEntryId in a different dataset →
 * different EOI (different datasetHash). NO_RELIABLE_ENTRY_ID lines never reach
 * this (they have no JournalEntry). groupingBasis is a property, not identity.
 */
export function journalEntryEOI(a: { datasetHash: string; sourceEntryId: string }): string {
  return fingerprint("g4je.1", fields([
    ["datasetHash", str(a.datasetHash)],
    ["sourceEntryId", str(a.sourceEntryId)],
  ]));
}

/**
 * Semantic scope anchor (g4scope.1) — firm licenseNo (unique, non-null) + the
 * G4-owned immutable client semantic key (never a cuid) + engagement fiscalYear.
 */
export function semanticScopeAnchor(a: { firmLicenseNo: string; clientSemanticKey: string; fiscalYear: number }): string {
  return fingerprint("g4scope.1", fields([
    ["firmLicenseNo", str(a.firmLicenseNo)],
    ["clientSemanticKey", str(a.clientSemanticKey)],
    ["fiscalYear", int(a.fiscalYear)],
  ]));
}

/**
 * Scope-aware statistical POPULATION identity (g4statpop.1 · C3). PK-free: the
 * reproducible dataset content id + the exact (never normalized) transaction
 * currency + amountBasis + methodVersion + the frozen eligiblePopulationFingerprint
 * (g4pop.2). The population fingerprint distinguishes two frozen scopes over the
 * SAME dataset+currency, so their signals never collide; a re-import of identical
 * content reproduces every input → identical identity. Authoritative config
 * (quantum, rate thresholds) enters semantic identity separately via
 * effectiveParametersHash (g4param.1), so it is intentionally NOT folded here.
 */
export function statPopulationIdentity(a: {
  datasetHash: string;
  currency: string;
  amountBasis: string;
  methodVersion: string;
  eligiblePopulationFingerprint: string;
}): string {
  return fingerprint("g4statpop.1", fields([
    ["datasetHash", str(a.datasetHash)],
    ["currency", str(a.currency)],
    ["amountBasis", str(a.amountBasis)],
    ["methodVersion", str(a.methodVersion)],
    ["eligiblePopulationFingerprint", str(a.eligiblePopulationFingerprint)],
  ]));
}

/**
 * Scope-aware statistical GROUP identity (g4statgrp.1 · C3). As g4statpop.1 plus
 * the canonical scalar amount (exact fixed-point string, never a float), so each
 * duplicate-amount group within a (dataset, currency) population has a distinct,
 * reproducible identity.
 */
export function statAmountGroupIdentity(a: {
  datasetHash: string;
  currency: string;
  amountBasis: string;
  methodVersion: string;
  eligiblePopulationFingerprint: string;
  scalarAmount: string;
}): string {
  return fingerprint("g4statgrp.1", fields([
    ["datasetHash", str(a.datasetHash)],
    ["currency", str(a.currency)],
    ["amountBasis", str(a.amountBasis)],
    ["methodVersion", str(a.methodVersion)],
    ["eligiblePopulationFingerprint", str(a.eligiblePopulationFingerprint)],
    ["scalarAmount", str(a.scalarAmount)],
  ]));
}

/** Deterministic hash of a resolved effective-parameters object (sorted keys). */
export function effectiveParametersHash(params: Record<string, unknown>): string {
  const pairs: Array<[string, Buffer]> = Object.entries(params).map(([k, v]) => [k, str(v === null || v === undefined ? null : String(v))]);
  return fingerprint("g4param.1", fields(pairs));
}

export { framed, hashHex };
