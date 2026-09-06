-- G6 Phase C3-1 — Cross-tenant background work locator (ADR-006)
-- -----------------------------------------------------------------------------
-- A single, narrow, read-only, cross-tenant SECURITY DEFINER discovery function
-- plus a dedicated, minimally-privileged dispatcher principal and the one partial
-- index the ADR requires. This is DISCOVERY ONLY: the function returns opaque
-- runnable-work coordinates {auditFirmId, runId, workType} and never authorizes,
-- mutates, publishes, or acts. All real work re-enters normal tenant-scoped RLS
-- execution and re-derives authoritative state before any mutation.
--
-- Scope of this migration (ADR-006 "Schema / index contract", frozen):
--   * NEW ROLE      : audit_dispatch (NOLOGIN placeholder; no BYPASSRLS, no table
--                     grants, no schema CREATE, no role management).
--   * NEW INDEX     : ix_runs_runnable (partial, on the small runnable population).
--   * NEW FUNCTION  : app_locate_runnable_work() SECURITY DEFINER, STABLE.
--   * ACL           : REVOKE ALL FROM PUBLIC; GRANT EXECUTE TO audit_dispatch only.
-- Explicitly NOT in scope: worker, dispatcher service, scheduler, queue, outbox,
-- RLS policy changes, AuditJob status changes, new tables/columns.
-- -----------------------------------------------------------------------------

-- 1) Dedicated dispatcher principal. Created NOLOGIN so GRANTs are self-contained
--    and idempotent; an operator enables login out of band with
--    `ALTER ROLE audit_dispatch LOGIN PASSWORD '<secret>';` so no secret enters VCS.
--    CONNECT is inherited via the PUBLIC database default. This role gets ONLY
--    schema USAGE and EXECUTE on the locator below — no table privileges, no
--    BYPASSRLS. It cannot read or mutate any tenant table directly.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'audit_dispatch') THEN
    CREATE ROLE audit_dispatch NOLOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO audit_dispatch;

-- 2) The one partial index the ADR requires: it supports runnable discovery over
--    the small live population (PREPARING/QUEUED/RUNNING) instead of scanning all
--    historical/terminal runs. Terminal runs (COMPLETED/FAILED/CANCELLED/DRAFT)
--    are excluded from the index entirely.
CREATE INDEX "ix_runs_runnable"
  ON public."audit_runs" ("status", "updatedAt")
  WHERE "status" IN ('PREPARING', 'QUEUED', 'RUNNING');

-- 3) The locator. SECURITY DEFINER (owned by the schema owner, which is the
--    controlled RLS-exempt read — same pattern as G1 app_authenticate). The
--    definer's read is the ONLY cross-tenant capability introduced; it is bounded
--    to opaque coordinates and is otherwise a pure, read-only, STABLE function.
--
--    Hardening (ADR-006, frozen):
--      * SET search_path = pg_catalog, public  (not caller-controlled)
--      * every relation is schema-qualified (public.*)
--      * no caller-supplied auditFirmId; no arbitrary SQL/filter/order input
--      * STABLE, read-only, no side effects
--      * hard server-side LIMIT (200) + per-firm fairness cap (50) + updatedAt ASC
--
--    Durable work state (ADR-006, frozen):
--      * PREPARATION: run PREPARING AND a current PREPARING preparation exists.
--        Covers both unfinished chunks and the zero-undone-but-unsealed
--        (crash-after-final-chunk) state. A COMPLETE preparation is NOT background
--        work — it awaits explicit human Publish.
--      * EXECUTION: run QUEUED, OR run RUNNING whose latest AuditJob attempt is
--        RUNNING with an expired lease (leaseExpiresAt < transaction_timestamp()).
--        A RUNNING run + terminal-or-live latest attempt is not recoverable here.
CREATE OR REPLACE FUNCTION app_locate_runnable_work()
RETURNS TABLE (
  "auditFirmId" text,
  "runId"       text,
  "workType"    text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  WITH runnable AS (
    -- PREPARATION work
    SELECT
      r."auditFirmId"        AS firm,
      r."id"                 AS run,
      'PREPARATION'::text    AS wtype,
      r."updatedAt"          AS updated
    FROM public."audit_runs" r
    WHERE r."status" = 'PREPARING'::public."AuditRunStatus"
      AND EXISTS (
        SELECT 1
        FROM public."audit_run_preparations" p
        WHERE p."runId" = r."id"
          AND p."status" = 'PREPARING'::public."AuditPreparationStatus"
      )

    UNION ALL

    -- EXECUTION work
    SELECT
      r."auditFirmId"        AS firm,
      r."id"                 AS run,
      'EXECUTION'::text      AS wtype,
      r."updatedAt"          AS updated
    FROM public."audit_runs" r
    WHERE r."status" = 'QUEUED'::public."AuditRunStatus"
       OR (
         r."status" = 'RUNNING'::public."AuditRunStatus"
         AND EXISTS (
           SELECT 1
           FROM public."audit_jobs" j
           WHERE j."runId" = r."id"
             AND j."attemptNo" = (
               SELECT max(j2."attemptNo")
               FROM public."audit_jobs" j2
               WHERE j2."runId" = r."id"
             )
             AND j."status" = 'RUNNING'::public."AuditJobStatus"
             AND j."leaseExpiresAt" < transaction_timestamp()
         )
       )
  ),
  capped AS (
    -- Per-firm fairness cap: keep at most 50 oldest-waiting runnable items per firm
    -- within a single invocation, so one noisy tenant cannot monopolize the window.
    SELECT
      firm, run, wtype, updated,
      row_number() OVER (PARTITION BY firm ORDER BY updated ASC, run ASC) AS rn
    FROM runnable
  )
  SELECT
    firm  AS "auditFirmId",
    run   AS "runId",
    wtype AS "workType"
  FROM capped
  WHERE rn <= 50            -- per-firm fairness cap (ADR-006)
  ORDER BY updated ASC, run ASC
  LIMIT 200;                -- hard server-side limit (ADR-006)
$$;

-- 4) ACL (ADR-006, frozen): the function is created with EXECUTE granted to PUBLIC
--    by default; revoke that, then grant EXECUTE to the dispatcher ONLY. The
--    runtime tenant worker (audit_app) and PUBLIC get NO execute privilege.
REVOKE ALL ON FUNCTION app_locate_runnable_work() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_locate_runnable_work() TO audit_dispatch;
