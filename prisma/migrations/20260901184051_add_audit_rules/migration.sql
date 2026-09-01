-- CreateEnum
CREATE TYPE "RuleCategory" AS ENUM ('NUMERIC', 'PARTY', 'TIMING', 'AGGREGATE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AnomalyRuleCode" ADD VALUE 'THRESHOLD_AVOIDANCE';
ALTER TYPE "AnomalyRuleCode" ADD VALUE 'GAP_SEQUENCE';
ALTER TYPE "AnomalyRuleCode" ADD VALUE 'DENYLIST_PARTY';
ALTER TYPE "AnomalyRuleCode" ADD VALUE 'MISSING_FIELD';
ALTER TYPE "AnomalyRuleCode" ADD VALUE 'BACKDATED_ENTRY';
ALTER TYPE "AnomalyRuleCode" ADD VALUE 'CUSTOM_RULE';

-- AlterTable
ALTER TABLE "anomaly_flags" ADD COLUMN     "auditRuleId" TEXT;

-- CreateTable
CREATE TABLE "audit_rules" (
    "id" TEXT NOT NULL,
    "auditFirmId" TEXT NOT NULL,
    "engagementId" TEXT,
    "name" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "category" "RuleCategory" NOT NULL,
    "severity" "AnomalySeverity" NOT NULL DEFAULT 'MEDIUM',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "descriptionAr" TEXT,
    "definition" JSONB NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "audit_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_rules_auditFirmId_enabled_idx" ON "audit_rules"("auditFirmId", "enabled");

-- CreateIndex
CREATE INDEX "audit_rules_engagementId_idx" ON "audit_rules"("engagementId");

-- CreateIndex
CREATE INDEX "anomaly_flags_auditRuleId_idx" ON "anomaly_flags"("auditRuleId");

-- AddForeignKey
ALTER TABLE "anomaly_flags" ADD CONSTRAINT "anomaly_flags_auditRuleId_fkey" FOREIGN KEY ("auditRuleId") REFERENCES "audit_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_rules" ADD CONSTRAINT "audit_rules_auditFirmId_fkey" FOREIGN KEY ("auditFirmId") REFERENCES "audit_firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_rules" ADD CONSTRAINT "audit_rules_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "audit_engagements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
