import type { Prisma } from "@prisma/client";
import type { TenantTx } from "@/lib/db/tenant";
import type { RawCell } from "@/lib/import/canonical";
import { applyMapping } from "@/lib/import/mapping";
import type { DatasetKind } from "@/lib/import/vocab";
import { resolveSourceIdentity, type SourceIdentity, type SourceIdentityMap } from "./source-identity";
import { parseCanonicalDecimal, decimalToMicros, microsToDecimalString } from "./decimal";

/**
 * Amount-only debit/credit direction (F1). Deriving a side from a single signed
 * amount is legitimate ONLY under an explicitly configured, frozen convention;
 * without it, direction is NOT fabricated (both sides null; magnitude stays
 * recoverable via the linked ImportedRecord.rawCells).
 */
export type AmountSignConvention = "POSITIVE_DEBIT_NEGATIVE_CREDIT" | "POSITIVE_CREDIT_NEGATIVE_DEBIT";

/**
 * G3 canonical accounting creation (Phase B). Runs INSIDE the successful import
 * transaction (construct-then-finalize) so a fault rolls back every canonical
 * fact atomically with the G2 bridge (Section K / test 17). Source facts only —
 * masters and account mapping are auditor actions, not import side effects.
 *
 * GL  → SourceAccountingContext + DatasetAccount + JournalEntry (SOURCE_ASSERTED
 *       only; never synthesized) + JournalLine (journalEntryId NULL when no
 *       reliable source entry id).
 * TB  → SourceAccountingContext + DatasetAccount + TrialBalance + TrialBalanceRow.
 * BANK/OTHER → nothing (bridge-only / evidence-only).
 */

export interface CanonicalRecord {
  id: string;
  sourceRowNo: number;
  rawCells: RawCell[];
  normalizedJson: Record<string, string | null> | null;
  status: "ACCEPTED" | "ACCEPTED_WITH_WARNING" | "REJECTED";
}

export interface CanonicalInput {
  auditFirmId: string;
  engagementId: string;
  clientCompanyId: string | null;
  datasetId: string;
  kind: DatasetKind;
  mapJson: Record<string, string>;
  records: CanonicalRecord[];
  /** Frozen import provenance (from ImportBatch.effectiveProfileJson.g3). */
  amountSignConvention?: AmountSignConvention | null;
  sourceIdentityMap?: SourceIdentityMap | null;
}

export interface CanonicalResult {
  contexts: number;
  datasetAccounts: number;
  journalEntries: number;
  journalLines: number;
  trialBalances: number;
  trialBalanceRows: number;
}

const ZERO: CanonicalResult = {
  contexts: 0, datasetAccounts: 0, journalEntries: 0,
  journalLines: 0, trialBalances: 0, trialBalanceRows: 0,
};

interface Prepared {
  rec: CanonicalRecord;
  mapped: Record<string, string | null>;
  norm: Record<string, string | null>;
  si: SourceIdentity;
  ctxKey: string;
  accKey: string;
}

const ctxTuple = (si: SourceIdentity) =>
  JSON.stringify([si.sourceSystem, si.sourceEntity, si.sourceLedger]);

interface BalanceLine {
  transactionDebit: string | null;
  transactionCredit: string | null;
  transactionCurrency: string | null;
  functionalDebit: string | null;
  functionalCredit: string | null;
  functionalCurrency: string | null;
}

interface BalanceResult {
  capability: "AVAILABLE" | "PARTIAL" | "NOT_AVAILABLE";
  status: "BALANCED" | "UNBALANCED" | "NOT_EVALUABLE" | null;
  basis: "TRANSACTION" | "FUNCTIONAL" | null;
  currency: string | null;
  debitTotal: string | null;
  creditTotal: string | null;
  difference: string | null;
}

/**
 * Currency-safe balance (C6 / ADR-G3-03). AVAILABLE only when every line
 * carrying an amount shares ONE comparable monetary basis (all transaction
 * amounts in one transaction currency, OR all functional amounts in one
 * functional currency). Mixed currencies never produce a total.
 */
