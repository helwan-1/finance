import type { RawCell } from "@/lib/import/canonical";

/**
 * G3 structured source-identity capture (D6 / ADR-G3-06, hardened per F2).
 *
 * Source identity is resolved ONLY from an EXPLICIT header→field mapping that is
 * persisted/frozen on the ImportBatch (effectiveProfileJson.g3.sourceIdentityMap)
 * at start and reused verbatim on every attempt (reproducible). A merely
 * detected header alias is a CANDIDATE suggestion — never silently promoted to
 * trusted SOURCE_ASSERTED identity. Nothing is inferred from filename,
 * `reference`, or `rawHash`, and `documentNumber` is never treated as an entry
 * id. Absent mapping → all fields null (→ NO_RELIABLE_ENTRY_ID).
 */
export interface SourceIdentity {
  sourceEntryId: string | null;
  sourceLineId: string | null;
  sourceJournal: string | null;
  sourceEntity: string | null;
  sourceLedger: string | null;
  sourceSystem: string | null;
  sourceSystemVersion: string | null;
  sourceDocumentId: string | null;
  functionalDebit: string | null;
  functionalCredit: string | null;
  functionalCurrency: string | null;
  exchangeRate: string | null;
  exchangeRateSource: string | null;
}

const FIELDS: (keyof SourceIdentity)[] = [
  "sourceEntryId", "sourceLineId", "sourceJournal", "sourceEntity", "sourceLedger",
  "sourceSystem", "sourceSystemVersion", "sourceDocumentId",
  "functionalDebit", "functionalCredit", "functionalCurrency", "exchangeRate", "exchangeRateSource",
];

function empty(): SourceIdentity {
  return {
    sourceEntryId: null, sourceLineId: null, sourceJournal: null, sourceEntity: null, sourceLedger: null,
    sourceSystem: null, sourceSystemVersion: null, sourceDocumentId: null,
    functionalDebit: null, functionalCredit: null, functionalCurrency: null, exchangeRate: null, exchangeRateSource: null,
  };
}

/** header→field mapping used by the ImportAttempt (frozen provenance). */
export type SourceIdentityMap = Record<string, string>;

/**
 * Resolve identity by applying the EXPLICIT frozen map (header→field) to this
 * row's raw cells. Only fields the map names are populated; everything else
 * stays null. Case-insensitive header match; unknown fields ignored.
 */
export function resolveSourceIdentity(cells: RawCell[], map: SourceIdentityMap | null | undefined): SourceIdentity {
  const out = empty();
  if (!map) return out;
  const known = new Set<string>(FIELDS as string[]);
  for (const [header, field] of Object.entries(map)) {
    if (!known.has(field)) continue;
    const cell = cells.find((c) => c.h != null && c.h.trim().toLowerCase() === header.trim().toLowerCase());
    const v = cell?.v?.trim();
    if (v) (out as unknown as Record<string, string | null>)[field] = v;
  }
  return out;
}

/**
 * CANDIDATE-only suggestion of a source-identity map from headers (never applied
 * in the trust path). An auditor/caller reviews and freezes it as the explicit
 * map; without that, detection alone must not create SOURCE_ASSERTED identity.
 */
const ALIASES: Record<string, string[]> = {
  sourceEntryId: ["entry id", "journal entry id", "je id", "voucher id", "voucher no", "رقم القيد", "معرف القيد", "رقم السند"],
  sourceLineId: ["line id", "line no", "line number", "بند", "رقم البند", "معرف السطر", "رقم السطر"],
  sourceJournal: ["journal", "journal name", "journal code", "دفتر اليومية", "اليومية"],
  sourceEntity: ["entity", "company code", "company", "الكيان", "رمز الشركة", "الشركة", "المنشأة"],
  sourceLedger: ["ledger", "ledger id", "ledger code", "الأستاذ", "دفتر الأستاذ"],
  sourceSystem: ["source system", "erp", "system", "النظام", "نظام المصدر"],
  sourceSystemVersion: ["system version", "erp version", "إصدار النظام"],
  sourceDocumentId: ["document id", "doc id", "معرف المستند"],
  functionalDebit: ["functional debit", "base debit", "مدين وظيفي", "مدين بالعملة الأساسية"],
  functionalCredit: ["functional credit", "base credit", "دائن وظيفي", "دائن بالعملة الأساسية"],
  functionalCurrency: ["functional currency", "base currency", "العملة الوظيفية", "العملة الأساسية"],
  exchangeRate: ["exchange rate", "fx rate", "rate", "سعر الصرف"],
  exchangeRateSource: ["rate source", "fx source", "مصدر سعر الصرف"],
};

export function suggestSourceIdentityMap(headers: (string | null)[]): SourceIdentityMap {
  const out: SourceIdentityMap = {};
  for (const h of headers) {
    if (!h) continue;
    const key = h.trim().toLowerCase();
    for (const [field, set] of Object.entries(ALIASES)) {
      if (set.includes(key)) { out[h] = field; break; }
    }
  }
  return out;
}
