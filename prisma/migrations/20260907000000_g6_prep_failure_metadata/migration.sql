-- G6 PRE-C3-3C — preparation terminal-failure metadata (PREP-F1)
-- ---------------------------------------------------------------------------
-- Additive, nullable failure metadata so a deterministic preparation failure can
-- transition PREPARING → FAILED durably (stopping locator poison rediscovery)
-- while recording a sanitized, bounded cause. No backfill, no rewrite, no rebuild;
-- historical PrepChunks/ScopeMembers/ScopeResolutions are untouched. The existing
-- g4_prep_guard trigger already permits PREPARING→FAILED (only PUBLISHED is frozen).
ALTER TABLE "audit_run_preparations"
  ADD COLUMN "failureCode"   TEXT,
  ADD COLUMN "failureDetail" TEXT,
  ADD COLUMN "failedAt"      TIMESTAMP(3);
