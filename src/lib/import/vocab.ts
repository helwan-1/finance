/**
 * G2 ingestion vocabulary (Closure C9) — these are INGESTION targets only, not
 * the G3 Canonical Accounting Model. Validation below is ingestion-only
 * (presence + parseability); no balancing / reconciliation / derivation.
 */
export type DatasetKind = "GENERAL_LEDGER" | "TRIAL_BALANCE" | "BANK" | "OTHER";

export const TARGET_FIELD_SET_VERSION = "g2.1";
export const PARSER_VERSION = "g2.1";
export const NORMALIZER_VERSION = "g2.1";

type FieldType = "string" | "date" | "decimal";

/** Canonical ingestion fields per kind, with parse type. */
export const INGEST_FIELDS: Record<DatasetKind, Record<string, FieldType>> = {
  GENERAL_LEDGER: {
    documentNumber: "string", reference: "string", accountCode: "string",
    accountName: "string", postingDate: "date", documentDate: "date",
    debit: "decimal", credit: "decimal", amount: "decimal", currency: "string",
    description: "string", counterparty: "string", costCenter: "string",
    profitCenter: "string", userId: "string", sourceType: "string",
  },
  TRIAL_BALANCE: {
    accountCode: "string", accountName: "string",
    openingDebit: "decimal", openingCredit: "decimal",
    periodDebit: "decimal", periodCredit: "decimal",
    closingDebit: "decimal", closingCredit: "decimal", currency: "string",
  },
  BANK: {
    transactionDate: "date", valueDate: "date", amount: "decimal",
    currency: "string", description: "string", reference: "string",
    counterparty: "string", bankAccount: "string",
  },
  OTHER: {},
};

/** Fields that MUST be present and parseable for a row to be accepted. */
export const REQUIRED_FIELDS: Record<DatasetKind, string[]> = {
  GENERAL_LEDGER: ["accountCode", "postingDate"],
  TRIAL_BALANCE: ["accountCode"],
  BANK: ["transactionDate", "amount"],
  OTHER: [],
};

/**
 * "At least one of" groups: the row must carry at least one parseable member.
 * (GL needs some monetary value; TB needs at least one balance figure.)
 */
export const ONE_OF_GROUPS: Record<DatasetKind, string[][]> = {
  GENERAL_LEDGER: [["debit", "credit", "amount"]],
  TRIAL_BALANCE: [
    ["openingDebit", "openingCredit", "periodDebit", "periodCredit", "closingDebit", "closingCredit"],
  ],
  BANK: [],
  OTHER: [],
};

export function fieldType(kind: DatasetKind, field: string): FieldType | undefined {
  return INGEST_FIELDS[kind][field];
}
