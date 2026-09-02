-- G1 Production Security Gate — PostgreSQL Row-Level Security (tenant isolation)
-- -----------------------------------------------------------------------------
-- Defense in depth. Even if an application query forgets a tenant filter, the
-- database restricts every row to the audit firm bound for the current
-- transaction in the `app.audit_firm_id` GUC (set by withTenantContext()).
--
-- Model:
--   * Runtime role  = audit_app  (NON-owner) -> SUBJECT to these policies.
--   * Migration/seed role = table owner       -> BYPASSES RLS (ENABLE, not
--     FORCE), so administrative provisioning and the first-firm insert work.
--   * current_setting('app.audit_firm_id', true) returns NULL when unset, so a
--     query with no tenant context matches NO rows (fail-closed).
--
-- The application MUST connect as audit_app (see .env.example DATABASE_URL).
-- -----------------------------------------------------------------------------

-- 1) Non-owner runtime role. Created here as a NOLOGIN placeholder so GRANTs are
--    self-contained and idempotent; an operator enables login out of band with
--    `ALTER ROLE audit_app LOGIN PASSWORD '<secret>';` so no secret enters VCS.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'audit_app') THEN
    CREATE ROLE audit_app NOLOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO audit_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO audit_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO audit_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO audit_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO audit_app;

-- 2) Tenancy root: the firm row itself (id IS the tenant key).
ALTER TABLE "audit_firms" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "audit_firms" FOR ALL
  USING ("id" = current_setting('app.audit_firm_id', true))
  WITH CHECK ("id" = current_setting('app.audit_firm_id', true));

-- 3) Tables carrying auditFirmId directly.
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "users" FOR ALL
  USING ("auditFirmId" = current_setting('app.audit_firm_id', true))
  WITH CHECK ("auditFirmId" = current_setting('app.audit_firm_id', true));

ALTER TABLE "client_companies" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "client_companies" FOR ALL
  USING ("auditFirmId" = current_setting('app.audit_firm_id', true))
  WITH CHECK ("auditFirmId" = current_setting('app.audit_firm_id', true));

ALTER TABLE "audit_engagements" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "audit_engagements" FOR ALL
  USING ("auditFirmId" = current_setting('app.audit_firm_id', true))
  WITH CHECK ("auditFirmId" = current_setting('app.audit_firm_id', true));

ALTER TABLE "documents" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "documents" FOR ALL
  USING ("auditFirmId" = current_setting('app.audit_firm_id', true))
  WITH CHECK ("auditFirmId" = current_setting('app.audit_firm_id', true));

ALTER TABLE "transactions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "transactions" FOR ALL
  USING ("auditFirmId" = current_setting('app.audit_firm_id', true))
  WITH CHECK ("auditFirmId" = current_setting('app.audit_firm_id', true));

ALTER TABLE "reconciliation_sessions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "reconciliation_sessions" FOR ALL
  USING ("auditFirmId" = current_setting('app.audit_firm_id', true))
  WITH CHECK ("auditFirmId" = current_setting('app.audit_firm_id', true));

ALTER TABLE "anomaly_flags" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "anomaly_flags" FOR ALL
  USING ("auditFirmId" = current_setting('app.audit_firm_id', true))
  WITH CHECK ("auditFirmId" = current_setting('app.audit_firm_id', true));

ALTER TABLE "audit_rules" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "audit_rules" FOR ALL
  USING ("auditFirmId" = current_setting('app.audit_firm_id', true))
  WITH CHECK ("auditFirmId" = current_setting('app.audit_firm_id', true));

ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "audit_logs" FOR ALL
  USING ("auditFirmId" = current_setting('app.audit_firm_id', true))
  WITH CHECK ("auditFirmId" = current_setting('app.audit_firm_id', true));

-- 4) Tables that inherit the tenant via a parent (no direct auditFirmId).
--    Protected via an EXISTS check against the parent's firm. G1-compatible;
--    a denormalized auditFirmId column is deferred to a later gate (v1.2
--    invariant #8) as a performance/structural optimization.
ALTER TABLE "engagement_members" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "engagement_members" FOR ALL
  USING (EXISTS (
    SELECT 1 FROM "audit_engagements" e
    WHERE e."id" = "engagement_members"."engagementId"
      AND e."auditFirmId" = current_setting('app.audit_firm_id', true)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "audit_engagements" e
    WHERE e."id" = "engagement_members"."engagementId"
      AND e."auditFirmId" = current_setting('app.audit_firm_id', true)
  ));

ALTER TABLE "reconciliation_matches" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "reconciliation_matches" FOR ALL
  USING (EXISTS (
    SELECT 1 FROM "reconciliation_sessions" s
    WHERE s."id" = "reconciliation_matches"."sessionId"
      AND s."auditFirmId" = current_setting('app.audit_firm_id', true)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "reconciliation_sessions" s
    WHERE s."id" = "reconciliation_matches"."sessionId"
      AND s."auditFirmId" = current_setting('app.audit_firm_id', true)
  ));

-- 5) Pre-authentication credential lookup. Login happens before any tenant
--    context exists, so a normal RLS-scoped read of "users" would return
--    nothing. This SECURITY DEFINER function (owned by the schema owner, which
--    is RLS-exempt) exposes ONLY the fields login needs for a single email —
--    a controlled, minimal bypass. EXECUTE is granted solely to audit_app.
CREATE OR REPLACE FUNCTION app_authenticate(p_email text)
RETURNS TABLE (
  id             text,
  "auditFirmId"  text,
  role           "UserRole",
  "fullNameAr"   text,
  "passwordHash" text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  -- Schema-qualified relation + pinned search_path: a SECURITY DEFINER function
  -- must not be resolvable via a caller-controlled search_path.
  SELECT u."id", u."auditFirmId", u."role", u."fullNameAr", u."passwordHash"
  FROM public."users" u
  WHERE u."email" = p_email AND u."isActive" = true
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION app_authenticate(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_authenticate(text) TO audit_app;
