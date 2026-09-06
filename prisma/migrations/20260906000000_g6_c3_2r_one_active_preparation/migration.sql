-- G6 Phase C3-2R — at most one ACTIVE (PREPARING) preparation generation per run
-- -----------------------------------------------------------------------------
-- PREP-GEN-MULTIPLICITY remediation. beginPreparation allocates generations with
-- max(generationNo)+1 under no run-level lock and the application boundary permits
-- begin while the run is already PREPARING, so two `PREPARING` AuditRunPreparation
-- rows could accumulate for one run (sequentially and under a concurrent race).
-- The frozen reproducibility model expects at most ONE unsealed/active generation
-- per run at a time (a run freezes exactly one authoritative generation via an
-- explicit-prepId publish); multiple non-PREPARING (COMPLETE/PUBLISHED/FAILED/
-- ABANDONED) generations remain legitimate.
--
-- This single, additive PARTIAL UNIQUE INDEX makes that invariant race-safe at the
-- database layer (the authoritative mechanism; the application boundary pre-check
-- is only for a clean domain error). It constrains ONLY rows with status =
-- 'PREPARING', so historical/terminal generations are untouched.
--
-- FAIL-CLOSED ON DIRTY DATA (intentional): if an already-upgraded database already
-- holds two 'PREPARING' rows for the same run, CREATE UNIQUE INDEX fails
-- (PostgreSQL 23505, "could not create unique index … contains duplicate values").
-- The migration must NOT silently pick a winner, abandon, or delete any historical
-- row; remediating dirty historical state (if ever encountered) is a separate,
-- evidence-based decision.
--
-- Scope: ONE partial unique index. No DML, no backfill, no table rebuild, no RLS
-- change, no grants change, no trigger/function change, no unrelated DROP/ALTER.
CREATE UNIQUE INDEX "ux_prep_active_generation_per_run"
  ON public."audit_run_preparations" ("runId")
  WHERE "status" = 'PREPARING';
