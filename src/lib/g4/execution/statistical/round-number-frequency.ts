import type { TenantTx } from "@/lib/db/tenant";
import type { ExecutionContext, TestPin } from "../context";
import type { TestExecutor, ExecPageResult, ResultDescriptor, EvidenceRef } from "../contracts";
import { fetchEligiblePopulationFingerprints, fetchRoundNumberSignalPage, type RoundGroupFlatRow } from "../population";
import { canonicalize, dec } from "../canonical";
import { statPopulationIdentity } from "@/lib/g4/semantic-identity";
import { ExecutionError } from "../errors";
import { parseRoundConfig } from "./config";

/** Fixed evidence cap per (dataset,currency) population — bounded regardless of size. */
export const ROUND_EVIDENCE_K = 3;

interface RoundGroup {
  datasetId: string; datasetHash: string; currency: string;
  eligibleCount: number; roundCount: number;
  evidence: Array<{ sourceRowNo: number; journalLineId: string; lineNo: number; eoiFrameHash: string }>;
}

/** Reassemble the flattened (group × ≤K evidence) rows into distinct groups, preserving order. */
function groupRows(rows: RoundGroupFlatRow[]): RoundGroup[] {
  const out: RoundGroup[] = [];
  let cur: RoundGroup | null = null;
  for (const r of rows) {
    if (!cur || cur.datasetId !== r.datasetId || cur.currency !== r.currency) {
      cur = { datasetId: r.datasetId, datasetHash: r.datasetHash, currency: r.currency, eligibleCount: Number(r.eligibleCount), roundCount: Number(r.roundCount), evidence: [] };
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
 * ST_ROUND_NUMBER_FREQUENCY (C3). One neutral statistical SIGNAL per frozen
 * (dataset, transactionCurrency) population whose single-sided positive amounts
 * are "round" (`mod(scalar, quantum)=0`) at a rate ≥ the frozen threshold. All
 * decision math is exact (integer counts, integer cross-multiply, exact NUMERIC
 * modulo — no JS float). Identity is scope-aware (g4statpop.1) so the same result
 * reproduces across re-imports and never collides across frozen scopes. Signal
 * only — never a fraud claim.
 */
export const roundNumberFrequencyExecutor: TestExecutor = {
  testType: "STATISTICAL",
  kind: "ROUND_NUMBER_FREQUENCY",
  grain: "STAT_CURRENCY_POP",
  supportedDatasetKinds: ["GENERAL_LEDGER"],
  validateFrozenConfig(_ctx: ExecutionContext, pin: TestPin) { parseRoundConfig(pin.effectiveParametersJson); },
  async executePage(tx: TenantTx, ctx: ExecutionContext, pin: TestPin, cursor: unknown, batchSize: number): Promise<ExecPageResult> {
    const cfg = parseRoundConfig(pin.effectiveParametersJson);
    const dsIds = glDatasetIds(ctx);
    if (dsIds.length === 0) return { descriptors: [], cursor: null, reachedEnd: true };
    const after = (cursor as { datasetId: string; currency: string } | null) ?? null;
    const fps = await fetchEligiblePopulationFingerprints(tx, ctx.preparationId, pin.auditTestVersionId, dsIds);
    const rows = await fetchRoundNumberSignalPage(
      tx, ctx.preparationId, pin.auditTestVersionId, dsIds,
      cfg.roundingQuantum, cfg.minimumPopulation, cfg.minimumRoundCount, cfg.rateThresholdNum, cfg.rateThresholdDenom,
      after, batchSize, ROUND_EVIDENCE_K,
    );
    const groups = groupRows(rows);
    let last = after;
    const descriptors: ResultDescriptor[] = [];
    for (const g of groups) {
      last = { datasetId: g.datasetId, currency: g.currency };
      const fp = fps.get(g.datasetId);
      if (!fp) throw new ExecutionError("VALIDATION", true, `missing eligiblePopulationFingerprint for dataset ${g.datasetId}`);
      const identity = statPopulationIdentity({
        datasetHash: g.datasetHash, currency: g.currency, amountBasis: cfg.amountBasis, methodVersion: cfg.methodVersion, eligiblePopulationFingerprint: fp,
      });
      const evidence: EvidenceRef[] = g.evidence.map((e) => ({
        evidenceType: "JOURNAL_LINE", datasetId: g.datasetId, sourceRowNo: e.sourceRowNo, journalLineId: e.journalLineId, lineNo: e.lineNo, eoiFrameHash: e.eoiFrameHash, role: "member",
      }));
      descriptors.push({
        resultKind: "STATISTICAL",
        resultCode: "ST_ROUND_NUMBER_RATE_EXCEEDED",
        severity: "INFO",
        payload: canonicalize({
          amountBasis: cfg.amountBasis, methodVersion: cfg.methodVersion, currency: g.currency,
          populationSize: g.eligibleCount, roundCount: g.roundCount, roundingQuantum: dec(cfg.roundingQuantum),
          rateThresholdNum: cfg.rateThresholdNum, rateThresholdDenom: cfg.rateThresholdDenom,
        }),
        identityEOIs: [identity],
        evidence,
        consumedMappingSemanticHashes: [],
      });
    }
    return { descriptors, cursor: last, reachedEnd: groups.length < batchSize };
  },
};
