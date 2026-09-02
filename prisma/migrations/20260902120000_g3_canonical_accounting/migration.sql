-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE', 'OTHER');

-- CreateEnum
CREATE TYPE "NormalBalance" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "FiscalPeriodType" AS ENUM ('MONTH', 'QUARTER', 'YEAR', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "SourceIdentityOrigin" AS ENUM ('PROFILE', 'MAPPING', 'ROW');

-- CreateEnum
CREATE TYPE "JournalGroupingCapability" AS ENUM ('EXPLICIT_ENTRY_AND_LINE_ID', 'EXPLICIT_ENTRY_ID', 'NO_RELIABLE_ENTRY_ID');

-- CreateEnum
CREATE TYPE "JournalGroupingBasis" AS ENUM ('SOURCE_ASSERTED_ENTRY_LINE', 'SOURCE_ASSERTED_ENTRY');

-- CreateEnum
CREATE TYPE "BalanceCapability" AS ENUM ('AVAILABLE', 'PARTIAL', 'NOT_AVAILABLE');

-- CreateEnum
CREATE TYPE "BalanceStatus" AS ENUM ('BALANCED', 'UNBALANCED', 'NOT_EVALUABLE');

-- CreateEnum
CREATE TYPE "MonetaryBasis" AS ENUM ('TRANSACTION', 'FUNCTIONAL');

-- CreateEnum
CREATE TYPE "AccountMappingBasis" AS ENUM ('EXACT_CODE_IN_SCOPE', 'AUDITOR_ASSERTED', 'IMPORT_CONFIRMED');

-- DropForeignKey
ALTER TABLE "datasets" DROP CONSTRAINT "ds_attempt_tfkey";

-- DropForeignKey
ALTER TABLE "datasets" DROP CONSTRAINT "ds_batch_tfkey";

-- DropForeignKey
ALTER TABLE "datasets" DROP CONSTRAINT "ds_client_fkey";

-- DropForeignKey
ALTER TABLE "datasets" DROP CONSTRAINT "ds_eng_fkey";

-- DropForeignKey
ALTER TABLE "datasets" DROP CONSTRAINT "ds_firm_fkey";

-- DropForeignKey
ALTER TABLE "datasets" DROP CONSTRAINT "ds_sf_tfkey";

-- DropForeignKey
ALTER TABLE "documents" DROP CONSTRAINT "doc_sf_tfkey";

-- DropForeignKey
ALTER TABLE "import_attempts" DROP CONSTRAINT "ia_batch_tfkey";

-- DropForeignKey
ALTER TABLE "import_attempts" DROP CONSTRAINT "ia_cuser_fkey";

-- DropForeignKey
ALTER TABLE "import_attempts" DROP CONSTRAINT "ia_firm_fkey";

-- DropForeignKey
ALTER TABLE "import_attempts" DROP CONSTRAINT "ia_user_fkey";

-- DropForeignKey
ALTER TABLE "import_batches" DROP CONSTRAINT "ib_eng_fkey";

-- DropForeignKey
ALTER TABLE "import_batches" DROP CONSTRAINT "ib_firm_fkey";

-- DropForeignKey
ALTER TABLE "import_batches" DROP CONSTRAINT "ib_mapv_tfkey";

-- DropForeignKey
ALTER TABLE "import_batches" DROP CONSTRAINT "ib_prof_tfkey";

-- DropForeignKey
ALTER TABLE "import_batches" DROP CONSTRAINT "ib_result_tfkey";

-- DropForeignKey
ALTER TABLE "import_batches" DROP CONSTRAINT "ib_sf_tfkey";

-- DropForeignKey
ALTER TABLE "import_batches" DROP CONSTRAINT "ib_user_fkey";

-- DropForeignKey
ALTER TABLE "import_issues" DROP CONSTRAINT "ii_attempt_tfkey";

-- DropForeignKey
ALTER TABLE "import_issues" DROP CONSTRAINT "ii_batch_tfkey";

-- DropForeignKey
ALTER TABLE "import_issues" DROP CONSTRAINT "ii_ds_tfkey";

-- DropForeignKey
ALTER TABLE "import_issues" DROP CONSTRAINT "ii_firm_fkey";

-- DropForeignKey
ALTER TABLE "import_issues" DROP CONSTRAINT "ii_ir_tfkey";

-- DropForeignKey
ALTER TABLE "import_mapping_versions" DROP CONSTRAINT "imv_firm_fkey";

-- DropForeignKey
ALTER TABLE "import_mapping_versions" DROP CONSTRAINT "imv_mapping_tfkey";

-- DropForeignKey
ALTER TABLE "import_mapping_versions" DROP CONSTRAINT "imv_user_fkey";

-- DropForeignKey
ALTER TABLE "import_mappings" DROP CONSTRAINT "im_client_fkey";

-- DropForeignKey
ALTER TABLE "import_mappings" DROP CONSTRAINT "im_firm_fkey";

-- DropForeignKey
ALTER TABLE "import_profiles" DROP CONSTRAINT "ip_client_fkey";

-- DropForeignKey
ALTER TABLE "import_profiles" DROP CONSTRAINT "ip_firm_fkey";

-- DropForeignKey
ALTER TABLE "import_profiles" DROP CONSTRAINT "ip_user_fkey";

-- DropForeignKey
ALTER TABLE "imported_records" DROP CONSTRAINT "ir_batch_tfkey";

-- DropForeignKey
ALTER TABLE "imported_records" DROP CONSTRAINT "ir_ds_tfkey";

-- DropForeignKey
ALTER TABLE "imported_records" DROP CONSTRAINT "ir_firm_fkey";

-- DropForeignKey
ALTER TABLE "imported_records" DROP CONSTRAINT "ir_sf_tfkey";

-- DropForeignKey
ALTER TABLE "source_files" DROP CONSTRAINT "sf_client_fkey";

-- DropForeignKey
ALTER TABLE "source_files" DROP CONSTRAINT "sf_eng_fkey";

-- DropForeignKey
ALTER TABLE "source_files" DROP CONSTRAINT "sf_firm_fkey";

-- DropForeignKey
ALTER TABLE "source_files" DROP CONSTRAINT "sf_user_fkey";

-- DropForeignKey
ALTER TABLE "transactions" DROP CONSTRAINT "tx_ds_tfkey";

-- DropForeignKey
ALTER TABLE "transactions" DROP CONSTRAINT "tx_ir_tfkey";

-- CreateTable
CREATE TABLE "accounting_scopes" (
    "id" TEXT NOT NULL,
    "auditFirmId" TEXT NOT NULL,
    "clientCompanyId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT,
    "sourceSystem" TEXT,
    "sourceEntity" TEXT,
    "sourceLedger" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounting_scopes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "auditFirmId" TEXT NOT NULL,
    "clientCompanyId" TEXT NOT NULL,
    "accountingScopeId" TEXT NOT NULL,
    "accountCode" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "accountType" "AccountType",
    "normalBalance" "NormalBalance",
    "parentAccountId" TEXT,
    "status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fiscal_periods" (
    "id" TEXT NOT NULL,
    "auditFirmId" TEXT NOT NULL,
    "clientCompanyId" TEXT NOT NULL,
    "engagementId" TEXT,
    "fiscalYear" INTEGER NOT NULL,
    "periodNo" INTEGER NOT NULL,
    "periodKey" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "periodType" "FiscalPeriodType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fiscal_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_accounting_contexts" (
    "id" TEXT NOT NULL,
    "auditFirmId" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "sourceSystem" TEXT,
    "sourceSystemVersion" TEXT,
    "sourceEntity" TEXT,
    "sourceLedger" TEXT,
    "capturedFrom" "SourceIdentityOrigin" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "source_accounting_contexts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dataset_accounts" (
    "id" TEXT NOT NULL,
    "auditFirmId" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "sourceAccountingContextId" TEXT NOT NULL,
    "sourceAccountCode" TEXT NOT NULL,
    "sourceAccountName" TEXT,
    "firstImportedRecordId" TEXT NOT NULL,
    "occurrenceCount" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dataset_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entries" (
    "id" TEXT NOT NULL,
    "auditFirmId" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "clientCompanyId" TEXT,
    "datasetId" TEXT NOT NULL,
    "sourceAccountingContextId" TEXT,
    "fiscalPeriodId" TEXT,
    "sourceEntryId" TEXT NOT NULL,
    "sourceJournal" TEXT,
    "sourceDocumentId" TEXT,
    "sourceDocumentNumber" TEXT,
    "entryDate" TIMESTAMP(3),
    "groupingBasis" "JournalGroupingBasis" NOT NULL,
    "balanceCapability" "BalanceCapability" NOT NULL,
    "balanceStatus" "BalanceStatus",
    "monetaryBasis" "MonetaryBasis",
    "balanceCurrency" TEXT,
    "debitTotal" DECIMAL(24,6),
    "creditTotal" DECIMAL(24,6),
    "difference" DECIMAL(24,6),
    "lineageClass" "LineageClass" NOT NULL DEFAULT 'VERIFIED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_lines" (
    "id" TEXT NOT NULL,
    "auditFirmId" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "journalEntryId" TEXT,
    "lineNo" INTEGER NOT NULL,
    "accountSnapshotId" TEXT NOT NULL,
    "fiscalPeriodId" TEXT,
    "transactionDebit" DECIMAL(24,6),
    "transactionCredit" DECIMAL(24,6),
    "transactionCurrency" TEXT,
    "functionalDebit" DECIMAL(24,6),
    "functionalCredit" DECIMAL(24,6),
    "functionalCurrency" TEXT,
    "exchangeRate" DECIMAL(24,12),
    "exchangeRateSource" TEXT,
    "costCenter" TEXT,
    "profitCenter" TEXT,
    "counterparty" TEXT,
    "description" TEXT,
    "reference" TEXT,
    "documentNumber" TEXT,
    "postedByUserId" TEXT,
    "sourceType" TEXT,
    "sourceLineId" TEXT,
    "groupingCapability" "JournalGroupingCapability" NOT NULL,
    "lineageClass" "LineageClass" NOT NULL DEFAULT 'VERIFIED',
    "importedRecordId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journal_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trial_balances" (
    "id" TEXT NOT NULL,
    "auditFirmId" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "clientCompanyId" TEXT,
    "datasetId" TEXT NOT NULL,
    "sourceAccountingContextId" TEXT,
    "fiscalPeriodId" TEXT,
    "currency" TEXT,
    "asOfDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trial_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trial_balance_rows" (
    "id" TEXT NOT NULL,
    "auditFirmId" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "trialBalanceId" TEXT NOT NULL,
    "accountSnapshotId" TEXT NOT NULL,
    "openingDebit" DECIMAL(24,6),
    "openingCredit" DECIMAL(24,6),
    "periodDebit" DECIMAL(24,6),
    "periodCredit" DECIMAL(24,6),
    "closingDebit" DECIMAL(24,6),
    "closingCredit" DECIMAL(24,6),
    "currency" TEXT,
    "lineageClass" "LineageClass" NOT NULL DEFAULT 'VERIFIED',
    "importedRecordId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trial_balance_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_mappings" (
    "id" TEXT NOT NULL,
    "auditFirmId" TEXT NOT NULL,
    "datasetAccountId" TEXT NOT NULL,
    "currentVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_mapping_versions" (
    "id" TEXT NOT NULL,
    "auditFirmId" TEXT NOT NULL,
    "accountMappingId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "accountId" TEXT NOT NULL,
    "basis" "AccountMappingBasis" NOT NULL,
    "mappedById" TEXT,
    "mappedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersededAt" TIMESTAMP(3),

    CONSTRAINT "account_mapping_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "accounting_scopes_auditFirmId_idx" ON "accounting_scopes"("auditFirmId");

-- CreateIndex
CREATE INDEX "accounting_scopes_auditFirmId_clientCompanyId_idx" ON "accounting_scopes"("auditFirmId", "clientCompanyId");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_scopes_auditFirmId_id_key" ON "accounting_scopes"("auditFirmId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_scopes_auditFirmId_clientCompanyId_key_key" ON "accounting_scopes"("auditFirmId", "clientCompanyId", "key");

-- CreateIndex
CREATE INDEX "accounts_auditFirmId_idx" ON "accounts"("auditFirmId");

-- CreateIndex
CREATE INDEX "accounts_auditFirmId_clientCompanyId_accountingScopeId_acco_idx" ON "accounts"("auditFirmId", "clientCompanyId", "accountingScopeId", "accountCode");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_auditFirmId_id_key" ON "accounts"("auditFirmId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_auditFirmId_clientCompanyId_accountingScopeId_acco_key" ON "accounts"("auditFirmId", "clientCompanyId", "accountingScopeId", "accountCode");

-- CreateIndex
CREATE INDEX "fiscal_periods_auditFirmId_idx" ON "fiscal_periods"("auditFirmId");

-- CreateIndex
CREATE INDEX "fiscal_periods_auditFirmId_clientCompanyId_fiscalYear_idx" ON "fiscal_periods"("auditFirmId", "clientCompanyId", "fiscalYear");

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_periods_auditFirmId_id_key" ON "fiscal_periods"("auditFirmId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_periods_auditFirmId_clientCompanyId_fiscalYear_perio_key" ON "fiscal_periods"("auditFirmId", "clientCompanyId", "fiscalYear", "periodNo");

-- CreateIndex
CREATE INDEX "source_accounting_contexts_auditFirmId_idx" ON "source_accounting_contexts"("auditFirmId");

-- CreateIndex
CREATE INDEX "source_accounting_contexts_auditFirmId_datasetId_idx" ON "source_accounting_contexts"("auditFirmId", "datasetId");

-- CreateIndex
CREATE INDEX "source_accounting_contexts_auditFirmId_sourceSystem_sourceE_idx" ON "source_accounting_contexts"("auditFirmId", "sourceSystem", "sourceEntity", "sourceLedger");

-- CreateIndex
CREATE UNIQUE INDEX "source_accounting_contexts_auditFirmId_id_key" ON "source_accounting_contexts"("auditFirmId", "id");

-- CreateIndex
CREATE INDEX "dataset_accounts_auditFirmId_idx" ON "dataset_accounts"("auditFirmId");

-- CreateIndex
CREATE INDEX "dataset_accounts_auditFirmId_datasetId_idx" ON "dataset_accounts"("auditFirmId", "datasetId");

-- CreateIndex
CREATE UNIQUE INDEX "dataset_accounts_auditFirmId_id_key" ON "dataset_accounts"("auditFirmId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "dataset_accounts_auditFirmId_datasetId_sourceAccountingCont_key" ON "dataset_accounts"("auditFirmId", "datasetId", "sourceAccountingContextId", "sourceAccountCode");

-- CreateIndex
CREATE INDEX "journal_entries_auditFirmId_idx" ON "journal_entries"("auditFirmId");

-- CreateIndex
CREATE INDEX "journal_entries_auditFirmId_datasetId_idx" ON "journal_entries"("auditFirmId", "datasetId");

-- CreateIndex
CREATE INDEX "journal_entries_auditFirmId_sourceEntryId_idx" ON "journal_entries"("auditFirmId", "sourceEntryId");

-- CreateIndex
CREATE INDEX "journal_entries_auditFirmId_fiscalPeriodId_idx" ON "journal_entries"("auditFirmId", "fiscalPeriodId");

-- CreateIndex
CREATE INDEX "journal_entries_auditFirmId_sourceAccountingContextId_idx" ON "journal_entries"("auditFirmId", "sourceAccountingContextId");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_auditFirmId_id_key" ON "journal_entries"("auditFirmId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_auditFirmId_datasetId_sourceEntryId_key" ON "journal_entries"("auditFirmId", "datasetId", "sourceEntryId");

-- CreateIndex
CREATE INDEX "journal_lines_auditFirmId_idx" ON "journal_lines"("auditFirmId");

-- CreateIndex
CREATE INDEX "journal_lines_auditFirmId_datasetId_idx" ON "journal_lines"("auditFirmId", "datasetId");

-- CreateIndex
CREATE INDEX "journal_lines_auditFirmId_journalEntryId_idx" ON "journal_lines"("auditFirmId", "journalEntryId");

-- CreateIndex
CREATE INDEX "journal_lines_auditFirmId_accountSnapshotId_idx" ON "journal_lines"("auditFirmId", "accountSnapshotId");

-- CreateIndex
CREATE INDEX "journal_lines_auditFirmId_fiscalPeriodId_idx" ON "journal_lines"("auditFirmId", "fiscalPeriodId");

-- CreateIndex
CREATE INDEX "journal_lines_auditFirmId_importedRecordId_idx" ON "journal_lines"("auditFirmId", "importedRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "journal_lines_auditFirmId_id_key" ON "journal_lines"("auditFirmId", "id");

-- CreateIndex
CREATE INDEX "trial_balances_auditFirmId_idx" ON "trial_balances"("auditFirmId");

-- CreateIndex
CREATE INDEX "trial_balances_auditFirmId_datasetId_idx" ON "trial_balances"("auditFirmId", "datasetId");

-- CreateIndex
CREATE UNIQUE INDEX "trial_balances_auditFirmId_id_key" ON "trial_balances"("auditFirmId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "trial_balances_auditFirmId_datasetId_key" ON "trial_balances"("auditFirmId", "datasetId");

-- CreateIndex
CREATE INDEX "trial_balance_rows_auditFirmId_idx" ON "trial_balance_rows"("auditFirmId");

-- CreateIndex
CREATE INDEX "trial_balance_rows_auditFirmId_trialBalanceId_idx" ON "trial_balance_rows"("auditFirmId", "trialBalanceId");

-- CreateIndex
CREATE INDEX "trial_balance_rows_auditFirmId_accountSnapshotId_idx" ON "trial_balance_rows"("auditFirmId", "accountSnapshotId");

-- CreateIndex
CREATE INDEX "trial_balance_rows_auditFirmId_importedRecordId_idx" ON "trial_balance_rows"("auditFirmId", "importedRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "trial_balance_rows_auditFirmId_id_key" ON "trial_balance_rows"("auditFirmId", "id");

-- CreateIndex
CREATE INDEX "account_mappings_auditFirmId_idx" ON "account_mappings"("auditFirmId");

-- CreateIndex
CREATE UNIQUE INDEX "account_mappings_auditFirmId_id_key" ON "account_mappings"("auditFirmId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "account_mappings_auditFirmId_datasetAccountId_key" ON "account_mappings"("auditFirmId", "datasetAccountId");

-- CreateIndex
CREATE INDEX "account_mapping_versions_auditFirmId_idx" ON "account_mapping_versions"("auditFirmId");

-- CreateIndex
CREATE INDEX "account_mapping_versions_accountMappingId_idx" ON "account_mapping_versions"("accountMappingId");

-- CreateIndex
CREATE UNIQUE INDEX "account_mapping_versions_auditFirmId_id_key" ON "account_mapping_versions"("auditFirmId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "account_mapping_versions_accountMappingId_version_key" ON "account_mapping_versions"("accountMappingId", "version");



-- ============================================================================
-- G3 Canonical Accounting — deterministic identity indexes (raw)
-- ============================================================================

-- Context-zero determinism: exactly one SourceAccountingContext per
-- (firm, dataset, system, entity, ledger); NULLs collapse to '' so the
-- all-null context-zero is unique and re-findable (C2 / ADR-G3-06).
CREATE UNIQUE INDEX "sac_dataset_tuple_key" ON "source_accounting_contexts"
  ("auditFirmId","datasetId",
   COALESCE("sourceSystem",''), COALESCE("sourceEntity",''), COALESCE("sourceLedger",''));

-- Enables the cross-dataset lineage-consistency FK below: a canonical fact's
-- denormalized datasetId must equal its ImportedRecord's datasetId (Section F).
CREATE UNIQUE INDEX "imported_records_id_datasetId_key" ON "imported_records"("id","datasetId");

-- ============================================================================
-- Tenant root FKs (auditFirmId -> audit_firms.id) on all 11 G3 tables
-- ============================================================================
ALTER TABLE "accounting_scopes"          ADD CONSTRAINT "as_firm_fkey"  FOREIGN KEY ("auditFirmId") REFERENCES "audit_firms"("id") ON DELETE CASCADE;
ALTER TABLE "accounts"                   ADD CONSTRAINT "acc_firm_fkey" FOREIGN KEY ("auditFirmId") REFERENCES "audit_firms"("id") ON DELETE CASCADE;
ALTER TABLE "fiscal_periods"             ADD CONSTRAINT "fp_firm_fkey"  FOREIGN KEY ("auditFirmId") REFERENCES "audit_firms"("id") ON DELETE CASCADE;
ALTER TABLE "source_accounting_contexts" ADD CONSTRAINT "sac_firm_fkey" FOREIGN KEY ("auditFirmId") REFERENCES "audit_firms"("id") ON DELETE CASCADE;
ALTER TABLE "dataset_accounts"           ADD CONSTRAINT "da_firm_fkey"  FOREIGN KEY ("auditFirmId") REFERENCES "audit_firms"("id") ON DELETE CASCADE;
ALTER TABLE "journal_entries"            ADD CONSTRAINT "je_firm_fkey"  FOREIGN KEY ("auditFirmId") REFERENCES "audit_firms"("id") ON DELETE CASCADE;
ALTER TABLE "journal_lines"              ADD CONSTRAINT "jl_firm_fkey"  FOREIGN KEY ("auditFirmId") REFERENCES "audit_firms"("id") ON DELETE CASCADE;
ALTER TABLE "trial_balances"             ADD CONSTRAINT "tb_firm_fkey"  FOREIGN KEY ("auditFirmId") REFERENCES "audit_firms"("id") ON DELETE CASCADE;
ALTER TABLE "trial_balance_rows"         ADD CONSTRAINT "tbr_firm_fkey" FOREIGN KEY ("auditFirmId") REFERENCES "audit_firms"("id") ON DELETE CASCADE;
ALTER TABLE "account_mappings"           ADD CONSTRAINT "am_firm_fkey"  FOREIGN KEY ("auditFirmId") REFERENCES "audit_firms"("id") ON DELETE CASCADE;
ALTER TABLE "account_mapping_versions"   ADD CONSTRAINT "amv_firm_fkey" FOREIGN KEY ("auditFirmId") REFERENCES "audit_firms"("id") ON DELETE CASCADE;

-- ============================================================================
-- Context / simple FKs (client, engagement, user)
-- ============================================================================
ALTER TABLE "accounting_scopes" ADD CONSTRAINT "as_client_fkey"  FOREIGN KEY ("clientCompanyId") REFERENCES "client_companies"("id") ON DELETE CASCADE;
ALTER TABLE "accounts"          ADD CONSTRAINT "acc_client_fkey" FOREIGN KEY ("clientCompanyId") REFERENCES "client_companies"("id") ON DELETE CASCADE;
ALTER TABLE "fiscal_periods"    ADD CONSTRAINT "fp_client_fkey"  FOREIGN KEY ("clientCompanyId") REFERENCES "client_companies"("id") ON DELETE CASCADE;
ALTER TABLE "fiscal_periods"    ADD CONSTRAINT "fp_eng_fkey"     FOREIGN KEY ("engagementId")    REFERENCES "audit_engagements"("id") ON DELETE SET NULL;
ALTER TABLE "journal_entries"   ADD CONSTRAINT "je_eng_fkey"     FOREIGN KEY ("engagementId")    REFERENCES "audit_engagements"("id") ON DELETE CASCADE;
ALTER TABLE "journal_entries"   ADD CONSTRAINT "je_client_fkey"  FOREIGN KEY ("clientCompanyId") REFERENCES "client_companies"("id") ON DELETE SET NULL;
ALTER TABLE "trial_balances"    ADD CONSTRAINT "tb_eng_fkey"     FOREIGN KEY ("engagementId")    REFERENCES "audit_engagements"("id") ON DELETE CASCADE;
ALTER TABLE "trial_balances"    ADD CONSTRAINT "tb_client_fkey"  FOREIGN KEY ("clientCompanyId") REFERENCES "client_companies"("id") ON DELETE SET NULL;
ALTER TABLE "account_mapping_versions" ADD CONSTRAINT "amv_user_fkey" FOREIGN KEY ("mappedById") REFERENCES "users"("id") ON DELETE SET NULL;

-- ============================================================================
-- Composite TENANT FKs across the canonical spine + into the G2 lineage
-- (auditFirmId, parentId) -> parent(auditFirmId, id) — tenant integrity even
-- under an owner/migration connection where RLS is bypassed.
-- ============================================================================
ALTER TABLE "accounts"                   ADD CONSTRAINT "acc_scope_tfkey" FOREIGN KEY ("auditFirmId","accountingScopeId")         REFERENCES "accounting_scopes"("auditFirmId","id") ON DELETE CASCADE;
ALTER TABLE "source_accounting_contexts" ADD CONSTRAINT "sac_ds_tfkey"    FOREIGN KEY ("auditFirmId","datasetId")                 REFERENCES "datasets"("auditFirmId","id") ON DELETE CASCADE;
ALTER TABLE "dataset_accounts"           ADD CONSTRAINT "da_ds_tfkey"     FOREIGN KEY ("auditFirmId","datasetId")                 REFERENCES "datasets"("auditFirmId","id") ON DELETE CASCADE;
ALTER TABLE "dataset_accounts"           ADD CONSTRAINT "da_ctx_tfkey"    FOREIGN KEY ("auditFirmId","sourceAccountingContextId") REFERENCES "source_accounting_contexts"("auditFirmId","id") ON DELETE CASCADE;
ALTER TABLE "dataset_accounts"           ADD CONSTRAINT "da_ir_tfkey"     FOREIGN KEY ("auditFirmId","firstImportedRecordId")     REFERENCES "imported_records"("auditFirmId","id");
ALTER TABLE "journal_entries"            ADD CONSTRAINT "je_ds_tfkey"     FOREIGN KEY ("auditFirmId","datasetId")                 REFERENCES "datasets"("auditFirmId","id") ON DELETE CASCADE;
ALTER TABLE "journal_entries"            ADD CONSTRAINT "je_ctx_tfkey"    FOREIGN KEY ("auditFirmId","sourceAccountingContextId") REFERENCES "source_accounting_contexts"("auditFirmId","id");
ALTER TABLE "journal_entries"            ADD CONSTRAINT "je_fp_tfkey"     FOREIGN KEY ("auditFirmId","fiscalPeriodId")            REFERENCES "fiscal_periods"("auditFirmId","id") ON DELETE SET NULL;
ALTER TABLE "journal_lines"              ADD CONSTRAINT "jl_ds_tfkey"     FOREIGN KEY ("auditFirmId","datasetId")                 REFERENCES "datasets"("auditFirmId","id") ON DELETE CASCADE;
ALTER TABLE "journal_lines"              ADD CONSTRAINT "jl_je_tfkey"     FOREIGN KEY ("auditFirmId","journalEntryId")            REFERENCES "journal_entries"("auditFirmId","id") ON DELETE CASCADE;
ALTER TABLE "journal_lines"              ADD CONSTRAINT "jl_da_tfkey"     FOREIGN KEY ("auditFirmId","accountSnapshotId")         REFERENCES "dataset_accounts"("auditFirmId","id");
ALTER TABLE "journal_lines"              ADD CONSTRAINT "jl_ir_tfkey"     FOREIGN KEY ("auditFirmId","importedRecordId")          REFERENCES "imported_records"("auditFirmId","id");
ALTER TABLE "journal_lines"              ADD CONSTRAINT "jl_fp_tfkey"     FOREIGN KEY ("auditFirmId","fiscalPeriodId")            REFERENCES "fiscal_periods"("auditFirmId","id") ON DELETE SET NULL;
ALTER TABLE "journal_lines"              ADD CONSTRAINT "jl_ir_ds_ckey"   FOREIGN KEY ("importedRecordId","datasetId")            REFERENCES "imported_records"("id","datasetId");
ALTER TABLE "trial_balances"             ADD CONSTRAINT "tb_ds_tfkey"     FOREIGN KEY ("auditFirmId","datasetId")                 REFERENCES "datasets"("auditFirmId","id") ON DELETE CASCADE;
ALTER TABLE "trial_balances"             ADD CONSTRAINT "tb_ctx_tfkey"    FOREIGN KEY ("auditFirmId","sourceAccountingContextId") REFERENCES "source_accounting_contexts"("auditFirmId","id");
ALTER TABLE "trial_balances"             ADD CONSTRAINT "tb_fp_tfkey"     FOREIGN KEY ("auditFirmId","fiscalPeriodId")            REFERENCES "fiscal_periods"("auditFirmId","id") ON DELETE SET NULL;
ALTER TABLE "trial_balance_rows"         ADD CONSTRAINT "tbr_ds_tfkey"    FOREIGN KEY ("auditFirmId","datasetId")                 REFERENCES "datasets"("auditFirmId","id") ON DELETE CASCADE;
ALTER TABLE "trial_balance_rows"         ADD CONSTRAINT "tbr_tb_tfkey"    FOREIGN KEY ("auditFirmId","trialBalanceId")            REFERENCES "trial_balances"("auditFirmId","id") ON DELETE CASCADE;
ALTER TABLE "trial_balance_rows"         ADD CONSTRAINT "tbr_da_tfkey"    FOREIGN KEY ("auditFirmId","accountSnapshotId")         REFERENCES "dataset_accounts"("auditFirmId","id");
ALTER TABLE "trial_balance_rows"         ADD CONSTRAINT "tbr_ir_tfkey"    FOREIGN KEY ("auditFirmId","importedRecordId")          REFERENCES "imported_records"("auditFirmId","id");
ALTER TABLE "trial_balance_rows"         ADD CONSTRAINT "tbr_ir_ds_ckey"  FOREIGN KEY ("importedRecordId","datasetId")            REFERENCES "imported_records"("id","datasetId");
ALTER TABLE "account_mappings"           ADD CONSTRAINT "am_da_tfkey"     FOREIGN KEY ("auditFirmId","datasetAccountId")          REFERENCES "dataset_accounts"("auditFirmId","id") ON DELETE CASCADE;
ALTER TABLE "account_mappings"           ADD CONSTRAINT "am_curver_tfkey" FOREIGN KEY ("auditFirmId","currentVersionId")          REFERENCES "account_mapping_versions"("auditFirmId","id");
ALTER TABLE "account_mapping_versions"   ADD CONSTRAINT "amv_am_tfkey"    FOREIGN KEY ("auditFirmId","accountMappingId")          REFERENCES "account_mappings"("auditFirmId","id") ON DELETE CASCADE;
ALTER TABLE "account_mapping_versions"   ADD CONSTRAINT "amv_acc_tfkey"   FOREIGN KEY ("auditFirmId","accountId")                 REFERENCES "accounts"("auditFirmId","id");

-- ============================================================================
-- G1 parity: RLS + tenant_isolation policy on all 11 G3 tables
-- ============================================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'accounting_scopes','accounts','fiscal_periods','source_accounting_contexts',
    'dataset_accounts','journal_entries','journal_lines','trial_balances',
    'trial_balance_rows','account_mappings','account_mapping_versions'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I FOR ALL
      USING ("auditFirmId" = current_setting('app.audit_firm_id', true))
      WITH CHECK ("auditFirmId" = current_setting('app.audit_firm_id', true));$p$, t);
  END LOOP;
END $$;

-- ============================================================================
-- Privileges + IMMUTABILITY (ADR-G3 / Section M)
-- Masters: full CRUD. Versioned interpretation: no DELETE (supersession stamps
-- in place). SOURCE FACTS: SELECT + INSERT only — UPDATE/DELETE revoked so the
-- runtime role cannot mutate a committed accounting fact (fail-closed).
-- ============================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON "accounting_scopes","accounts","fiscal_periods","account_mappings" TO audit_app;
GRANT SELECT, INSERT, UPDATE ON "account_mapping_versions" TO audit_app;
GRANT SELECT, INSERT ON
  "source_accounting_contexts","dataset_accounts","journal_entries",
  "journal_lines","trial_balances","trial_balance_rows" TO audit_app;

REVOKE UPDATE, DELETE ON
  "source_accounting_contexts","dataset_accounts","journal_entries",
  "journal_lines","trial_balances","trial_balance_rows" FROM audit_app;
REVOKE DELETE ON "account_mapping_versions" FROM audit_app;
