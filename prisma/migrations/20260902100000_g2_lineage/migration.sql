-- CreateEnum
CREATE TYPE "SourceStorageProvider" AS ENUM ('NONE', 'OBJECT_STORE');

-- CreateEnum
CREATE TYPE "CustodyStatus" AS ENUM ('RETAINED', 'METADATA_ONLY', 'NOT_RETAINED', 'TOMBSTONED');

-- CreateEnum
CREATE TYPE "ProcessingBoundary" AS ENUM ('NONE', 'INTERNAL', 'EXTERNAL');

-- CreateEnum
CREATE TYPE "DatasetKind" AS ENUM ('GENERAL_LEDGER', 'TRIAL_BALANCE', 'BANK', 'OTHER');

-- CreateEnum
CREATE TYPE "LineageClass" AS ENUM ('VERIFIED', 'PARTIAL_LINEAGE', 'UNKNOWN_LINEAGE', 'LEGACY_UNVERIFIED');

-- CreateEnum
CREATE TYPE "ImportFormat" AS ENUM ('CSV', 'XLSX');

-- CreateEnum
CREATE TYPE "ImportBatchStatus" AS ENUM ('RECEIVED', 'PROFILING', 'VALIDATING', 'READY', 'IMPORTING', 'COMPLETED', 'COMPLETED_WITH_ISSUES', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ImportAttemptStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DatasetStatus" AS ENUM ('PENDING', 'COMPLETED', 'COMPLETED_WITH_ISSUES', 'FAILED');

-- CreateEnum
CREATE TYPE "ImportedRecordStatus" AS ENUM ('ACCEPTED', 'ACCEPTED_WITH_WARNING', 'REJECTED');

-- CreateEnum
CREATE TYPE "ImportIssueScope" AS ENUM ('FILE', 'PROFILE', 'MAPPING', 'ROW', 'FIELD');

-- CreateEnum
CREATE TYPE "ImportIssueSeverity" AS ENUM ('ERROR', 'WARNING', 'INFO');

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "sourceFileId" TEXT;

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "datasetId" TEXT,
ADD COLUMN     "importedRecordId" TEXT;

-- CreateTable
CREATE TABLE "source_files" (
    "id" TEXT NOT NULL,
    "auditFirmId" TEXT NOT NULL,
    "engagementId" TEXT,
    "clientCompanyId" TEXT,
    "originalFileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "sha256" TEXT,
    "uploadedById" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "storageProvider" "SourceStorageProvider" NOT NULL DEFAULT 'NONE',
    "storageBucket" TEXT,
    "storageObjectKey" TEXT,
    "storageVersion" TEXT,
    "custodyStatus" "CustodyStatus" NOT NULL,
    "processingBoundary" "ProcessingBoundary" NOT NULL DEFAULT 'NONE',
    "processorRef" TEXT,
    "retentionPolicy" TEXT,
    "legalHold" BOOLEAN NOT NULL DEFAULT false,
    "tombstonedAt" TIMESTAMP(3),
    "legacyStorageKeyRaw" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "source_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_profiles" (
    "id" TEXT NOT NULL,
    "auditFirmId" TEXT NOT NULL,
    "clientCompanyId" TEXT,
    "name" TEXT NOT NULL,
    "format" "ImportFormat" NOT NULL,
    "encoding" TEXT NOT NULL,
    "delimiter" TEXT,
    "sheet" TEXT,
    "headerRow" INTEGER NOT NULL,
    "locale" TEXT NOT NULL,
    "dateInterpretation" TEXT NOT NULL,
    "numberInterpretation" TEXT NOT NULL,
    "parserVersion" TEXT NOT NULL,
    "normalizerVersion" TEXT NOT NULL,
    "profileHash" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_mappings" (
    "id" TEXT NOT NULL,
    "auditFirmId" TEXT NOT NULL,
    "clientCompanyId" TEXT,
    "name" TEXT NOT NULL,
    "datasetKind" "DatasetKind" NOT NULL,
    "currentVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_mapping_versions" (
    "id" TEXT NOT NULL,
    "auditFirmId" TEXT NOT NULL,
    "importMappingId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "mapJson" JSONB NOT NULL,
    "targetFieldSetVersion" TEXT NOT NULL,
    "mappingHash" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_mapping_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_batches" (
    "id" TEXT NOT NULL,
    "auditFirmId" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "sourceFileId" TEXT,
    "importProfileId" TEXT,
    "importMappingVersionId" TEXT,
    "datasetKind" "DatasetKind" NOT NULL,
    "status" "ImportBatchStatus" NOT NULL DEFAULT 'RECEIVED',
    "idempotencyKey" TEXT NOT NULL,
    "effectiveProfileJson" JSONB,
    "effectiveProfileHash" TEXT,
    "resultDatasetId" TEXT,
    "rowsTotal" INTEGER NOT NULL DEFAULT 0,
    "rowsAccepted" INTEGER NOT NULL DEFAULT 0,
    "rowsRejected" INTEGER NOT NULL DEFAULT 0,
    "startedById" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "failureReason" TEXT,

    CONSTRAINT "import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_attempts" (
    "id" TEXT NOT NULL,
    "auditFirmId" TEXT NOT NULL,
    "importBatchId" TEXT NOT NULL,
    "attemptNo" INTEGER NOT NULL,
    "status" "ImportAttemptStatus" NOT NULL DEFAULT 'RUNNING',
    "startedById" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "confirmedById" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "failureReason" TEXT,

    CONSTRAINT "import_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "datasets" (
    "id" TEXT NOT NULL,
    "auditFirmId" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "clientCompanyId" TEXT,
    "importBatchId" TEXT NOT NULL,
    "importAttemptId" TEXT NOT NULL,
    "sourceFileId" TEXT,
    "kind" "DatasetKind" NOT NULL,
    "label" TEXT NOT NULL,
    "datasetHash" TEXT,
    "lineageClass" "LineageClass" NOT NULL DEFAULT 'VERIFIED',
    "status" "DatasetStatus" NOT NULL DEFAULT 'PENDING',
    "rowCountTotal" INTEGER NOT NULL DEFAULT 0,
    "rowCountAccepted" INTEGER NOT NULL DEFAULT 0,
    "rowCountRejected" INTEGER NOT NULL DEFAULT 0,
    "normalizerVersion" TEXT NOT NULL,
    "finalizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "datasets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "imported_records" (
    "id" TEXT NOT NULL,
    "auditFirmId" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "importBatchId" TEXT NOT NULL,
    "sourceFileId" TEXT,
    "sourceRowNo" INTEGER NOT NULL,
    "rawCells" JSONB NOT NULL,
    "rawHash" TEXT NOT NULL,
    "normalizedJson" JSONB,
    "status" "ImportedRecordStatus" NOT NULL,

    CONSTRAINT "imported_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_issues" (
    "id" TEXT NOT NULL,
    "auditFirmId" TEXT NOT NULL,
    "importBatchId" TEXT NOT NULL,
    "importAttemptId" TEXT,
    "importedRecordId" TEXT,
    "datasetId" TEXT,
    "scope" "ImportIssueScope" NOT NULL,
    "field" TEXT,
    "severity" "ImportIssueSeverity" NOT NULL,
    "code" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "rawValue" TEXT,
    "blocking" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_issues_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "source_files_auditFirmId_idx" ON "source_files"("auditFirmId");

-- CreateIndex
CREATE INDEX "source_files_engagementId_idx" ON "source_files"("engagementId");

-- CreateIndex
CREATE INDEX "source_files_auditFirmId_sha256_idx" ON "source_files"("auditFirmId", "sha256");

-- CreateIndex
CREATE INDEX "source_files_auditFirmId_custodyStatus_idx" ON "source_files"("auditFirmId", "custodyStatus");

-- CreateIndex
CREATE UNIQUE INDEX "source_files_auditFirmId_id_key" ON "source_files"("auditFirmId", "id");

-- CreateIndex
CREATE INDEX "import_profiles_auditFirmId_idx" ON "import_profiles"("auditFirmId");

-- CreateIndex
CREATE INDEX "import_profiles_auditFirmId_clientCompanyId_idx" ON "import_profiles"("auditFirmId", "clientCompanyId");

-- CreateIndex
CREATE UNIQUE INDEX "import_profiles_auditFirmId_id_key" ON "import_profiles"("auditFirmId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "import_profiles_auditFirmId_profileHash_key" ON "import_profiles"("auditFirmId", "profileHash");

-- CreateIndex
CREATE INDEX "import_mappings_auditFirmId_idx" ON "import_mappings"("auditFirmId");

-- CreateIndex
CREATE UNIQUE INDEX "import_mappings_auditFirmId_id_key" ON "import_mappings"("auditFirmId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "import_mappings_auditFirmId_clientCompanyId_name_datasetKin_key" ON "import_mappings"("auditFirmId", "clientCompanyId", "name", "datasetKind");

-- CreateIndex
CREATE INDEX "import_mapping_versions_auditFirmId_idx" ON "import_mapping_versions"("auditFirmId");

-- CreateIndex
CREATE INDEX "import_mapping_versions_importMappingId_idx" ON "import_mapping_versions"("importMappingId");

-- CreateIndex
CREATE UNIQUE INDEX "import_mapping_versions_auditFirmId_id_key" ON "import_mapping_versions"("auditFirmId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "import_mapping_versions_importMappingId_version_key" ON "import_mapping_versions"("importMappingId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "import_mapping_versions_auditFirmId_mappingHash_key" ON "import_mapping_versions"("auditFirmId", "mappingHash");

-- CreateIndex
CREATE INDEX "import_batches_auditFirmId_idx" ON "import_batches"("auditFirmId");

-- CreateIndex
CREATE INDEX "import_batches_engagementId_status_idx" ON "import_batches"("engagementId", "status");

-- CreateIndex
CREATE INDEX "import_batches_sourceFileId_idx" ON "import_batches"("sourceFileId");

-- CreateIndex
CREATE UNIQUE INDEX "import_batches_auditFirmId_id_key" ON "import_batches"("auditFirmId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "import_batches_auditFirmId_idempotencyKey_key" ON "import_batches"("auditFirmId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "import_attempts_auditFirmId_idx" ON "import_attempts"("auditFirmId");

-- CreateIndex
CREATE INDEX "import_attempts_importBatchId_idx" ON "import_attempts"("importBatchId");

-- CreateIndex
CREATE UNIQUE INDEX "import_attempts_auditFirmId_id_key" ON "import_attempts"("auditFirmId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "import_attempts_importBatchId_attemptNo_key" ON "import_attempts"("importBatchId", "attemptNo");

-- CreateIndex
CREATE INDEX "datasets_auditFirmId_idx" ON "datasets"("auditFirmId");

-- CreateIndex
CREATE INDEX "datasets_engagementId_kind_status_idx" ON "datasets"("engagementId", "kind", "status");

-- CreateIndex
CREATE INDEX "datasets_datasetHash_idx" ON "datasets"("datasetHash");

-- CreateIndex
CREATE UNIQUE INDEX "datasets_auditFirmId_id_key" ON "datasets"("auditFirmId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "datasets_importAttemptId_key" ON "datasets"("importAttemptId");

-- CreateIndex
CREATE INDEX "imported_records_auditFirmId_idx" ON "imported_records"("auditFirmId");

-- CreateIndex
CREATE INDEX "imported_records_datasetId_status_idx" ON "imported_records"("datasetId", "status");

-- CreateIndex
CREATE INDEX "imported_records_auditFirmId_rawHash_idx" ON "imported_records"("auditFirmId", "rawHash");

-- CreateIndex
CREATE UNIQUE INDEX "imported_records_auditFirmId_id_key" ON "imported_records"("auditFirmId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "imported_records_datasetId_sourceRowNo_key" ON "imported_records"("datasetId", "sourceRowNo");

-- CreateIndex
CREATE INDEX "import_issues_auditFirmId_severity_idx" ON "import_issues"("auditFirmId", "severity");

-- CreateIndex
CREATE INDEX "import_issues_importBatchId_idx" ON "import_issues"("importBatchId");

-- CreateIndex
CREATE INDEX "import_issues_importedRecordId_idx" ON "import_issues"("importedRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "import_issues_auditFirmId_id_key" ON "import_issues"("auditFirmId", "id");

-- CreateIndex
CREATE INDEX "documents_sourceFileId_idx" ON "documents"("sourceFileId");

-- CreateIndex
CREATE INDEX "transactions_datasetId_idx" ON "transactions"("datasetId");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_importedRecordId_key" ON "transactions"("importedRecordId");


-- ============================================================================
-- G2 relational integrity: FKs + composite TENANT FKs (Closure C12)
-- Composite FKs (auditFirmId, parentId) -> parent(auditFirmId, id) enforce
-- tenant integrity even under an owner/migration connection where RLS is
-- bypassed. Simple FKs cover the tenant root and context references.
-- ============================================================================

-- Tenant root (auditFirmId -> audit_firms.id) on all 9 tables
ALTER TABLE "source_files"            ADD CONSTRAINT "sf_firm_fkey"  FOREIGN KEY ("auditFirmId") REFERENCES "audit_firms"("id") ON DELETE CASCADE;
ALTER TABLE "import_profiles"         ADD CONSTRAINT "ip_firm_fkey"  FOREIGN KEY ("auditFirmId") REFERENCES "audit_firms"("id") ON DELETE CASCADE;
ALTER TABLE "import_mappings"         ADD CONSTRAINT "im_firm_fkey"  FOREIGN KEY ("auditFirmId") REFERENCES "audit_firms"("id") ON DELETE CASCADE;
ALTER TABLE "import_mapping_versions" ADD CONSTRAINT "imv_firm_fkey" FOREIGN KEY ("auditFirmId") REFERENCES "audit_firms"("id") ON DELETE CASCADE;
ALTER TABLE "import_batches"          ADD CONSTRAINT "ib_firm_fkey"  FOREIGN KEY ("auditFirmId") REFERENCES "audit_firms"("id") ON DELETE CASCADE;
ALTER TABLE "import_attempts"         ADD CONSTRAINT "ia_firm_fkey"  FOREIGN KEY ("auditFirmId") REFERENCES "audit_firms"("id") ON DELETE CASCADE;
ALTER TABLE "datasets"                ADD CONSTRAINT "ds_firm_fkey"  FOREIGN KEY ("auditFirmId") REFERENCES "audit_firms"("id") ON DELETE CASCADE;
ALTER TABLE "imported_records"        ADD CONSTRAINT "ir_firm_fkey"  FOREIGN KEY ("auditFirmId") REFERENCES "audit_firms"("id") ON DELETE CASCADE;
ALTER TABLE "import_issues"           ADD CONSTRAINT "ii_firm_fkey"  FOREIGN KEY ("auditFirmId") REFERENCES "audit_firms"("id") ON DELETE CASCADE;

-- Context references (simple FKs; RLS + tenant root cover isolation)
ALTER TABLE "source_files"    ADD CONSTRAINT "sf_eng_fkey"    FOREIGN KEY ("engagementId")    REFERENCES "audit_engagements"("id") ON DELETE SET NULL;
ALTER TABLE "source_files"    ADD CONSTRAINT "sf_client_fkey" FOREIGN KEY ("clientCompanyId") REFERENCES "client_companies"("id")  ON DELETE SET NULL;
ALTER TABLE "source_files"    ADD CONSTRAINT "sf_user_fkey"   FOREIGN KEY ("uploadedById")    REFERENCES "users"("id")             ON DELETE SET NULL;
ALTER TABLE "import_profiles" ADD CONSTRAINT "ip_client_fkey" FOREIGN KEY ("clientCompanyId") REFERENCES "client_companies"("id")  ON DELETE SET NULL;
ALTER TABLE "import_profiles" ADD CONSTRAINT "ip_user_fkey"   FOREIGN KEY ("createdById")     REFERENCES "users"("id")             ON DELETE SET NULL;
ALTER TABLE "import_mappings" ADD CONSTRAINT "im_client_fkey" FOREIGN KEY ("clientCompanyId") REFERENCES "client_companies"("id")  ON DELETE SET NULL;
ALTER TABLE "import_mapping_versions" ADD CONSTRAINT "imv_user_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id")          ON DELETE SET NULL;
ALTER TABLE "import_batches"  ADD CONSTRAINT "ib_eng_fkey"    FOREIGN KEY ("engagementId")    REFERENCES "audit_engagements"("id") ON DELETE CASCADE;
ALTER TABLE "import_batches"  ADD CONSTRAINT "ib_user_fkey"   FOREIGN KEY ("startedById")     REFERENCES "users"("id")             ON DELETE SET NULL;
ALTER TABLE "import_attempts" ADD CONSTRAINT "ia_user_fkey"   FOREIGN KEY ("startedById")     REFERENCES "users"("id")             ON DELETE SET NULL;
ALTER TABLE "import_attempts" ADD CONSTRAINT "ia_cuser_fkey"  FOREIGN KEY ("confirmedById")   REFERENCES "users"("id")             ON DELETE SET NULL;
ALTER TABLE "datasets"        ADD CONSTRAINT "ds_eng_fkey"    FOREIGN KEY ("engagementId")    REFERENCES "audit_engagements"("id") ON DELETE CASCADE;
ALTER TABLE "datasets"        ADD CONSTRAINT "ds_client_fkey" FOREIGN KEY ("clientCompanyId") REFERENCES "client_companies"("id")  ON DELETE SET NULL;

-- Composite TENANT FKs across the lineage spine (C12)
ALTER TABLE "import_mapping_versions" ADD CONSTRAINT "imv_mapping_tfkey" FOREIGN KEY ("auditFirmId","importMappingId") REFERENCES "import_mappings"("auditFirmId","id") ON DELETE CASCADE;
ALTER TABLE "import_batches"  ADD CONSTRAINT "ib_sf_tfkey"     FOREIGN KEY ("auditFirmId","sourceFileId")           REFERENCES "source_files"("auditFirmId","id");
ALTER TABLE "import_batches"  ADD CONSTRAINT "ib_prof_tfkey"   FOREIGN KEY ("auditFirmId","importProfileId")        REFERENCES "import_profiles"("auditFirmId","id");
ALTER TABLE "import_batches"  ADD CONSTRAINT "ib_mapv_tfkey"   FOREIGN KEY ("auditFirmId","importMappingVersionId") REFERENCES "import_mapping_versions"("auditFirmId","id");
ALTER TABLE "import_batches"  ADD CONSTRAINT "ib_result_tfkey" FOREIGN KEY ("auditFirmId","resultDatasetId")        REFERENCES "datasets"("auditFirmId","id");
ALTER TABLE "import_attempts" ADD CONSTRAINT "ia_batch_tfkey"  FOREIGN KEY ("auditFirmId","importBatchId")          REFERENCES "import_batches"("auditFirmId","id") ON DELETE CASCADE;
ALTER TABLE "datasets"        ADD CONSTRAINT "ds_batch_tfkey"  FOREIGN KEY ("auditFirmId","importBatchId")          REFERENCES "import_batches"("auditFirmId","id") ON DELETE CASCADE;
ALTER TABLE "datasets"        ADD CONSTRAINT "ds_attempt_tfkey" FOREIGN KEY ("auditFirmId","importAttemptId")       REFERENCES "import_attempts"("auditFirmId","id") ON DELETE CASCADE;
ALTER TABLE "datasets"        ADD CONSTRAINT "ds_sf_tfkey"     FOREIGN KEY ("auditFirmId","sourceFileId")           REFERENCES "source_files"("auditFirmId","id");
ALTER TABLE "imported_records" ADD CONSTRAINT "ir_ds_tfkey"    FOREIGN KEY ("auditFirmId","datasetId")              REFERENCES "datasets"("auditFirmId","id") ON DELETE CASCADE;
ALTER TABLE "imported_records" ADD CONSTRAINT "ir_batch_tfkey" FOREIGN KEY ("auditFirmId","importBatchId")          REFERENCES "import_batches"("auditFirmId","id") ON DELETE CASCADE;
ALTER TABLE "imported_records" ADD CONSTRAINT "ir_sf_tfkey"    FOREIGN KEY ("auditFirmId","sourceFileId")           REFERENCES "source_files"("auditFirmId","id");
ALTER TABLE "import_issues"   ADD CONSTRAINT "ii_batch_tfkey"  FOREIGN KEY ("auditFirmId","importBatchId")          REFERENCES "import_batches"("auditFirmId","id") ON DELETE CASCADE;
ALTER TABLE "import_issues"   ADD CONSTRAINT "ii_attempt_tfkey" FOREIGN KEY ("auditFirmId","importAttemptId")       REFERENCES "import_attempts"("auditFirmId","id") ON DELETE CASCADE;
ALTER TABLE "import_issues"   ADD CONSTRAINT "ii_ir_tfkey"     FOREIGN KEY ("auditFirmId","importedRecordId")       REFERENCES "imported_records"("auditFirmId","id") ON DELETE CASCADE;
ALTER TABLE "import_issues"   ADD CONSTRAINT "ii_ds_tfkey"     FOREIGN KEY ("auditFirmId","datasetId")              REFERENCES "datasets"("auditFirmId","id") ON DELETE CASCADE;

-- Transaction / Document lineage bridge (composite tenant FKs)
ALTER TABLE "transactions" ADD CONSTRAINT "tx_ir_tfkey" FOREIGN KEY ("auditFirmId","importedRecordId") REFERENCES "imported_records"("auditFirmId","id") ON DELETE SET NULL;
ALTER TABLE "transactions" ADD CONSTRAINT "tx_ds_tfkey" FOREIGN KEY ("auditFirmId","datasetId")        REFERENCES "datasets"("auditFirmId","id")        ON DELETE SET NULL;
ALTER TABLE "documents"    ADD CONSTRAINT "doc_sf_tfkey" FOREIGN KEY ("auditFirmId","sourceFileId")     REFERENCES "source_files"("auditFirmId","id")    ON DELETE SET NULL;

-- ============================================================================
-- G1 security parity: RLS + audit_app grants on all 9 G2 tables
-- ============================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON
  "source_files","import_profiles","import_mappings","import_mapping_versions",
  "import_batches","import_attempts","datasets","imported_records","import_issues"
  TO audit_app;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'source_files','import_profiles','import_mappings','import_mapping_versions',
    'import_batches','import_attempts','datasets','imported_records','import_issues'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I FOR ALL
      USING ("auditFirmId" = current_setting('app.audit_firm_id', true))
      WITH CHECK ("auditFirmId" = current_setting('app.audit_firm_id', true));$p$, t);
  END LOOP;
END $$;
