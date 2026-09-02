-- CreateEnum
CREATE TYPE "AuditTestType" AS ENUM ('RULE', 'STATISTICAL', 'RECONCILIATION', 'ACCOUNTING_INTEGRITY', 'ANALYTICAL', 'DATA_QUALITY');

-- CreateEnum
CREATE TYPE "AuditVersionStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "AuditRunStatus" AS ENUM ('DRAFT', 'PREPARING', 'QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AuditPreparationStatus" AS ENUM ('PREPARING', 'COMPLETE', 'FAILED', 'ABANDONED', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "AuditJobStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AuditFailureCode" AS ENUM ('INFRA', 'TRANSIENT', 'LEASE_LOST', 'VALIDATION', 'CONFIG', 'DETERMINISM', 'UNPINNED_DEPENDENCY');

-- CreateEnum
CREATE TYPE "ScopeEligibility" AS ENUM ('ELIGIBLE', 'PARTIALLY_ELIGIBLE', 'NOT_ELIGIBLE');

-- CreateEnum
CREATE TYPE "ScopeMembershipMode" AS ENUM ('DETERMINISTIC', 'MATERIALIZED');

-- CreateEnum
CREATE TYPE "AuditEvidenceType" AS ENUM ('IMPORTED_RECORD', 'JOURNAL_LINE', 'JOURNAL_ENTRY', 'TRIAL_BALANCE_ROW', 'DATASET');

-- CreateEnum
CREATE TYPE "AuditReviewState" AS ENUM ('OPEN', 'RESOLVED', 'DISMISSED', 'ESCALATED');

-- AlterTable
ALTER TABLE "audit_rules" ADD COLUMN     "currentVersionId" TEXT,
ADD COLUMN     "key" TEXT;

-- CreateTable
CREATE TABLE "audit_client_semantic_keys" (
    "id" TEXT NOT NULL,
    "auditFirmId" TEXT NOT NULL,
    "clientCompanyId" TEXT NOT NULL,
    "semanticKey" TEXT NOT NULL,
    "assignedById" TEXT,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_client_semantic_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_tests" (
    "id" TEXT NOT NULL,
    "auditFirmId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "testType" "AuditTestType" NOT NULL,
    "currentVersionId" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "audit_tests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_test_versions" (
    "id" TEXT NOT NULL,
    "auditFirmId" TEXT NOT NULL,
    "auditTestId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "testType" "AuditTestType" NOT NULL,
    "definitionJson" JSONB NOT NULL,
    "requirementsJson" JSONB NOT NULL,
    "auditRuleVersionId" TEXT,
    "status" "AuditVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "versionHash" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_test_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_rule_versions" (
    "id" TEXT NOT NULL,
    "auditFirmId" TEXT NOT NULL,
    "auditRuleId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "definitionJson" JSONB NOT NULL,
    "thresholdsJson" JSONB,
    "severity" "AnomalySeverity" NOT NULL DEFAULT 'MEDIUM',
    "scopeJson" JSONB,
    "status" "AuditVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "ruleVersionHash" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_rule_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_runs" (
    "id" TEXT NOT NULL,
    "auditFirmId" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "clientCompanyId" TEXT,
    "status" "AuditRunStatus" NOT NULL DEFAULT 'DRAFT',
    "engineBuildVersion" TEXT,
    "configFingerprint" TEXT,
    "freezeFormatVersion" TEXT,
    "frozenAt" TIMESTAMP(3),
    "freezeGeneration" TEXT,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "failureCode" "AuditFailureCode",
    "failureDetail" TEXT,
    "supersedesRunId" TEXT,
    "label" TEXT,
    "createdById" TEXT,
    "executedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "audit_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_run_preparations" (
    "id" TEXT NOT NULL,
    "auditFirmId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "generationNo" INTEGER NOT NULL,
    "status" "AuditPreparationStatus" NOT NULL DEFAULT 'PREPARING',
    "pinnedVersionsJson" JSONB,
    "engineBuildVersionCandidate" TEXT,
    "expectedCountsJson" JSONB,
    "eligiblePopulationFingerprintsJson" JSONB,
    "preparationManifestHash" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sealedAt" TIMESTAMP(3),

    CONSTRAINT "audit_run_preparations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_run_prep_chunks" (
    "id" TEXT NOT NULL,
    "auditFirmId" TEXT NOT NULL,
    "preparationId" TEXT NOT NULL,
    "auditTestVersionId" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "lastSourceRowNo" INTEGER,
    "cursorState" JSONB,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "audit_run_prep_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_run_datasets" (
    "id" TEXT NOT NULL,
    "auditFirmId" TEXT NOT NULL,
    "preparationId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "datasetHash" TEXT,
    "datasetKind" "DatasetKind" NOT NULL,
    "lineageClass" "LineageClass" NOT NULL,
    "orderIndex" INTEGER NOT NULL,

    CONSTRAINT "audit_run_datasets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_run_test_versions" (
    "id" TEXT NOT NULL,
    "auditFirmId" TEXT NOT NULL,
    "preparationId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "auditTestVersionId" TEXT NOT NULL,
    "testType" "AuditTestType" NOT NULL,
    "auditRuleVersionId" TEXT,
    "effectiveParametersJson" JSONB NOT NULL,
    "effectiveParametersHash" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,

    CONSTRAINT "audit_run_test_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_run_account_mapping_pins" (
    "id" TEXT NOT NULL,
    "auditFirmId" TEXT NOT NULL,
    "preparationId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "datasetAccountId" TEXT NOT NULL,
    "accountMappingVersionId" TEXT NOT NULL,
    "mappingSemanticHash" TEXT NOT NULL,

    CONSTRAINT "audit_run_account_mapping_pins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_run_scope_resolutions" (
    "id" TEXT NOT NULL,
    "auditFirmId" TEXT NOT NULL,
    "preparationId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "auditTestVersionId" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "eligibility" "ScopeEligibility" NOT NULL,
    "resolutionAlgorithmVersion" TEXT NOT NULL,
    "scopePredicateJson" JSONB,
    "scopePredicateHash" TEXT,
    "unmetRequirementsJson" JSONB,
    "sourcePopulationCount" INTEGER,
    "eligiblePopulationCount" INTEGER,
    "eligiblePopulationFingerprint" TEXT,
    "membershipMode" "ScopeMembershipMode" NOT NULL,

    CONSTRAINT "audit_run_scope_resolutions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_run_scope_members" (
    "id" TEXT NOT NULL,
    "auditFirmId" TEXT NOT NULL,
    "preparationId" TEXT NOT NULL,
    "auditTestVersionId" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "sourceRowNo" INTEGER NOT NULL,
    "evidenceType" "AuditEvidenceType" NOT NULL,
    "eoiFrameHash" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,

    CONSTRAINT "audit_run_scope_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_jobs" (
    "id" TEXT NOT NULL,
    "auditFirmId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "attemptNo" INTEGER NOT NULL,
    "status" "AuditJobStatus" NOT NULL DEFAULT 'RUNNING',
    "queuedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "leaseOwner" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3),
    "failureCode" "AuditFailureCode",
    "failureDetail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_results" (
    "id" TEXT NOT NULL,
    "auditFirmId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "auditRunTestVersionId" TEXT NOT NULL,
    "resultKind" TEXT NOT NULL,
    "resultCode" TEXT NOT NULL,
    "severity" "AnomalySeverity" NOT NULL,
    "score" DECIMAL(5,2) NOT NULL,
    "payloadJson" JSONB NOT NULL,
    "resultOccurrenceFingerprint" TEXT NOT NULL,
    "resultSemanticFingerprint" TEXT NOT NULL,
    "lineageClass" "LineageClass" NOT NULL DEFAULT 'VERIFIED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_result_evidence" (
    "id" TEXT NOT NULL,
    "auditFirmId" TEXT NOT NULL,
    "auditResultId" TEXT NOT NULL,
    "evidenceType" "AuditEvidenceType" NOT NULL,
    "role" TEXT,
    "importedRecordId" TEXT,
    "journalLineId" TEXT,
    "journalEntryId" TEXT,
    "trialBalanceRowId" TEXT,
    "datasetId" TEXT,
    "sourceRowNo" INTEGER,
    "lineNo" INTEGER,
    "sourceEntryId" TEXT,
    "eoiFrameHash" TEXT,

    CONSTRAINT "audit_result_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_result_reviews" (
    "id" TEXT NOT NULL,
    "auditFirmId" TEXT NOT NULL,
    "auditResultId" TEXT NOT NULL,
    "reviewSeq" INTEGER NOT NULL,
    "state" "AuditReviewState" NOT NULL,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "audit_result_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_client_semantic_keys_auditFirmId_idx" ON "audit_client_semantic_keys"("auditFirmId");

-- CreateIndex
CREATE UNIQUE INDEX "audit_client_semantic_keys_auditFirmId_id_key" ON "audit_client_semantic_keys"("auditFirmId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "audit_client_semantic_keys_auditFirmId_clientCompanyId_key" ON "audit_client_semantic_keys"("auditFirmId", "clientCompanyId");

-- CreateIndex
CREATE UNIQUE INDEX "audit_client_semantic_keys_auditFirmId_semanticKey_key" ON "audit_client_semantic_keys"("auditFirmId", "semanticKey");

-- CreateIndex
CREATE INDEX "audit_tests_auditFirmId_idx" ON "audit_tests"("auditFirmId");

-- CreateIndex
CREATE UNIQUE INDEX "audit_tests_auditFirmId_id_key" ON "audit_tests"("auditFirmId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "audit_tests_auditFirmId_key_key" ON "audit_tests"("auditFirmId", "key");

-- CreateIndex
CREATE INDEX "audit_test_versions_auditFirmId_idx" ON "audit_test_versions"("auditFirmId");

-- CreateIndex
CREATE INDEX "audit_test_versions_auditTestId_idx" ON "audit_test_versions"("auditTestId");

-- CreateIndex
CREATE UNIQUE INDEX "audit_test_versions_auditFirmId_id_key" ON "audit_test_versions"("auditFirmId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "audit_test_versions_auditTestId_version_key" ON "audit_test_versions"("auditTestId", "version");

-- CreateIndex
CREATE INDEX "audit_rule_versions_auditFirmId_idx" ON "audit_rule_versions"("auditFirmId");

-- CreateIndex
CREATE INDEX "audit_rule_versions_auditRuleId_idx" ON "audit_rule_versions"("auditRuleId");

-- CreateIndex
CREATE UNIQUE INDEX "audit_rule_versions_auditFirmId_id_key" ON "audit_rule_versions"("auditFirmId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "audit_rule_versions_auditRuleId_version_key" ON "audit_rule_versions"("auditRuleId", "version");

-- CreateIndex
CREATE INDEX "audit_runs_auditFirmId_idx" ON "audit_runs"("auditFirmId");

-- CreateIndex
CREATE INDEX "audit_runs_auditFirmId_engagementId_status_idx" ON "audit_runs"("auditFirmId", "engagementId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "audit_runs_auditFirmId_id_key" ON "audit_runs"("auditFirmId", "id");

-- CreateIndex
CREATE INDEX "audit_run_preparations_auditFirmId_idx" ON "audit_run_preparations"("auditFirmId");

-- CreateIndex
CREATE INDEX "audit_run_preparations_runId_idx" ON "audit_run_preparations"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "audit_run_preparations_auditFirmId_id_key" ON "audit_run_preparations"("auditFirmId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "audit_run_preparations_runId_generationNo_key" ON "audit_run_preparations"("runId", "generationNo");

-- CreateIndex
CREATE UNIQUE INDEX "audit_run_preparations_auditFirmId_runId_id_key" ON "audit_run_preparations"("auditFirmId", "runId", "id");

-- CreateIndex
CREATE INDEX "audit_run_prep_chunks_auditFirmId_idx" ON "audit_run_prep_chunks"("auditFirmId");

-- CreateIndex
CREATE UNIQUE INDEX "audit_run_prep_chunks_auditFirmId_id_key" ON "audit_run_prep_chunks"("auditFirmId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "audit_run_prep_chunks_preparationId_auditTestVersionId_data_key" ON "audit_run_prep_chunks"("preparationId", "auditTestVersionId", "datasetId");

-- CreateIndex
CREATE INDEX "audit_run_datasets_auditFirmId_idx" ON "audit_run_datasets"("auditFirmId");

-- CreateIndex
CREATE INDEX "audit_run_datasets_preparationId_idx" ON "audit_run_datasets"("preparationId");

-- CreateIndex
CREATE UNIQUE INDEX "audit_run_datasets_auditFirmId_id_key" ON "audit_run_datasets"("auditFirmId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "audit_run_datasets_preparationId_datasetId_key" ON "audit_run_datasets"("preparationId", "datasetId");

-- CreateIndex
CREATE INDEX "audit_run_test_versions_auditFirmId_idx" ON "audit_run_test_versions"("auditFirmId");

-- CreateIndex
CREATE INDEX "audit_run_test_versions_preparationId_idx" ON "audit_run_test_versions"("preparationId");

-- CreateIndex
CREATE UNIQUE INDEX "audit_run_test_versions_auditFirmId_id_key" ON "audit_run_test_versions"("auditFirmId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "audit_run_test_versions_preparationId_auditTestVersionId_key" ON "audit_run_test_versions"("preparationId", "auditTestVersionId");

-- CreateIndex
CREATE INDEX "audit_run_account_mapping_pins_auditFirmId_idx" ON "audit_run_account_mapping_pins"("auditFirmId");

-- CreateIndex
CREATE INDEX "audit_run_account_mapping_pins_preparationId_idx" ON "audit_run_account_mapping_pins"("preparationId");

-- CreateIndex
CREATE UNIQUE INDEX "audit_run_account_mapping_pins_auditFirmId_id_key" ON "audit_run_account_mapping_pins"("auditFirmId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "audit_run_account_mapping_pins_preparationId_datasetAccount_key" ON "audit_run_account_mapping_pins"("preparationId", "datasetAccountId", "accountMappingVersionId");

-- CreateIndex
CREATE INDEX "audit_run_scope_resolutions_auditFirmId_idx" ON "audit_run_scope_resolutions"("auditFirmId");

-- CreateIndex
CREATE INDEX "audit_run_scope_resolutions_preparationId_idx" ON "audit_run_scope_resolutions"("preparationId");

-- CreateIndex
CREATE UNIQUE INDEX "audit_run_scope_resolutions_auditFirmId_id_key" ON "audit_run_scope_resolutions"("auditFirmId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "audit_run_scope_resolutions_preparationId_auditTestVersionI_key" ON "audit_run_scope_resolutions"("preparationId", "auditTestVersionId", "datasetId");

-- CreateIndex
CREATE INDEX "audit_run_scope_members_auditFirmId_idx" ON "audit_run_scope_members"("auditFirmId");

-- CreateIndex
CREATE INDEX "audit_run_scope_members_preparationId_auditTestVersionId_da_idx" ON "audit_run_scope_members"("preparationId", "auditTestVersionId", "datasetId");

-- CreateIndex
CREATE UNIQUE INDEX "audit_run_scope_members_auditFirmId_id_key" ON "audit_run_scope_members"("auditFirmId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "audit_run_scope_members_preparationId_auditTestVersionId_da_key" ON "audit_run_scope_members"("preparationId", "auditTestVersionId", "datasetId", "sourceRowNo");

-- CreateIndex
CREATE INDEX "audit_jobs_auditFirmId_idx" ON "audit_jobs"("auditFirmId");

-- CreateIndex
CREATE INDEX "audit_jobs_auditFirmId_status_leaseExpiresAt_idx" ON "audit_jobs"("auditFirmId", "status", "leaseExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "audit_jobs_auditFirmId_id_key" ON "audit_jobs"("auditFirmId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "audit_jobs_runId_attemptNo_key" ON "audit_jobs"("runId", "attemptNo");

-- CreateIndex
CREATE INDEX "audit_results_auditFirmId_idx" ON "audit_results"("auditFirmId");

-- CreateIndex
CREATE INDEX "audit_results_auditFirmId_runId_idx" ON "audit_results"("auditFirmId", "runId");

-- CreateIndex
CREATE INDEX "audit_results_auditFirmId_runId_auditRunTestVersionId_idx" ON "audit_results"("auditFirmId", "runId", "auditRunTestVersionId");

-- CreateIndex
CREATE INDEX "audit_results_auditFirmId_resultSemanticFingerprint_idx" ON "audit_results"("auditFirmId", "resultSemanticFingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "audit_results_auditFirmId_id_key" ON "audit_results"("auditFirmId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "audit_results_auditFirmId_runId_resultOccurrenceFingerprint_key" ON "audit_results"("auditFirmId", "runId", "resultOccurrenceFingerprint");

-- CreateIndex
CREATE INDEX "audit_result_evidence_auditFirmId_idx" ON "audit_result_evidence"("auditFirmId");

-- CreateIndex
CREATE INDEX "audit_result_evidence_auditFirmId_auditResultId_idx" ON "audit_result_evidence"("auditFirmId", "auditResultId");

-- CreateIndex
CREATE INDEX "audit_result_evidence_auditFirmId_journalLineId_idx" ON "audit_result_evidence"("auditFirmId", "journalLineId");

-- CreateIndex
CREATE INDEX "audit_result_evidence_auditFirmId_importedRecordId_idx" ON "audit_result_evidence"("auditFirmId", "importedRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "audit_result_evidence_auditFirmId_id_key" ON "audit_result_evidence"("auditFirmId", "id");

-- CreateIndex
CREATE INDEX "audit_result_reviews_auditFirmId_idx" ON "audit_result_reviews"("auditFirmId");

-- CreateIndex
CREATE INDEX "audit_result_reviews_auditFirmId_auditResultId_idx" ON "audit_result_reviews"("auditFirmId", "auditResultId");

-- CreateIndex
CREATE UNIQUE INDEX "audit_result_reviews_auditFirmId_id_key" ON "audit_result_reviews"("auditFirmId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "audit_result_reviews_auditResultId_reviewSeq_key" ON "audit_result_reviews"("auditResultId", "reviewSeq");

-- CreateIndex
CREATE UNIQUE INDEX "audit_rules_auditFirmId_key_key" ON "audit_rules"("auditFirmId", "key");

-- ============================================================================
-- G4 relational integrity, RLS, immutability, and invariant enforcement (raw)
-- ============================================================================

-- Tenant root FKs (auditFirmId -> audit_firms.id) on all 16 G4 tables
ALTER TABLE "audit_client_semantic_keys"    ADD CONSTRAINT "acsk_firm_fkey" FOREIGN KEY ("auditFirmId") REFERENCES "audit_firms"("id") ON DELETE CASCADE;
ALTER TABLE "audit_tests"                    ADD CONSTRAINT "at_firm_fkey"   FOREIGN KEY ("auditFirmId") REFERENCES "audit_firms"("id") ON DELETE CASCADE;
ALTER TABLE "audit_test_versions"            ADD CONSTRAINT "atv_firm_fkey"  FOREIGN KEY ("auditFirmId") REFERENCES "audit_firms"("id") ON DELETE CASCADE;
ALTER TABLE "audit_rule_versions"            ADD CONSTRAINT "arv_firm_fkey"  FOREIGN KEY ("auditFirmId") REFERENCES "audit_firms"("id") ON DELETE CASCADE;
ALTER TABLE "audit_runs"                     ADD CONSTRAINT "ar_firm_fkey"   FOREIGN KEY ("auditFirmId") REFERENCES "audit_firms"("id") ON DELETE CASCADE;
ALTER TABLE "audit_run_preparations"         ADD CONSTRAINT "arp_firm_fkey"  FOREIGN KEY ("auditFirmId") REFERENCES "audit_firms"("id") ON DELETE CASCADE;
ALTER TABLE "audit_run_prep_chunks"          ADD CONSTRAINT "arpc_firm_fkey" FOREIGN KEY ("auditFirmId") REFERENCES "audit_firms"("id") ON DELETE CASCADE;
ALTER TABLE "audit_run_datasets"             ADD CONSTRAINT "ard_firm_fkey"  FOREIGN KEY ("auditFirmId") REFERENCES "audit_firms"("id") ON DELETE CASCADE;
ALTER TABLE "audit_run_test_versions"        ADD CONSTRAINT "artv_firm_fkey" FOREIGN KEY ("auditFirmId") REFERENCES "audit_firms"("id") ON DELETE CASCADE;
ALTER TABLE "audit_run_account_mapping_pins" ADD CONSTRAINT "aramp_firm_fkey" FOREIGN KEY ("auditFirmId") REFERENCES "audit_firms"("id") ON DELETE CASCADE;
ALTER TABLE "audit_run_scope_resolutions"    ADD CONSTRAINT "arsr_firm_fkey" FOREIGN KEY ("auditFirmId") REFERENCES "audit_firms"("id") ON DELETE CASCADE;
ALTER TABLE "audit_run_scope_members"        ADD CONSTRAINT "arsm_firm_fkey" FOREIGN KEY ("auditFirmId") REFERENCES "audit_firms"("id") ON DELETE CASCADE;
ALTER TABLE "audit_jobs"                      ADD CONSTRAINT "aj_firm_fkey"   FOREIGN KEY ("auditFirmId") REFERENCES "audit_firms"("id") ON DELETE CASCADE;
ALTER TABLE "audit_results"                   ADD CONSTRAINT "ares_firm_fkey" FOREIGN KEY ("auditFirmId") REFERENCES "audit_firms"("id") ON DELETE CASCADE;
ALTER TABLE "audit_result_evidence"           ADD CONSTRAINT "arev_firm_fkey" FOREIGN KEY ("auditFirmId") REFERENCES "audit_firms"("id") ON DELETE CASCADE;
ALTER TABLE "audit_result_reviews"            ADD CONSTRAINT "arr_firm_fkey"  FOREIGN KEY ("auditFirmId") REFERENCES "audit_firms"("id") ON DELETE CASCADE;

-- Simple context FKs (client / engagement / user; G2 precedent for G1 tables)
ALTER TABLE "audit_client_semantic_keys" ADD CONSTRAINT "acsk_client_fkey" FOREIGN KEY ("clientCompanyId") REFERENCES "client_companies"("id") ON DELETE CASCADE;
ALTER TABLE "audit_client_semantic_keys" ADD CONSTRAINT "acsk_user_fkey"   FOREIGN KEY ("assignedById")    REFERENCES "users"("id")            ON DELETE SET NULL;
ALTER TABLE "audit_tests"          ADD CONSTRAINT "at_user_fkey"  FOREIGN KEY ("createdById")  REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "audit_test_versions"  ADD CONSTRAINT "atv_user_fkey" FOREIGN KEY ("createdById")  REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "audit_rule_versions"  ADD CONSTRAINT "arv_user_fkey" FOREIGN KEY ("createdById")  REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "audit_rule_versions"  ADD CONSTRAINT "arv_rule_fkey" FOREIGN KEY ("auditRuleId")  REFERENCES "audit_rules"("id") ON DELETE CASCADE;
ALTER TABLE "audit_runs"           ADD CONSTRAINT "ar_eng_fkey"    FOREIGN KEY ("engagementId")    REFERENCES "audit_engagements"("id") ON DELETE CASCADE;
ALTER TABLE "audit_runs"           ADD CONSTRAINT "ar_client_fkey" FOREIGN KEY ("clientCompanyId") REFERENCES "client_companies"("id")  ON DELETE SET NULL;
ALTER TABLE "audit_runs"           ADD CONSTRAINT "ar_cuser_fkey"  FOREIGN KEY ("createdById")     REFERENCES "users"("id")            ON DELETE SET NULL;
ALTER TABLE "audit_runs"           ADD CONSTRAINT "ar_euser_fkey"  FOREIGN KEY ("executedById")    REFERENCES "users"("id")            ON DELETE SET NULL;
ALTER TABLE "audit_runs"           ADD CONSTRAINT "ar_super_fkey"  FOREIGN KEY ("supersedesRunId") REFERENCES "audit_runs"("id")        ON DELETE SET NULL;
ALTER TABLE "audit_result_reviews" ADD CONSTRAINT "arr_user_fkey"  FOREIGN KEY ("reviewedById")    REFERENCES "users"("id")            ON DELETE SET NULL;

-- Additive: audit_rules.currentVersionId -> audit_rule_versions (composite tenant FK)
ALTER TABLE "audit_rules" ADD CONSTRAINT "arule_curver_tfkey" FOREIGN KEY ("auditFirmId","currentVersionId") REFERENCES "audit_rule_versions"("auditFirmId","id");

-- Composite TENANT FKs (auditFirmId, X) -> parent(auditFirmId, id)
ALTER TABLE "audit_tests"         ADD CONSTRAINT "at_curver_tfkey"  FOREIGN KEY ("auditFirmId","currentVersionId")   REFERENCES "audit_test_versions"("auditFirmId","id");
ALTER TABLE "audit_test_versions" ADD CONSTRAINT "atv_test_tfkey"   FOREIGN KEY ("auditFirmId","auditTestId")        REFERENCES "audit_tests"("auditFirmId","id") ON DELETE CASCADE;
ALTER TABLE "audit_test_versions" ADD CONSTRAINT "atv_rulever_tfkey" FOREIGN KEY ("auditFirmId","auditRuleVersionId") REFERENCES "audit_rule_versions"("auditFirmId","id");

-- AuditRun.freezeGeneration must be a preparation of THIS run (same firm+run)
ALTER TABLE "audit_runs" ADD CONSTRAINT "ar_freezegen_tfkey" FOREIGN KEY ("auditFirmId","id","freezeGeneration") REFERENCES "audit_run_preparations"("auditFirmId","runId","id") ON DELETE RESTRICT;

ALTER TABLE "audit_run_preparations" ADD CONSTRAINT "arp_run_tfkey"  FOREIGN KEY ("auditFirmId","runId") REFERENCES "audit_runs"("auditFirmId","id") ON DELETE CASCADE;

ALTER TABLE "audit_run_prep_chunks" ADD CONSTRAINT "arpc_prep_tfkey" FOREIGN KEY ("auditFirmId","preparationId")      REFERENCES "audit_run_preparations"("auditFirmId","id") ON DELETE CASCADE;
ALTER TABLE "audit_run_prep_chunks" ADD CONSTRAINT "arpc_atv_tfkey"  FOREIGN KEY ("auditFirmId","auditTestVersionId") REFERENCES "audit_test_versions"("auditFirmId","id");
ALTER TABLE "audit_run_prep_chunks" ADD CONSTRAINT "arpc_ds_tfkey"   FOREIGN KEY ("auditFirmId","datasetId")          REFERENCES "datasets"("auditFirmId","id");

ALTER TABLE "audit_run_datasets" ADD CONSTRAINT "ard_prep_tfkey" FOREIGN KEY ("auditFirmId","preparationId") REFERENCES "audit_run_preparations"("auditFirmId","id") ON DELETE CASCADE;
ALTER TABLE "audit_run_datasets" ADD CONSTRAINT "ard_run_tfkey"  FOREIGN KEY ("auditFirmId","runId")         REFERENCES "audit_runs"("auditFirmId","id") ON DELETE CASCADE;
ALTER TABLE "audit_run_datasets" ADD CONSTRAINT "ard_ds_tfkey"   FOREIGN KEY ("auditFirmId","datasetId")     REFERENCES "datasets"("auditFirmId","id");

ALTER TABLE "audit_run_test_versions" ADD CONSTRAINT "artv_prep_tfkey" FOREIGN KEY ("auditFirmId","preparationId")      REFERENCES "audit_run_preparations"("auditFirmId","id") ON DELETE CASCADE;
ALTER TABLE "audit_run_test_versions" ADD CONSTRAINT "artv_run_tfkey"  FOREIGN KEY ("auditFirmId","runId")             REFERENCES "audit_runs"("auditFirmId","id") ON DELETE CASCADE;
ALTER TABLE "audit_run_test_versions" ADD CONSTRAINT "artv_atv_tfkey"  FOREIGN KEY ("auditFirmId","auditTestVersionId") REFERENCES "audit_test_versions"("auditFirmId","id");
ALTER TABLE "audit_run_test_versions" ADD CONSTRAINT "artv_arv_tfkey"  FOREIGN KEY ("auditFirmId","auditRuleVersionId") REFERENCES "audit_rule_versions"("auditFirmId","id");

ALTER TABLE "audit_run_account_mapping_pins" ADD CONSTRAINT "aramp_prep_tfkey" FOREIGN KEY ("auditFirmId","preparationId")           REFERENCES "audit_run_preparations"("auditFirmId","id") ON DELETE CASCADE;
ALTER TABLE "audit_run_account_mapping_pins" ADD CONSTRAINT "aramp_run_tfkey"  FOREIGN KEY ("auditFirmId","runId")                   REFERENCES "audit_runs"("auditFirmId","id") ON DELETE CASCADE;
ALTER TABLE "audit_run_account_mapping_pins" ADD CONSTRAINT "aramp_da_tfkey"   FOREIGN KEY ("auditFirmId","datasetAccountId")        REFERENCES "dataset_accounts"("auditFirmId","id");
ALTER TABLE "audit_run_account_mapping_pins" ADD CONSTRAINT "aramp_amv_tfkey"  FOREIGN KEY ("auditFirmId","accountMappingVersionId") REFERENCES "account_mapping_versions"("auditFirmId","id");

ALTER TABLE "audit_run_scope_resolutions" ADD CONSTRAINT "arsr_prep_tfkey" FOREIGN KEY ("auditFirmId","preparationId")      REFERENCES "audit_run_preparations"("auditFirmId","id") ON DELETE CASCADE;
ALTER TABLE "audit_run_scope_resolutions" ADD CONSTRAINT "arsr_run_tfkey"  FOREIGN KEY ("auditFirmId","runId")             REFERENCES "audit_runs"("auditFirmId","id") ON DELETE CASCADE;
ALTER TABLE "audit_run_scope_resolutions" ADD CONSTRAINT "arsr_atv_tfkey"  FOREIGN KEY ("auditFirmId","auditTestVersionId") REFERENCES "audit_test_versions"("auditFirmId","id");
ALTER TABLE "audit_run_scope_resolutions" ADD CONSTRAINT "arsr_ds_tfkey"   FOREIGN KEY ("auditFirmId","datasetId")         REFERENCES "datasets"("auditFirmId","id");

ALTER TABLE "audit_run_scope_members" ADD CONSTRAINT "arsm_prep_tfkey" FOREIGN KEY ("auditFirmId","preparationId")      REFERENCES "audit_run_preparations"("auditFirmId","id") ON DELETE CASCADE;
ALTER TABLE "audit_run_scope_members" ADD CONSTRAINT "arsm_atv_tfkey"  FOREIGN KEY ("auditFirmId","auditTestVersionId") REFERENCES "audit_test_versions"("auditFirmId","id");
ALTER TABLE "audit_run_scope_members" ADD CONSTRAINT "arsm_ds_tfkey"   FOREIGN KEY ("auditFirmId","datasetId")         REFERENCES "datasets"("auditFirmId","id");

ALTER TABLE "audit_jobs" ADD CONSTRAINT "aj_run_tfkey" FOREIGN KEY ("auditFirmId","runId") REFERENCES "audit_runs"("auditFirmId","id") ON DELETE CASCADE;

ALTER TABLE "audit_results" ADD CONSTRAINT "ares_run_tfkey"  FOREIGN KEY ("auditFirmId","runId")                 REFERENCES "audit_runs"("auditFirmId","id") ON DELETE CASCADE;
ALTER TABLE "audit_results" ADD CONSTRAINT "ares_artv_tfkey" FOREIGN KEY ("auditFirmId","auditRunTestVersionId") REFERENCES "audit_run_test_versions"("auditFirmId","id");

ALTER TABLE "audit_result_evidence" ADD CONSTRAINT "arev_res_tfkey" FOREIGN KEY ("auditFirmId","auditResultId")     REFERENCES "audit_results"("auditFirmId","id") ON DELETE CASCADE;
ALTER TABLE "audit_result_evidence" ADD CONSTRAINT "arev_ir_tfkey"  FOREIGN KEY ("auditFirmId","importedRecordId")  REFERENCES "imported_records"("auditFirmId","id");
ALTER TABLE "audit_result_evidence" ADD CONSTRAINT "arev_jl_tfkey"  FOREIGN KEY ("auditFirmId","journalLineId")     REFERENCES "journal_lines"("auditFirmId","id");
ALTER TABLE "audit_result_evidence" ADD CONSTRAINT "arev_je_tfkey"  FOREIGN KEY ("auditFirmId","journalEntryId")    REFERENCES "journal_entries"("auditFirmId","id");
ALTER TABLE "audit_result_evidence" ADD CONSTRAINT "arev_tbr_tfkey" FOREIGN KEY ("auditFirmId","trialBalanceRowId") REFERENCES "trial_balance_rows"("auditFirmId","id");
ALTER TABLE "audit_result_evidence" ADD CONSTRAINT "arev_ds_tfkey"  FOREIGN KEY ("auditFirmId","datasetId")         REFERENCES "datasets"("auditFirmId","id");

ALTER TABLE "audit_result_reviews" ADD CONSTRAINT "arr_res_tfkey" FOREIGN KEY ("auditFirmId","auditResultId") REFERENCES "audit_results"("auditFirmId","id") ON DELETE CASCADE;

-- ============================================================================
-- CHECK invariants
-- ============================================================================
-- RULE test → rule version required; non-RULE → none (denormalized testType).
ALTER TABLE "audit_run_test_versions" ADD CONSTRAINT "artv_rule_reqd_chk"
  CHECK ( ("testType" = 'RULE' AND "auditRuleVersionId" IS NOT NULL)
       OR ("testType" <> 'RULE' AND "auditRuleVersionId" IS NULL) );

-- Typed evidence: exactly one target populated, matching evidenceType.
ALTER TABLE "audit_result_evidence" ADD CONSTRAINT "arev_one_target_chk" CHECK (
  ("evidenceType" = 'IMPORTED_RECORD'   AND "importedRecordId" IS NOT NULL AND "journalLineId" IS NULL AND "journalEntryId" IS NULL AND "trialBalanceRowId" IS NULL AND "datasetId" IS NULL) OR
  ("evidenceType" = 'JOURNAL_LINE'      AND "journalLineId" IS NOT NULL AND "importedRecordId" IS NULL AND "journalEntryId" IS NULL AND "trialBalanceRowId" IS NULL AND "datasetId" IS NULL) OR
  ("evidenceType" = 'JOURNAL_ENTRY'     AND "journalEntryId" IS NOT NULL AND "importedRecordId" IS NULL AND "journalLineId" IS NULL AND "trialBalanceRowId" IS NULL AND "datasetId" IS NULL) OR
  ("evidenceType" = 'TRIAL_BALANCE_ROW' AND "trialBalanceRowId" IS NOT NULL AND "importedRecordId" IS NULL AND "journalLineId" IS NULL AND "journalEntryId" IS NULL AND "datasetId" IS NULL) OR
  ("evidenceType" = 'DATASET'           AND "datasetId" IS NOT NULL AND "importedRecordId" IS NULL AND "journalLineId" IS NULL AND "journalEntryId" IS NULL AND "trialBalanceRowId" IS NULL)
);

-- ============================================================================
-- G1 parity: RLS + tenant_isolation on all 16 G4 tables
-- ============================================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'audit_client_semantic_keys','audit_tests','audit_test_versions','audit_rule_versions',
    'audit_runs','audit_run_preparations','audit_run_prep_chunks','audit_run_datasets',
    'audit_run_test_versions','audit_run_account_mapping_pins','audit_run_scope_resolutions',
    'audit_run_scope_members','audit_jobs','audit_results','audit_result_evidence','audit_result_reviews'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I FOR ALL
      USING ("auditFirmId" = current_setting('app.audit_firm_id', true))
      WITH CHECK ("auditFirmId" = current_setting('app.audit_firm_id', true));$p$, t);
  END LOOP;
END $$;

-- ============================================================================
-- Privileges + IMMUTABILITY (DB-enforced, not convention)
--   IMMUTABLE (SELECT, INSERT only): versions, business facts, results,
--     evidence, reviews, client semantic keys.
--   STATEFUL, no DELETE (SELECT, INSERT, UPDATE): audit_runs, audit_jobs, prep_chunks.
--   FULL CRUD: audit_tests (master), audit_run_preparations (stateful + GC).
-- ============================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON "audit_tests","audit_run_preparations" TO audit_app;
GRANT SELECT, INSERT, UPDATE ON "audit_runs","audit_jobs","audit_run_prep_chunks" TO audit_app;
GRANT SELECT, INSERT ON
  "audit_client_semantic_keys","audit_test_versions","audit_rule_versions",
  "audit_run_datasets","audit_run_test_versions","audit_run_account_mapping_pins",
  "audit_run_scope_resolutions","audit_run_scope_members",
  "audit_results","audit_result_evidence","audit_result_reviews" TO audit_app;

REVOKE UPDATE, DELETE ON
  "audit_client_semantic_keys","audit_test_versions","audit_rule_versions",
  "audit_run_datasets","audit_run_test_versions","audit_run_account_mapping_pins",
  "audit_run_scope_resolutions","audit_run_scope_members",
  "audit_results","audit_result_evidence","audit_result_reviews" FROM audit_app;
REVOKE DELETE ON "audit_runs","audit_jobs","audit_run_prep_chunks" FROM audit_app;

-- ============================================================================
-- Set-once / terminal-immutability triggers (defense in depth)
-- ============================================================================
CREATE OR REPLACE FUNCTION g4_audit_run_guard() RETURNS trigger AS $$
BEGIN
  -- Terminal runs are frozen.
  IF OLD."status" IN ('COMPLETED','FAILED','CANCELLED') THEN
    RAISE EXCEPTION 'audit_runs: row is terminal (%) and immutable', OLD."status";
  END IF;
  -- Frozen columns are set-once (once non-null they cannot change).
  IF OLD."configFingerprint" IS NOT NULL AND NEW."configFingerprint" IS DISTINCT FROM OLD."configFingerprint" THEN
    RAISE EXCEPTION 'audit_runs.configFingerprint is set-once';
  END IF;
  IF OLD."engineBuildVersion" IS NOT NULL AND NEW."engineBuildVersion" IS DISTINCT FROM OLD."engineBuildVersion" THEN
    RAISE EXCEPTION 'audit_runs.engineBuildVersion is set-once';
  END IF;
  IF OLD."freezeGeneration" IS NOT NULL AND NEW."freezeGeneration" IS DISTINCT FROM OLD."freezeGeneration" THEN
    RAISE EXCEPTION 'audit_runs.freezeGeneration is set-once (authoritative generation cannot be replaced)';
  END IF;
  IF OLD."frozenAt" IS NOT NULL AND NEW."frozenAt" IS DISTINCT FROM OLD."frozenAt" THEN
    RAISE EXCEPTION 'audit_runs.frozenAt is set-once';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER g4_audit_run_guard_trg BEFORE UPDATE ON "audit_runs"
  FOR EACH ROW EXECUTE FUNCTION g4_audit_run_guard();

CREATE OR REPLACE FUNCTION g4_prep_guard() RETURNS trigger AS $$
BEGIN
  IF OLD."status" = 'PUBLISHED' THEN
    RAISE EXCEPTION 'audit_run_preparations: PUBLISHED generation is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER g4_prep_guard_trg BEFORE UPDATE ON "audit_run_preparations"
  FOR EACH ROW EXECUTE FUNCTION g4_prep_guard();
