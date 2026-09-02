import type { RawCell } from "./canonical";
import type { DatasetKind } from "./vocab";
import { INGEST_FIELDS } from "./vocab";

/**
 * Column → canonical-ingestion-field mapping. Aliases only SUGGEST a mapping;
 * the mapping that is used is persisted as an immutable ImportMappingVersion
 * (Closure C: not hardcoded aliases applied at runtime).
 */
const ALIASES: Record<DatasetKind, Record<string, string>> = {
  GENERAL_LEDGER: {
    "account": "accountCode", "accountcode": "accountCode", "account code": "accountCode",
    "gl account": "accountCode", "الحساب": "accountCode", "رقم الحساب": "accountCode",
    "account name": "accountName", "اسم الحساب": "accountName",
    "posting date": "postingDate", "postingdate": "postingDate", "date": "postingDate",
    "التاريخ": "postingDate", "تاريخ القيد": "postingDate",
    "document date": "documentDate", "تاريخ المستند": "documentDate",
    "debit": "debit", "مدين": "debit", "credit": "credit", "دائن": "credit",
    "amount": "amount", "المبلغ": "amount", "القيمة": "amount",
    "currency": "currency", "العملة": "currency",
    "description": "description", "الوصف": "description", "البيان": "description",
    "counterparty": "counterparty", "vendor": "counterparty", "الطرف": "counterparty",
    "الطرف المقابل": "counterparty",
    "reference": "reference", "ref": "reference", "المرجع": "reference",
    "document number": "documentNumber", "voucher": "documentNumber", "رقم المستند": "documentNumber",
    "cost center": "costCenter", "مركز التكلفة": "costCenter",
    "profit center": "profitCenter", "مركز الربح": "profitCenter",
    "user": "userId", "userid": "userId", "المستخدم": "userId",
    "source": "sourceType", "المصدر": "sourceType",
  },
  TRIAL_BALANCE: {
    "account": "accountCode", "accountcode": "accountCode", "الحساب": "accountCode", "رقم الحساب": "accountCode",
    "account name": "accountName", "اسم الحساب": "accountName",
    "opening debit": "openingDebit", "رصيد افتتاحي مدين": "openingDebit",
    "opening credit": "openingCredit", "رصيد افتتاحي دائن": "openingCredit",
    "period debit": "periodDebit", "حركة مدين": "periodDebit",
    "period credit": "periodCredit", "حركة دائن": "periodCredit",
    "closing debit": "closingDebit", "رصيد ختامي مدين": "closingDebit",
    "closing credit": "closingCredit", "رصيد ختامي دائن": "closingCredit",
    "currency": "currency", "العملة": "currency",
  },
  BANK: {
    "transaction date": "transactionDate", "date": "transactionDate", "تاريخ العملية": "transactionDate", "التاريخ": "transactionDate",
    "value date": "valueDate", "تاريخ القيمة": "valueDate",
    "amount": "amount", "المبلغ": "amount",
    "currency": "currency", "العملة": "currency",
    "description": "description", "الوصف": "description",
    "reference": "reference", "المرجع": "reference",
    "counterparty": "counterparty", "الطرف": "counterparty",
    "bank account": "bankAccount", "رقم الحساب البنكي": "bankAccount",
  },
  OTHER: {},
};

/** Suggest a mapping (originalHeader → canonicalField) from the file's headers. */
export function suggestMapping(
  kind: DatasetKind,
  headers: (string | null)[],
): Record<string, string> {
  const out: Record<string, string> = {};
  const table = ALIASES[kind];
  for (const h of headers) {
    if (!h) continue;
    const target = table[h.trim().toLowerCase()];
    if (target && INGEST_FIELDS[kind][target]) out[h] = target;
  }
  return out;
}

export interface MappingIssue {
  field: string | null;
  code: string;
  message: string;
  rawValue: string | null;
}

/** Apply a mapping to one row's positional cells → canonicalField → value. */
export function applyMapping(
  cells: RawCell[],
  mapJson: Record<string, string>,
): { mapped: Record<string, string | null>; issues: MappingIssue[] } {
  const mapped: Record<string, string | null> = {};
  const assignedBy: Record<string, number> = {};
  const issues: MappingIssue[] = [];
  for (const c of [...cells].sort((a, b) => a.i - b.i)) {
    if (c.h === null) continue;
    const field = mapJson[c.h];
    if (!field) continue;
    if (field in assignedBy && assignedBy[field] !== c.i) {
      issues.push({
        field,
        code: "DUPLICATE_SOURCE_COLUMN",
        message: `Field ${field} mapped from multiple source columns; kept column ${assignedBy[field]}`,
        rawValue: c.v,
      });
      continue;
    }
    mapped[field] = c.v;
    assignedBy[field] = c.i;
  }
  return { mapped, issues };
}
