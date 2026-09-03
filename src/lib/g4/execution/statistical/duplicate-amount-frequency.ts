import type { TenantTx } from "@/lib/db/tenant";
import type { ExecutionContext, TestPin } from "../context";
import type { TestExecutor, ExecPageResult, ResultDescriptor, EvidenceRef } from "../contracts";
import { fetchEligiblePopulationFingerprints, fetchDuplicateAmountSignalPage, type DuplicateGroupFlatRow } from "../population";
import { canonicalize, dec } from "../canonical";
import { statAmountGroupIdentity } from "@/lib/g4/semantic-identity";
import { ExecutionError } from "../errors";
import { parseDuplicateConfig } from "./config";

/** Fixed evidence cap per (dataset,currency,scalar) group — bounded regardless of size. */
export const DUP_AMOUNT_EVIDENCE_K = 3;

interface DupGroup {
  datasetId: string; datasetHash: string; currency: string; scalar: string; occurrenceCount: number;
  evidence: Array<{ sourceRowNo: number; journalLineId: string; lineNo: number; eoiFrameHash: string }>;
}

/** Reassemble flattened (group × ≤K evidence) rows into distinct groups, preserving order. */
function groupRows(rows: DuplicateGroupFlatRow[]): DupGroup[] {
  const out: DupGroup[] = [];
  let cur: DupGroup | null = null;
  for (const r of rows) {
    if (!cur || cur.datasetId !== r.datasetId || cur.currency !== r.currency || cur.scalar !== r.scalar) {
      cur = { datasetId: r.datasetId, datasetHash: r.datasetHash, currency: r.currency, scalar: r.scalar, occurrenceCount: Number(r.occurrenceCount), evidence: [] };
      out.push(cur);
    }
    if (r.evJournalLineId !== null && r.evEoi !== null) {
      cur.evidence.push({ sourceRowNo: Number(r.evSourceRowNo), journalLineId: r.evJournalLineId, lineNo: Number(r.evLineNo), eoiFrameHash: r.evEoi });
    }
  }
  return out;
}

function glDatasetIds(ctx: ExecutionContext): string[] {
  return ctx.datasetPins.filter((d) => d.datasetKind === "GENERAL_LEDGER").map((d) => d.datasetId);
}

/**
 * ST_DUPLICATE_AMOUNT_FREQUENCY (C3). One neutral statistical signal per frozen
 * (dataset, transactionCurrency, scalar) group whose single-sided positive amount
 * repeats `>= minimumOccurrenceCount` times (exact NUMERIC equality). Group
 * eligibility is controlled SOLELY by minimumOccurrenceCount (no minimumPopulation).
 * occurrenceCount is the full DB-side group count; evidence is bounded to K=3.
 * Identity is scope-aware incl. the canonical scalar (g4statgrp.1). Signal only —
 * never a fraud claim.
 */
export const duplicateAmountFrequencyExecutor: TestExecutor = {
  testType: "STATISTICAL",
  kind: "DUPLICATE_AMOUNT_FREQUENCY",
  grain: "STAT_AMOUNT_GROUP",
  supportedDatasetKinds: ["GENERAL_LEDGER"],
  validateFrozenConfig(_ctx: ExecutionContext, pin: TestPin) { parseDuplicateConfig(pin.effectiveParametersJson); },
  async executePage(tx: TenantTx, ctx: ExecutionContext, pin: TestPin, cursor: unknown, batchSize: number): Promise<ExecPageResult> {
    const cfg = parseDuplicateConfig(pin.effectiveParametersJson);
    const dsIds = glDatasetIds(ctx);
    if (dsIds.length === 0) return { descriptors: [], cursor: null, reachedEnd: true };
    const after = (cursor as { datasetId: string; currency: string; scalar: string } | null) ?? null;
    const fps = await fetchEligiblePopulationFingerprints(tx, ctx.preparationId, pin.auditTestVersionId, dsIds);
    const rows = await fetchDuplicateAmountSignalPage(
      tx, ctx.preparationId, pin.auditTestVersionId, dsIds, cfg.minimumOccurrenceCount, after, batchSize, DUP_AMOUNT_EVIDENCE_K,
    );
    const groups = groupRows(rows);
    let last = after;
    const descriptors: ResultDescriptor[] = [];
    for (const g of groups) {
      last = { datasetId: g.datasetId, currency: g.currency, scalar: g.scalar };
      const fp = fps.get(g.datasetId);
      if (!fp) throw new ExecutionError("VALIDATION", true, `missing eligiblePopulationFingerprint for dataset ${g.datasetId}`);
      const identity = statAmountGroupIdentity({
        datasetHash: g.datasetHash, currency: g.currency, amountBasis: cfg.amountBasis, methodVersion: cfg.methodVersion,
        eligiblePopulationFingerprint: fp, scalarAmount: g.scalar,
      });
      const evidence: EvidenceRef[] = g.evidence.map((e) => ({
        evidenceType: "JOURNAL_LINE", datasetId: g.datasetId, sourceRowNo: e.sourceRowNo, journalLineId: e.journalLineId, lineNo: e.lineNo, eoiFrameHash: e.eoiFrameHash, role: "member",
      }));
      descriptors.push({
        resultKind: "STATISTICAL",
        resultCode: "ST_DUPLICATE_AMOUNT_DETECTED",
        severity: "LOW",
        payload: canonicalize({
          amountBasis: cfg.amountBasis, methodVersion: cfg.methodVersion, currency: g.currency,
          scalarAmount: dec(g.scalar), occurrenceCount: g.occurrenceCount, minimumOccurrenceCount: cfg.minimumOccurrenceCount,
        }),
        identityEOIs: [identity],
        evidence,
        consumedMappingSemanticHashes: [],
      });
    }
    return { descriptors, cursor: last, reachedEnd: groups.length < batchSize };
  },
};