export function computeBalance(lines: BalanceLine[]): BalanceResult {
  const totalsFor = (side: "debit" | "credit", basis: "txn" | "func"): string => {
    let m = 0n;
    for (const l of lines) {
      const v = basis === "txn"
        ? (side === "debit" ? l.transactionDebit : l.transactionCredit)
        : (side === "debit" ? l.functionalDebit : l.functionalCredit);
      if (v != null) m += decimalToMicros(v);
    }
    return microsToDecimalString(m);
  };

  const relevantTxn = lines.filter((l) => l.transactionDebit != null || l.transactionCredit != null);
  const txnCurrencies = new Set(relevantTxn.map((l) => l.transactionCurrency));
  const txnComparable = relevantTxn.length > 0 && txnCurrencies.size === 1 && !txnCurrencies.has(null);

  const relevantFunc = lines.filter((l) => l.functionalDebit != null || l.functionalCredit != null);
  const funcCurrencies = new Set(relevantFunc.map((l) => l.functionalCurrency));
  const funcComparable = relevantFunc.length > 0 && relevantFunc.length === relevantTxn.length
    && funcCurrencies.size === 1 && !funcCurrencies.has(null);

  const settle = (basis: "TRANSACTION" | "FUNCTIONAL", currency: string): BalanceResult => {
    const d = totalsFor("debit", basis === "TRANSACTION" ? "txn" : "func");
    const c = totalsFor("credit", basis === "TRANSACTION" ? "txn" : "func");
    const diff = microsToDecimalString(decimalToMicros(d) - decimalToMicros(c));
    return {
      capability: "AVAILABLE",
      status: decimalToMicros(diff) === 0n ? "BALANCED" : "UNBALANCED",
      basis, currency, debitTotal: d, creditTotal: c, difference: diff,
    };
  };

  if (txnComparable) return settle("TRANSACTION", [...txnCurrencies][0]!);
  if (funcComparable) return settle("FUNCTIONAL", [...funcCurrencies][0]!);
  // Some comparable evidence exists but not a single common basis → PARTIAL;
  // no monetary information at all → NOT_AVAILABLE. Never a misleading total.
  const capability = txnCurrencies.size > 1 ? "PARTIAL" : "NOT_AVAILABLE";
  return { capability, status: "NOT_EVALUABLE", basis: null, currency: null, debitTotal: null, creditTotal: null, difference: null };
}

/**
 * GL line monetary sides (F1). Explicit source debit/credit columns always win.
 * A single signed `amount` is split into a side ONLY under an explicit, frozen
 * sign convention; with NO convention the direction is left unknown (both null)
 * rather than fabricated — the exact magnitude remains recoverable from the
 * ImportedRecord raw cells via lineage.
 */
function txnSides(
  mapped: Record<string, string | null>, convention: AmountSignConvention | null | undefined,
): { debit: string | null; credit: string | null } {
  const debit = parseCanonicalDecimal(mapped.debit);
  const credit = parseCanonicalDecimal(mapped.credit);
  if (debit != null || credit != null) return { debit, credit };
  const amount = parseCanonicalDecimal(mapped.amount);
  if (amount == null || !convention) return { debit: null, credit: null };
  const neg = amount.startsWith("-");
  const mag = neg ? amount.slice(1) : amount;
  if (convention === "POSITIVE_DEBIT_NEGATIVE_CREDIT") {
    return neg ? { debit: null, credit: mag } : { debit: mag, credit: null };
  }
  // POSITIVE_CREDIT_NEGATIVE_DEBIT
  return neg ? { debit: mag, credit: null } : { debit: null, credit: mag };
}

