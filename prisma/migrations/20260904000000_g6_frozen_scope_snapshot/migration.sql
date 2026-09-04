-- ADR — G4 FROZEN SEMANTIC SCOPE REPRODUCIBILITY
-- Additive only. No DROP, no destructive ALTER, no backfill, no RLS/grant change.
--
-- Snapshot the three semantic-scope inputs on the run at the real freeze
-- boundary (publishRun) so execution and historical reopen never read mutable
-- current master (AuditFirm.licenseNo, AuditEngagement.fiscalYear, client
-- semantic key). Exactly three raw fields; NO frozenScopeAnchor (derivable).

ALTER TABLE "audit_runs"
  ADD COLUMN "frozenFirmLicenseNo" TEXT,
  ADD COLUMN "frozenFiscalYear" INTEGER,
  ADD COLUMN "frozenClientSemanticKey" TEXT;

-- Extend the existing run guard (BEFORE UPDATE on audit_runs). Additive to the
-- current terminal-immutable + set-once logic:
--   (1) the three snapshot fields are set-once / non-clearable;
--   (2) NEW-freeze completeness: when a run is frozen (freezeGeneration goes
--       NULL -> non-null) all three snapshot fields MUST be present in the same
--       update. Legacy already-frozen rows (freezeGeneration already non-null)
--       are untouched and may remain NULL.
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
  -- Frozen semantic-scope snapshots are set-once / non-clearable.
  IF OLD."frozenFirmLicenseNo" IS NOT NULL AND NEW."frozenFirmLicenseNo" IS DISTINCT FROM OLD."frozenFirmLicenseNo" THEN
    RAISE EXCEPTION 'audit_runs.frozenFirmLicenseNo is set-once';
  END IF;
  IF OLD."frozenFiscalYear" IS NOT NULL AND NEW."frozenFiscalYear" IS DISTINCT FROM OLD."frozenFiscalYear" THEN
    RAISE EXCEPTION 'audit_runs.frozenFiscalYear is set-once';
  END IF;
  IF OLD."frozenClientSemanticKey" IS NOT NULL AND NEW."frozenClientSemanticKey" IS DISTINCT FROM OLD."frozenClientSemanticKey" THEN
    RAISE EXCEPTION 'audit_runs.frozenClientSemanticKey is set-once';
  END IF;
  -- Freeze completeness: freezing REQUIRES all three semantic-scope snapshots.
  IF OLD."freezeGeneration" IS NULL AND NEW."freezeGeneration" IS NOT NULL THEN
    IF NEW."frozenFirmLicenseNo" IS NULL OR NEW."frozenFiscalYear" IS NULL OR NEW."frozenClientSemanticKey" IS NULL THEN
      RAISE EXCEPTION 'audit_runs: freeze requires frozenFirmLicenseNo, frozenFiscalYear and frozenClientSemanticKey';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
