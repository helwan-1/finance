-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'PARTNER', 'MANAGER', 'SENIOR', 'STAFF', 'REVIEWER');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('INVOICE', 'BANK_STATEMENT', 'VAT_RETURN', 'GENERAL_LEDGER', 'PURCHASE_ORDER', 'RECEIPT', 'OTHER');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('UPLOADED', 'PROCESSING', 'PARSED', 'FAILED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "TransactionSource" AS ENUM ('LEDGER', 'BANK', 'INVOICE', 'MANUAL');

-- CreateEnum
CREATE TYPE "ReconciliationStatus" AS ENUM ('DRAFT', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('MATCHED', 'PARTIAL', 'UNMATCHED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "AnomalyRuleCode" AS ENUM ('BENFORD_DEVIATION', 'DUPLICATE_EXACT', 'DUPLICATE_NEAR', 'OFF_HOURS_ENTRY', 'WEEKEND_ENTRY', 'VAT_DISCREPANCY', 'ROUND_AMOUNT', 'UNRECONCILED');

-- CreateEnum
CREATE TYPE "AnomalySeverity" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO');

-- CreateEnum
CREATE TYPE "AnomalyStatus" AS ENUM ('OPEN', 'IN_REVIEW', 'RESOLVED', 'DISMISSED', 'ESCALATED');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('VIEW_DOCUMENT', 'DOWNLOAD_DOCUMENT', 'RESOLVE_ANOMALY', 'DISMISS_ANOMALY', 'ESCALATE_ANOMALY', 'EXPORT_DATA', 'RUN_RECONCILIATION', 'RUN_ANALYSIS', 'LOGIN', 'LOGOUT');

-- CreateTable
CREATE TABLE "audit_firms" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "licenseNo" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "audit_firms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "auditFirmId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "fullNameAr" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'STAFF',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_companies" (
    "id" TEXT NOT NULL,
    "auditFirmId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "vatNumber" TEXT,
    "crNumber" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_engagements" (
    "id" TEXT NOT NULL,
    "auditFirmId" TEXT NOT NULL,
    "clientCompanyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "titleAr" TEXT NOT NULL,
    "fiscalYear" INTEGER NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'SAR',
    "isClosed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "audit_engagements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engagement_members" (
    "id" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "engagement_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "auditFirmId" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "type" "DocumentType" NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'UPLOADED',
    "fileName" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "pageCount" INTEGER,
    "parsedData" JSONB,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "parsedAt" TIMESTAMP(3),

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" TEXT NOT NULL,
    "auditFirmId" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "documentId" TEXT,
    "reference" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "vatAmount" DECIMAL(15,2),
    "currency" TEXT NOT NULL DEFAULT 'SAR',
    "type" "TransactionType" NOT NULL,
    "source" "TransactionSource" NOT NULL,
    "counterparty" TEXT,
    "account" TEXT,
    "postedAt" TIMESTAMP(3) NOT NULL,
    "valueDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_sessions" (
    "id" TEXT NOT NULL,
    "auditFirmId" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "ReconciliationStatus" NOT NULL DEFAULT 'DRAFT',
    "sourceA" "TransactionSource" NOT NULL,
    "sourceB" "TransactionSource" NOT NULL,
    "matchedCount" INTEGER NOT NULL DEFAULT 0,
    "totalCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reconciliation_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_matches" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "sourceTxnId" TEXT NOT NULL,
    "targetTxnId" TEXT,
    "status" "MatchStatus" NOT NULL DEFAULT 'UNMATCHED',
    "confidence" DECIMAL(5,4) NOT NULL,
    "amountDelta" DECIMAL(15,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reconciliation_matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "anomaly_flags" (
    "id" TEXT NOT NULL,
    "auditFirmId" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "transactionId" TEXT,
    "ruleCode" "AnomalyRuleCode" NOT NULL,
    "severity" "AnomalySeverity" NOT NULL,
    "status" "AnomalyStatus" NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "titleAr" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "descriptionAr" TEXT NOT NULL,
    "evidence" JSONB,
    "score" DECIMAL(5,2) NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "resolutionNote" TEXT,

    CONSTRAINT "anomaly_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "auditFirmId" TEXT NOT NULL,
    "engagementId" TEXT,
    "userId" TEXT NOT NULL,
    "action" "AuditAction" NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "audit_firms_licenseNo_key" ON "audit_firms"("licenseNo");

-- CreateIndex
CREATE INDEX "users_auditFirmId_idx" ON "users"("auditFirmId");

-- CreateIndex
CREATE UNIQUE INDEX "users_auditFirmId_email_key" ON "users"("auditFirmId", "email");

-- CreateIndex
CREATE INDEX "client_companies_auditFirmId_idx" ON "client_companies"("auditFirmId");

-- CreateIndex
CREATE UNIQUE INDEX "client_companies_auditFirmId_vatNumber_key" ON "client_companies"("auditFirmId", "vatNumber");

-- CreateIndex
CREATE INDEX "audit_engagements_auditFirmId_idx" ON "audit_engagements"("auditFirmId");

-- CreateIndex
CREATE INDEX "audit_engagements_clientCompanyId_idx" ON "audit_engagements"("clientCompanyId");

-- CreateIndex
CREATE INDEX "engagement_members_userId_idx" ON "engagement_members"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "engagement_members_engagementId_userId_key" ON "engagement_members"("engagementId", "userId");

-- CreateIndex
CREATE INDEX "documents_auditFirmId_idx" ON "documents"("auditFirmId");

-- CreateIndex
CREATE INDEX "documents_engagementId_status_idx" ON "documents"("engagementId", "status");

-- CreateIndex
CREATE INDEX "transactions_auditFirmId_idx" ON "transactions"("auditFirmId");

-- CreateIndex
CREATE INDEX "transactions_engagementId_postedAt_idx" ON "transactions"("engagementId", "postedAt");

-- CreateIndex
CREATE INDEX "transactions_engagementId_source_idx" ON "transactions"("engagementId", "source");

-- CreateIndex
CREATE INDEX "reconciliation_sessions_auditFirmId_idx" ON "reconciliation_sessions"("auditFirmId");

-- CreateIndex
CREATE INDEX "reconciliation_sessions_engagementId_status_idx" ON "reconciliation_sessions"("engagementId", "status");

-- CreateIndex
CREATE INDEX "reconciliation_matches_sessionId_status_idx" ON "reconciliation_matches"("sessionId", "status");

-- CreateIndex
CREATE INDEX "anomaly_flags_auditFirmId_idx" ON "anomaly_flags"("auditFirmId");

-- CreateIndex
CREATE INDEX "anomaly_flags_engagementId_status_idx" ON "anomaly_flags"("engagementId", "status");

-- CreateIndex
CREATE INDEX "anomaly_flags_engagementId_severity_idx" ON "anomaly_flags"("engagementId", "severity");

-- CreateIndex
CREATE INDEX "anomaly_flags_engagementId_ruleCode_idx" ON "anomaly_flags"("engagementId", "ruleCode");

-- CreateIndex
CREATE INDEX "anomaly_flags_engagementId_detectedAt_idx" ON "anomaly_flags"("engagementId", "detectedAt");

-- CreateIndex
CREATE INDEX "audit_logs_auditFirmId_createdAt_idx" ON "audit_logs"("auditFirmId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_engagementId_createdAt_idx" ON "audit_logs"("engagementId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_userId_idx" ON "audit_logs"("userId");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_auditFirmId_fkey" FOREIGN KEY ("auditFirmId") REFERENCES "audit_firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_companies" ADD CONSTRAINT "client_companies_auditFirmId_fkey" FOREIGN KEY ("auditFirmId") REFERENCES "audit_firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_engagements" ADD CONSTRAINT "audit_engagements_auditFirmId_fkey" FOREIGN KEY ("auditFirmId") REFERENCES "audit_firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_engagements" ADD CONSTRAINT "audit_engagements_clientCompanyId_fkey" FOREIGN KEY ("clientCompanyId") REFERENCES "client_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engagement_members" ADD CONSTRAINT "engagement_members_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "audit_engagements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engagement_members" ADD CONSTRAINT "engagement_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_auditFirmId_fkey" FOREIGN KEY ("auditFirmId") REFERENCES "audit_firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "audit_engagements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_auditFirmId_fkey" FOREIGN KEY ("auditFirmId") REFERENCES "audit_firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "audit_engagements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_sessions" ADD CONSTRAINT "reconciliation_sessions_auditFirmId_fkey" FOREIGN KEY ("auditFirmId") REFERENCES "audit_firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_sessions" ADD CONSTRAINT "reconciliation_sessions_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "audit_engagements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_matches" ADD CONSTRAINT "reconciliation_matches_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "reconciliation_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_matches" ADD CONSTRAINT "reconciliation_matches_sourceTxnId_fkey" FOREIGN KEY ("sourceTxnId") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_matches" ADD CONSTRAINT "reconciliation_matches_targetTxnId_fkey" FOREIGN KEY ("targetTxnId") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anomaly_flags" ADD CONSTRAINT "anomaly_flags_auditFirmId_fkey" FOREIGN KEY ("auditFirmId") REFERENCES "audit_firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anomaly_flags" ADD CONSTRAINT "anomaly_flags_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "audit_engagements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anomaly_flags" ADD CONSTRAINT "anomaly_flags_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anomaly_flags" ADD CONSTRAINT "anomaly_flags_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_auditFirmId_fkey" FOREIGN KEY ("auditFirmId") REFERENCES "audit_firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "audit_engagements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