export async function createCanonicalAccounting(
  tx: TenantTx, input: CanonicalInput,
): Promise<CanonicalResult> {
  if (input.kind !== "GENERAL_LEDGER" && input.kind !== "TRIAL_BALANCE") return ZERO;

  const accepted = input.records.filter((r) => r.status !== "REJECTED" && r.normalizedJson);
  if (accepted.length === 0) return ZERO;

  const prepared: Prepared[] = accepted.map((rec) => {
    const { mapped } = applyMapping(rec.rawCells, input.mapJson);
    const norm = (rec.normalizedJson ?? {}) as Record<string, string | null>;
    const si = resolveSourceIdentity(rec.rawCells, input.sourceIdentityMap ?? null);
    return { rec, mapped, norm, si, ctxKey: ctxTuple(si), accKey: "" };
  });

  // 1) SourceAccountingContext — one per distinct (system, entity, ledger).
  const ctxIds = new Map<string, string>();
  for (const p of prepared) {
    if (ctxIds.has(p.ctxKey)) continue;
    const created = await tx.sourceAccountingContext.create({
      data: {
        auditFirmId: input.auditFirmId, datasetId: input.datasetId,
        sourceSystem: p.si.sourceSystem, sourceSystemVersion: p.si.sourceSystemVersion,
        sourceEntity: p.si.sourceEntity, sourceLedger: p.si.sourceLedger,
        capturedFrom: "ROW",
      },
      select: { id: true },
    });
    ctxIds.set(p.ctxKey, created.id);
  }

  // 2) DatasetAccount — one per distinct (context, sourceAccountCode).
  const daIds = new Map<string, string>();
  const daAgg = new Map<string, { code: string; name: string | null; ctxId: string; firstRec: string; count: number }>();
  for (const p of prepared) {
    const code = (p.norm.accountCode ?? "").trim();
    if (!code) continue; // GL & TB require accountCode; guarded upstream
    const ctxId = ctxIds.get(p.ctxKey)!;
    const key = JSON.stringify([ctxId, code]);
    p.accKey = key;
    const agg = daAgg.get(key);
    if (agg) agg.count += 1;
    else daAgg.set(key, { code, name: p.norm.accountName ?? null, ctxId, firstRec: p.rec.id, count: 1 });
  }
  for (const [key, a] of daAgg) {
    const created = await tx.datasetAccount.create({
      data: {
        auditFirmId: input.auditFirmId, datasetId: input.datasetId,
        sourceAccountingContextId: a.ctxId, sourceAccountCode: a.code,
        sourceAccountName: a.name, firstImportedRecordId: a.firstRec, occurrenceCount: a.count,
      },
      select: { id: true },
    });
    daIds.set(key, created.id);
  }

  if (input.kind === "TRIAL_BALANCE") {
    return createTrialBalance(tx, input, prepared, ctxIds, daIds);
  }
  return createJournal(tx, input, prepared, ctxIds, daIds);
}

async function createJournal(
  tx: TenantTx, input: CanonicalInput, prepared: Prepared[],
  ctxIds: Map<string, string>, daIds: Map<string, string>,
): Promise<CanonicalResult> {
  // Group by SOURCE-ASSERTED entry id only (D3/C1). No entry id → NULL parent.
  const groups = new Map<string, Prepared[]>();
  for (const p of prepared) {
    const eid = p.si.sourceEntryId;
    if (!eid) continue;
    (groups.get(eid) ?? groups.set(eid, []).get(eid)!).push(p);
  }

  // Build the per-record line payloads first (needed for entry balance).
  const linePayload = (p: Prepared, journalEntryId: string | null, lineNo: number): Prisma.JournalLineCreateManyInput => {
    const { debit, credit } = txnSides(p.mapped, input.amountSignConvention ?? null);
    const cap: "EXPLICIT_ENTRY_AND_LINE_ID" | "EXPLICIT_ENTRY_ID" | "NO_RELIABLE_ENTRY_ID" =
      p.si.sourceEntryId ? (p.si.sourceLineId ? "EXPLICIT_ENTRY_AND_LINE_ID" : "EXPLICIT_ENTRY_ID") : "NO_RELIABLE_ENTRY_ID";
    return {
      auditFirmId: input.auditFirmId, datasetId: input.datasetId, journalEntryId, lineNo,
      accountSnapshotId: daIds.get(p.accKey)!,
      transactionDebit: debit, transactionCredit: credit,
      transactionCurrency: p.norm.currency ?? null,
      functionalDebit: parseCanonicalDecimal(p.si.functionalDebit),
      functionalCredit: parseCanonicalDecimal(p.si.functionalCredit),
      functionalCurrency: p.si.functionalCurrency,
      exchangeRate: parseCanonicalDecimal(p.si.exchangeRate),
      exchangeRateSource: p.si.exchangeRateSource,
      costCenter: p.norm.costCenter ?? null, profitCenter: p.norm.profitCenter ?? null,
      counterparty: p.norm.counterparty ?? null, description: p.norm.description ?? null,
      reference: p.norm.reference ?? null, documentNumber: p.norm.documentNumber ?? null,
      postedByUserId: p.norm.userId ?? null, sourceType: p.norm.sourceType ?? null,
      sourceLineId: p.si.sourceLineId, groupingCapability: cap,
      importedRecordId: p.rec.id,
    };
  };

  const lines: Prisma.JournalLineCreateManyInput[] = [];
  let entries = 0;

  // Grouped (source-asserted) entries.
  for (const [eid, members] of groups) {
    const first = members[0]!;
    const hasLineId = members.some((m) => m.si.sourceLineId);
    // Provisional line payloads (journalEntryId filled after entry insert).
    const provisional = members.map((m, i) => linePayload(m, null, i + 1));
    const bal = computeBalance(provisional.map((l) => ({
      transactionDebit: l.transactionDebit as string | null, transactionCredit: l.transactionCredit as string | null,
      transactionCurrency: l.transactionCurrency ?? null,
      functionalDebit: l.functionalDebit as string | null, functionalCredit: l.functionalCredit as string | null,
      functionalCurrency: l.functionalCurrency ?? null,
    })));
    const entry = await tx.journalEntry.create({
      data: {
        auditFirmId: input.auditFirmId, engagementId: input.engagementId, clientCompanyId: input.clientCompanyId,
        datasetId: input.datasetId, sourceAccountingContextId: ctxIds.get(first.ctxKey)!,
        sourceEntryId: eid, sourceJournal: first.si.sourceJournal, sourceDocumentId: first.si.sourceDocumentId,
        sourceDocumentNumber: first.norm.documentNumber ?? null,
        entryDate: first.norm.postingDate ? new Date(first.norm.postingDate) : null,
        groupingBasis: hasLineId ? "SOURCE_ASSERTED_ENTRY_LINE" : "SOURCE_ASSERTED_ENTRY",
        balanceCapability: bal.capability, balanceStatus: bal.status ?? undefined,
        monetaryBasis: bal.basis ?? undefined, balanceCurrency: bal.currency,
        debitTotal: bal.debitTotal, creditTotal: bal.creditTotal, difference: bal.difference,
      },
      select: { id: true },
    });
    entries += 1;
    members.forEach((m, i) => lines.push(linePayload(m, entry.id, i + 1)));
  }

  // Ungrouped (NO_RELIABLE_ENTRY_ID) → standalone canonical lines, NULL parent.
  for (const p of prepared) {
    if (p.si.sourceEntryId) continue;
    lines.push(linePayload(p, null, p.rec.sourceRowNo));
  }

  if (lines.length) await tx.journalLine.createMany({ data: lines });

  return {
    contexts: ctxIds.size, datasetAccounts: daIds.size, journalEntries: entries,
    journalLines: lines.length, trialBalances: 0, trialBalanceRows: 0,
  };
}

async function createTrialBalance(
  tx: TenantTx, input: CanonicalInput, prepared: Prepared[],
  ctxIds: Map<string, string>, daIds: Map<string, string>,
): Promise<CanonicalResult> {
  const first = prepared[0]!;
  const tb = await tx.trialBalance.create({
    data: {
      auditFirmId: input.auditFirmId, engagementId: input.engagementId, clientCompanyId: input.clientCompanyId,
      datasetId: input.datasetId, sourceAccountingContextId: ctxIds.get(first.ctxKey)!,
      currency: first.norm.currency ?? null,
    },
    select: { id: true },
  });

  const rows: Prisma.TrialBalanceRowCreateManyInput[] = prepared
    .filter((p) => p.accKey)
    .map((p) => ({
      auditFirmId: input.auditFirmId, datasetId: input.datasetId, trialBalanceId: tb.id,
      accountSnapshotId: daIds.get(p.accKey)!,
      openingDebit: parseCanonicalDecimal(p.mapped.openingDebit),
      openingCredit: parseCanonicalDecimal(p.mapped.openingCredit),
      periodDebit: parseCanonicalDecimal(p.mapped.periodDebit),
      periodCredit: parseCanonicalDecimal(p.mapped.periodCredit),
      closingDebit: parseCanonicalDecimal(p.mapped.closingDebit),
      closingCredit: parseCanonicalDecimal(p.mapped.closingCredit),
      currency: p.norm.currency ?? null,
      importedRecordId: p.rec.id,
    }));
  if (rows.length) await tx.trialBalanceRow.createMany({ data: rows });

  return {
    contexts: ctxIds.size, datasetAccounts: daIds.size, journalEntries: 0,
    journalLines: 0, trialBalances: 1, trialBalanceRows: rows.length,
  };
}
