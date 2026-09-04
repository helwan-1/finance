-- G5 — PROFESSIONAL DISPOSITION & FINDINGS (single additive migration).
-- Base (tables/enums/indexes) generated via schema→schema diff (drift-cancelling);
-- FKs, CHECKs, RLS, grants, triggers, and category seed hand-authored below.
-- ZERO changes to frozen G4/G3 models. Exactly ONE additive pre-G5 change:
-- audit_engagements(auditFirmId,id) UNIQUE (to support composite tenant FKs).

-- CreateEnum
CREATE TYPE "AuditDispositionAction" AS ENUM ('MARK_UNDER_REVIEW', 'MARK_NOT_RELEVANT', 'MARK_FALSE_POSITIVE', 'MARK_EXPLAINED', 'REQUIRE_INVESTIGATION', 'LINK_TO_EXCEPTION', 'UNLINK_FROM_EXCEPTION');

-- CreateEnum
CREATE TYPE "AuditResultDispositionKind" AS ENUM ('UNREVIEWED', 'UNDER_REVIEW', 'DISPOSED', 'INVESTIGATING', 'LINKED');

-- CreateEnum
CREATE TYPE "AuditExceptionStatus" AS ENUM ('OPEN', 'UNDER_INVESTIGATION', 'CONCLUDED_WITH_FINDING', 'CLOSED_NO_FINDING');

-- CreateEnum
CREATE TYPE "AuditExceptionEventType" AS ENUM ('CREATE', 'STATUS', 'OWNER', 'NARRATIVE', 'LINK', 'UNLINK', 'MERGE', 'SPLIT', 'REOPEN');

-- CreateEnum
CREATE TYPE "AuditFindingStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'CONCLUDED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "AuditFindingReviewAction" AS ENUM ('SUBMIT', 'APPROVE', 'RETURN', 'WITHDRAW', 'SUPERSEDE');

-- CreateEnum
CREATE TYPE "AuditMatterPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateTable
CREATE TABLE "audit_result_disposition_states" (
    "id" TEXT NOT NULL,
    "auditFirmId" TEXT NOT NULL,
    "auditResultId" TEXT NOT NULL,
    "currentState" "AuditResultDispositionKind" NOT NULL DEFAULT 'UNREVIEWED',
    "latestEventSeq" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "audit_result_disposition_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_result_disposition_events" (
    "id" TEXT NOT NULL,
    "auditFirmId" TEXT NOT NULL,
    "auditResultId" TEXT NOT NULL,
    "eventSeq" INTEGER NOT NULL,
    "action" "AuditDispositionAction" NOT NULL,
    "actorId" TEXT NOT NULL,
    "exceptionId" TEXT,
    "note" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_result_disposition_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_exceptions" (
    "id" TEXT NOT NULL,
    "auditFirmId" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "matterCorrelationKey" TEXT,
    "currentStatus" "AuditExceptionStatus" NOT NULL DEFAULT 'OPEN',
    "currentOwnerId" TEXT,
    "currentTitle" TEXT NOT NULL,
    "currentTitleAr" TEXT,
    "currentDescription" TEXT,
    "priority" "AuditMatterPriority" NOT NULL DEFAULT 'MEDIUM',
    "membershipFingerprint" TEXT,
    "latestEventSeq" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "audit_exceptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_exception_events" (
    "id" TEXT NOT NULL,
    "auditFirmId" TEXT NOT NULL,
    "exceptionId" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "eventSeq" INTEGER NOT NULL,
    "eventType" "AuditExceptionEventType" NOT NULL,
    "actorId" TEXT NOT NULL,
    "auditResultId" TEXT,
    "toStatus" "AuditExceptionStatus",
    "toOwnerId" TEXT,
    "title" TEXT,
    "titleAr" TEXT,
    "description" TEXT,
    "targetExceptionId" TEXT,
    "note" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_exception_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_exception_result_links" (
    "id" TEXT NOT NULL,
    "auditFirmId" TEXT NOT NULL,
    "exceptionId" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "auditResultId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastEventSeq" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "audit_exception_result_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_findings" (
    "id" TEXT NOT NULL,
    "auditFirmId" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "exceptionId" TEXT NOT NULL,
    "currentStatus" "AuditFindingStatus" NOT NULL DEFAULT 'DRAFT',
    "currentVersionId" TEXT,
    "latestReviewSeq" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "audit_findings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_finding_versions" (
    "id" TEXT NOT NULL,
    "auditFirmId" TEXT NOT NULL,
    "findingId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "condition" TEXT NOT NULL,
    "criteria" TEXT NOT NULL,
    "cause" TEXT NOT NULL,
    "effect" TEXT NOT NULL,
    "auditorConclusion" TEXT NOT NULL,
    "recommendation" TEXT,
    "observedAmount" DECIMAL(24,6),
    "observedCurrency" TEXT,
    "estimatedExposureAmount" DECIMAL(24,6),
    "estimatedExposureCurrency" TEXT,
    "preparedById" TEXT NOT NULL,
    "preparedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "contentHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_finding_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_finding_review_events" (
    "id" TEXT NOT NULL,
    "auditFirmId" TEXT NOT NULL,
    "findingId" TEXT NOT NULL,
    "findingVersionId" TEXT NOT NULL,
    "eventSeq" INTEGER NOT NULL,
    "action" "AuditFindingReviewAction" NOT NULL,
    "actorId" TEXT NOT NULL,
    "note" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_finding_review_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_finding_category_refs" (
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "labelAr" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "audit_finding_category_refs_pkey" PRIMARY KEY ("code")
);

-- CreateIndex
CREATE INDEX "audit_result_disposition_states_auditFirmId_idx" ON "audit_result_disposition_states"("auditFirmId");

-- CreateIndex
CREATE UNIQUE INDEX "audit_result_disposition_states_auditFirmId_id_key" ON "audit_result_disposition_states"("auditFirmId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "audit_result_disposition_states_auditFirmId_auditResultId_key" ON "audit_result_disposition_states"("auditFirmId", "auditResultId");

-- CreateIndex
CREATE INDEX "audit_result_disposition_events_auditFirmId_idx" ON "audit_result_disposition_events"("auditFirmId");

-- CreateIndex
CREATE INDEX "audit_result_disposition_events_auditFirmId_auditResultId_idx" ON "audit_result_disposition_events"("auditFirmId", "auditResultId");

-- CreateIndex
CREATE UNIQUE INDEX "audit_result_disposition_events_auditFirmId_id_key" ON "audit_result_disposition_events"("auditFirmId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "audit_result_disposition_events_auditFirmId_auditResultId_e_key" ON "audit_result_disposition_events"("auditFirmId", "auditResultId", "eventSeq");

-- CreateIndex
CREATE UNIQUE INDEX "audit_result_disposition_events_auditFirmId_auditResultId_a_key" ON "audit_result_disposition_events"("auditFirmId", "auditResultId", "actorId", "action", "idempotencyKey");

-- CreateIndex
CREATE INDEX "audit_exceptions_auditFirmId_idx" ON "audit_exceptions"("auditFirmId");

-- CreateIndex
CREATE INDEX "audit_exceptions_auditFirmId_engagementId_idx" ON "audit_exceptions"("auditFirmId", "engagementId");

-- CreateIndex
CREATE INDEX "audit_exceptions_auditFirmId_matterCorrelationKey_idx" ON "audit_exceptions"("auditFirmId", "matterCorrelationKey");

-- CreateIndex
CREATE UNIQUE INDEX "audit_exceptions_auditFirmId_id_key" ON "audit_exceptions"("auditFirmId", "id");

-- CreateIndex
CREATE INDEX "audit_exception_events_auditFirmId_idx" ON "audit_exception_events"("auditFirmId");

-- CreateIndex
CREATE INDEX "audit_exception_events_auditFirmId_exceptionId_idx" ON "audit_exception_events"("auditFirmId", "exceptionId");

-- CreateIndex
CREATE UNIQUE INDEX "audit_exception_events_auditFirmId_id_key" ON "audit_exception_events"("auditFirmId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "audit_exception_events_auditFirmId_exceptionId_eventSeq_key" ON "audit_exception_events"("auditFirmId", "exceptionId", "eventSeq");

-- CreateIndex
CREATE UNIQUE INDEX "audit_exception_events_auditFirmId_exceptionId_actorId_even_key" ON "audit_exception_events"("auditFirmId", "exceptionId", "actorId", "eventType", "idempotencyKey");

-- CreateIndex
CREATE INDEX "audit_exception_result_links_auditFirmId_idx" ON "audit_exception_result_links"("auditFirmId");

-- CreateIndex
CREATE INDEX "audit_exception_result_links_auditFirmId_exceptionId_idx" ON "audit_exception_result_links"("auditFirmId", "exceptionId");

-- CreateIndex
CREATE INDEX "audit_exception_result_links_auditFirmId_auditResultId_idx" ON "audit_exception_result_links"("auditFirmId", "auditResultId");

-- CreateIndex
CREATE UNIQUE INDEX "audit_exception_result_links_auditFirmId_id_key" ON "audit_exception_result_links"("auditFirmId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "audit_exception_result_links_auditFirmId_exceptionId_auditR_key" ON "audit_exception_result_links"("auditFirmId", "exceptionId", "auditResultId");

-- CreateIndex
CREATE INDEX "audit_findings_auditFirmId_idx" ON "audit_findings"("auditFirmId");

-- CreateIndex
CREATE INDEX "audit_findings_auditFirmId_exceptionId_idx" ON "audit_findings"("auditFirmId", "exceptionId");

-- CreateIndex
CREATE INDEX "audit_findings_auditFirmId_engagementId_idx" ON "audit_findings"("auditFirmId", "engagementId");

-- CreateIndex
CREATE UNIQUE INDEX "audit_findings_auditFirmId_id_key" ON "audit_findings"("auditFirmId", "id");

-- CreateIndex
CREATE INDEX "audit_finding_versions_auditFirmId_idx" ON "audit_finding_versions"("auditFirmId");

-- CreateIndex
CREATE INDEX "audit_finding_versions_auditFirmId_findingId_idx" ON "audit_finding_versions"("auditFirmId", "findingId");

-- CreateIndex
CREATE UNIQUE INDEX "audit_finding_versions_auditFirmId_id_key" ON "audit_finding_versions"("auditFirmId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "audit_finding_versions_auditFirmId_findingId_versionNo_key" ON "audit_finding_versions"("auditFirmId", "findingId", "versionNo");

-- CreateIndex
CREATE INDEX "audit_finding_review_events_auditFirmId_idx" ON "audit_finding_review_events"("auditFirmId");

-- CreateIndex
CREATE INDEX "audit_finding_review_events_auditFirmId_findingId_idx" ON "audit_finding_review_events"("auditFirmId", "findingId");

-- CreateIndex
CREATE UNIQUE INDEX "audit_finding_review_events_auditFirmId_id_key" ON "audit_finding_review_events"("auditFirmId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "audit_finding_review_events_auditFirmId_findingId_eventSeq_key" ON "audit_finding_review_events"("auditFirmId", "findingId", "eventSeq");

-- CreateIndex
CREATE UNIQUE INDEX "audit_finding_review_events_auditFirmId_findingId_actorId_a_key" ON "audit_finding_review_events"("auditFirmId", "findingId", "actorId", "action", "idempotencyKey");


-- ============================================================================
-- G5 command idempotency keys (additive G5 columns) — enable check-first,
-- graceful same-key replay and different-payload conflict per command class.
-- ============================================================================
ALTER TABLE "audit_exceptions"      ADD COLUMN "creationIdempotencyKey" TEXT;
ALTER TABLE "audit_findings"        ADD COLUMN "creationIdempotencyKey" TEXT;
ALTER TABLE "audit_finding_versions" ADD COLUMN "idempotencyKey" TEXT;
CREATE UNIQUE INDEX "audit_exceptions_auditFirmId_creationIdempotencyKey_key" ON "audit_exceptions"("auditFirmId","creationIdempotencyKey");
CREATE UNIQUE INDEX "audit_findings_auditFirmId_creationIdempotencyKey_key" ON "audit_findings"("auditFirmId","creationIdempotencyKey");
CREATE UNIQUE INDEX "audit_finding_versions_auditFirmId_findingId_idempotencyKey_key" ON "audit_finding_versions"("auditFirmId","findingId","idempotencyKey");

-- ============================================================================
-- Authorized additive pre-G5 change: composite-unique to enable tenant-safe
-- engagement FKs (PK(id) alone is insufficient for (auditFirmId,id) FK target).
-- ============================================================================
CREATE UNIQUE INDEX "audit_engagements_auditFirmId_id_key" ON "audit_engagements"("auditFirmId", "id");

-- ============================================================================
-- CHECK constraints (currency paired with its amount; currency non-empty).
-- ============================================================================
ALTER TABLE "audit_finding_versions" ADD CONSTRAINT "afv_observed_pair_chk"
  CHECK (("observedCurrency" IS NULL) = ("observedAmount" IS NULL));
ALTER TABLE "audit_finding_versions" ADD CONSTRAINT "afv_estimated_pair_chk"
  CHECK (("estimatedExposureCurrency" IS NULL) = ("estimatedExposureAmount" IS NULL));
ALTER TABLE "audit_finding_versions" ADD CONSTRAINT "afv_ccy_nonempty_chk"
  CHECK (("observedCurrency" IS NULL OR length("observedCurrency") > 0)
     AND ("estimatedExposureCurrency" IS NULL OR length("estimatedExposureCurrency") > 0));

-- ============================================================================
-- Simple tenant-root FKs (every G5 tenant table → audit_firms).
-- ============================================================================
ALTER TABLE "audit_result_disposition_states" ADD CONSTRAINT "ards_firm_fkey" FOREIGN KEY ("auditFirmId") REFERENCES "audit_firms"("id") ON DELETE CASCADE;
ALTER TABLE "audit_result_disposition_events" ADD CONSTRAINT "arde_firm_fkey" FOREIGN KEY ("auditFirmId") REFERENCES "audit_firms"("id") ON DELETE CASCADE;
ALTER TABLE "audit_exceptions"                ADD CONSTRAINT "aex_firm_fkey"  FOREIGN KEY ("auditFirmId") REFERENCES "audit_firms"("id") ON DELETE CASCADE;
ALTER TABLE "audit_exception_events"          ADD CONSTRAINT "aee_firm_fkey"  FOREIGN KEY ("auditFirmId") REFERENCES "audit_firms"("id") ON DELETE CASCADE;
ALTER TABLE "audit_exception_result_links"    ADD CONSTRAINT "aerl_firm_fkey" FOREIGN KEY ("auditFirmId") REFERENCES "audit_firms"("id") ON DELETE CASCADE;
ALTER TABLE "audit_findings"                  ADD CONSTRAINT "afin_firm_fkey" FOREIGN KEY ("auditFirmId") REFERENCES "audit_firms"("id") ON DELETE CASCADE;
ALTER TABLE "audit_finding_versions"          ADD CONSTRAINT "afv_firm_fkey"  FOREIGN KEY ("auditFirmId") REFERENCES "audit_firms"("id") ON DELETE CASCADE;
ALTER TABLE "audit_finding_review_events"     ADD CONSTRAINT "afre_firm_fkey" FOREIGN KEY ("auditFirmId") REFERENCES "audit_firms"("id") ON DELETE CASCADE;

-- ============================================================================
-- Composite tenant FKs to frozen G4 facts (reference only) and G0 engagements.
-- (auditFirmId,<col>) → parent(auditFirmId,id). MATCH SIMPLE: skipped when the
-- optional column is NULL. Referencing frozen tables does NOT modify them.
-- ============================================================================
ALTER TABLE "audit_result_disposition_states" ADD CONSTRAINT "ards_result_tfkey" FOREIGN KEY ("auditFirmId","auditResultId") REFERENCES "audit_results"("auditFirmId","id");
ALTER TABLE "audit_result_disposition_events" ADD CONSTRAINT "arde_result_tfkey" FOREIGN KEY ("auditFirmId","auditResultId") REFERENCES "audit_results"("auditFirmId","id");
ALTER TABLE "audit_result_disposition_events" ADD CONSTRAINT "arde_exc_tfkey"    FOREIGN KEY ("auditFirmId","exceptionId")   REFERENCES "audit_exceptions"("auditFirmId","id");

ALTER TABLE "audit_exceptions"       ADD CONSTRAINT "aex_eng_tfkey"  FOREIGN KEY ("auditFirmId","engagementId") REFERENCES "audit_engagements"("auditFirmId","id");
ALTER TABLE "audit_exception_events" ADD CONSTRAINT "aee_exc_tfkey"  FOREIGN KEY ("auditFirmId","exceptionId")   REFERENCES "audit_exceptions"("auditFirmId","id") ON DELETE CASCADE;
ALTER TABLE "audit_exception_events" ADD CONSTRAINT "aee_res_tfkey"  FOREIGN KEY ("auditFirmId","auditResultId") REFERENCES "audit_results"("auditFirmId","id");
ALTER TABLE "audit_exception_events" ADD CONSTRAINT "aee_tgt_tfkey"  FOREIGN KEY ("auditFirmId","targetExceptionId") REFERENCES "audit_exceptions"("auditFirmId","id");

ALTER TABLE "audit_exception_result_links" ADD CONSTRAINT "aerl_exc_tfkey" FOREIGN KEY ("auditFirmId","exceptionId")   REFERENCES "audit_exceptions"("auditFirmId","id") ON DELETE CASCADE;
ALTER TABLE "audit_exception_result_links" ADD CONSTRAINT "aerl_res_tfkey" FOREIGN KEY ("auditFirmId","auditResultId") REFERENCES "audit_results"("auditFirmId","id");
ALTER TABLE "audit_exception_result_links" ADD CONSTRAINT "aerl_eng_tfkey" FOREIGN KEY ("auditFirmId","engagementId") REFERENCES "audit_engagements"("auditFirmId","id");

ALTER TABLE "audit_findings"          ADD CONSTRAINT "afin_exc_tfkey" FOREIGN KEY ("auditFirmId","exceptionId")      REFERENCES "audit_exceptions"("auditFirmId","id");
ALTER TABLE "audit_findings"          ADD CONSTRAINT "afin_eng_tfkey" FOREIGN KEY ("auditFirmId","engagementId")     REFERENCES "audit_engagements"("auditFirmId","id");
ALTER TABLE "audit_findings"          ADD CONSTRAINT "afin_cver_tfkey" FOREIGN KEY ("auditFirmId","currentVersionId") REFERENCES "audit_finding_versions"("auditFirmId","id");
ALTER TABLE "audit_finding_versions"  ADD CONSTRAINT "afv_finding_tfkey" FOREIGN KEY ("auditFirmId","findingId")      REFERENCES "audit_findings"("auditFirmId","id") ON DELETE CASCADE;
ALTER TABLE "audit_finding_versions"  ADD CONSTRAINT "afv_category_fkey" FOREIGN KEY ("category") REFERENCES "audit_finding_category_refs"("code");
ALTER TABLE "audit_finding_review_events" ADD CONSTRAINT "afre_finding_tfkey" FOREIGN KEY ("auditFirmId","findingId")        REFERENCES "audit_findings"("auditFirmId","id") ON DELETE CASCADE;
ALTER TABLE "audit_finding_review_events" ADD CONSTRAINT "afre_ver_tfkey"     FOREIGN KEY ("auditFirmId","findingVersionId") REFERENCES "audit_finding_versions"("auditFirmId","id");

-- ============================================================================
-- Actor FKs → users(id) ON DELETE RESTRICT (preserve professional accountability).
-- ============================================================================
ALTER TABLE "audit_result_disposition_events" ADD CONSTRAINT "arde_actor_fkey" FOREIGN KEY ("actorId")     REFERENCES "users"("id") ON DELETE RESTRICT;
ALTER TABLE "audit_exceptions"                ADD CONSTRAINT "aex_creator_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT;
ALTER TABLE "audit_exceptions"                ADD CONSTRAINT "aex_owner_fkey"   FOREIGN KEY ("currentOwnerId") REFERENCES "users"("id") ON DELETE RESTRICT;
ALTER TABLE "audit_exception_events"          ADD CONSTRAINT "aee_actor_fkey"   FOREIGN KEY ("actorId")     REFERENCES "users"("id") ON DELETE RESTRICT;
ALTER TABLE "audit_exception_events"          ADD CONSTRAINT "aee_owner_fkey"   FOREIGN KEY ("toOwnerId")   REFERENCES "users"("id") ON DELETE RESTRICT;
ALTER TABLE "audit_findings"                  ADD CONSTRAINT "afin_creator_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT;
ALTER TABLE "audit_finding_versions"          ADD CONSTRAINT "afv_prep_fkey"    FOREIGN KEY ("preparedById") REFERENCES "users"("id") ON DELETE RESTRICT;
ALTER TABLE "audit_finding_review_events"     ADD CONSTRAINT "afre_actor_fkey"  FOREIGN KEY ("actorId")     REFERENCES "users"("id") ON DELETE RESTRICT;

-- ============================================================================
-- RLS (G1 parity): tenant_isolation on all 8 G5 tenant tables (category ref is
-- a controlled GLOBAL lookup — no tenant column, no RLS).
-- ============================================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'audit_result_disposition_states','audit_result_disposition_events',
    'audit_exceptions','audit_exception_events','audit_exception_result_links',
    'audit_findings','audit_finding_versions','audit_finding_review_events'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I FOR ALL
      USING ("auditFirmId" = current_setting('app.audit_firm_id', true))
      WITH CHECK ("auditFirmId" = current_setting('app.audit_firm_id', true));$p$, t);
  END LOOP;
END $$;

-- ============================================================================
-- Privileges + IMMUTABILITY (DB-enforced).
--   Append-only (SELECT, INSERT; no UPDATE/DELETE): all event + version tables.
--   Header/projection (SELECT, INSERT, UPDATE; no DELETE): states, exceptions,
--     result links, findings.
--   Category ref: SELECT only (seeded here by the owner).
-- ============================================================================
GRANT SELECT, INSERT, UPDATE ON
  "audit_result_disposition_states","audit_exceptions","audit_exception_result_links","audit_findings" TO audit_app;
GRANT SELECT, INSERT ON
  "audit_result_disposition_events","audit_exception_events","audit_finding_versions","audit_finding_review_events" TO audit_app;
GRANT SELECT ON "audit_finding_category_refs" TO audit_app;

REVOKE UPDATE, DELETE ON
  "audit_result_disposition_events","audit_exception_events","audit_finding_versions","audit_finding_review_events" FROM audit_app;
REVOKE DELETE ON
  "audit_result_disposition_states","audit_exceptions","audit_exception_result_links","audit_findings" FROM audit_app;
REVOKE INSERT, UPDATE, DELETE ON "audit_finding_category_refs" FROM audit_app;

-- ============================================================================
-- Helper functions (INVOKER rights → RLS applies; STABLE). No SECURITY DEFINER
-- is required: every read is same-tenant under the caller's app.audit_firm_id.
-- ============================================================================

-- Helpers are INVOKER (RLS applies under the caller's app.audit_firm_id) but every
-- object reference is SCHEMA-QUALIFIED and search_path is PINNED to
-- (pg_catalog, public), so integrity enforcement cannot be redirected through an
-- attacker-controlled schema. SECURITY DEFINER is intentionally NOT used.
CREATE OR REPLACE FUNCTION public.g5_result_engagement(p_firm text, p_result text) RETURNS text
  LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT ar."engagementId"
  FROM public."audit_results" ares JOIN public."audit_runs" ar ON ar."id" = ares."runId"
  WHERE ares."id" = p_result AND ares."auditFirmId" = p_firm AND ar."auditFirmId" = p_firm;
$$;

CREATE OR REPLACE FUNCTION public.g5_finding_engagement(p_firm text, p_finding text) RETURNS text
  LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT f."engagementId" FROM public."audit_findings" f
  WHERE f."id" = p_finding AND f."auditFirmId" = p_firm;
$$;

CREATE OR REPLACE FUNCTION public.g5_is_member(p_firm text, p_eng text, p_user text) RETURNS boolean
  LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public."engagement_members" em
    JOIN public."audit_engagements" e ON e."id" = em."engagementId"
    WHERE em."engagementId" = p_eng AND em."userId" = p_user AND e."auditFirmId" = p_firm
  );
$$;

-- Cross-engagement link guard (result's run engagement must equal link engagement).
CREATE OR REPLACE FUNCTION public.g5_link_engagement_guard() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE run_eng text;
BEGIN
  IF NEW."auditResultId" IS NULL THEN RETURN NEW; END IF;
  run_eng := public.g5_result_engagement(NEW."auditFirmId", NEW."auditResultId");
  IF run_eng IS NULL THEN
    RAISE EXCEPTION 'g5: audit result % not in firm %', NEW."auditResultId", NEW."auditFirmId";
  END IF;
  IF run_eng IS DISTINCT FROM NEW."engagementId" THEN
    RAISE EXCEPTION 'g5: cross-engagement link forbidden (result engagement=% link engagement=%)', run_eng, NEW."engagementId";
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER g5_link_guard_links_trg BEFORE INSERT OR UPDATE ON "audit_exception_result_links"
  FOR EACH ROW EXECUTE FUNCTION public.g5_link_engagement_guard();
CREATE TRIGGER g5_link_guard_events_trg BEFORE INSERT ON "audit_exception_events"
  FOR EACH ROW EXECUTE FUNCTION public.g5_link_engagement_guard();

-- Reviewer != preparer (SoD), bound to the exact reviewed version.
CREATE OR REPLACE FUNCTION public.g5_review_preparer_guard() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE prep text;
BEGIN
  IF NEW."action" IN ('APPROVE','RETURN') THEN
    SELECT fv."preparedById" INTO prep FROM public."audit_finding_versions" fv
      WHERE fv."id" = NEW."findingVersionId" AND fv."auditFirmId" = NEW."auditFirmId";
    IF prep IS NULL THEN
      RAISE EXCEPTION 'g5: finding version % not in firm %', NEW."findingVersionId", NEW."auditFirmId";
    END IF;
    IF prep = NEW."actorId" THEN
      RAISE EXCEPTION 'g5: reviewer must differ from preparer (segregation of duties)';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER g5_review_preparer_guard_trg BEFORE INSERT ON "audit_finding_review_events"
  FOR EACH ROW EXECUTE FUNCTION public.g5_review_preparer_guard();

-- Actor engagement-membership guards (DB-backed; actor must be a member).
CREATE OR REPLACE FUNCTION public.g5_membership_guard_disposition() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE eng text;
BEGIN
  eng := public.g5_result_engagement(NEW."auditFirmId", NEW."auditResultId");
  IF eng IS NULL THEN RAISE EXCEPTION 'g5: result % not in firm %', NEW."auditResultId", NEW."auditFirmId"; END IF;
  IF NOT public.g5_is_member(NEW."auditFirmId", eng, NEW."actorId") THEN
    RAISE EXCEPTION 'g5: actor % is not a member of engagement %', NEW."actorId", eng;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER g5_membership_disposition_trg BEFORE INSERT ON "audit_result_disposition_events"
  FOR EACH ROW EXECUTE FUNCTION public.g5_membership_guard_disposition();

CREATE OR REPLACE FUNCTION public.g5_membership_guard_exception() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT public.g5_is_member(NEW."auditFirmId", NEW."engagementId", NEW."createdById") THEN
    RAISE EXCEPTION 'g5: creator % is not a member of engagement %', NEW."createdById", NEW."engagementId";
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER g5_membership_exception_trg BEFORE INSERT ON "audit_exceptions"
  FOR EACH ROW EXECUTE FUNCTION public.g5_membership_guard_exception();

CREATE OR REPLACE FUNCTION public.g5_membership_guard_exc_event() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT public.g5_is_member(NEW."auditFirmId", NEW."engagementId", NEW."actorId") THEN
    RAISE EXCEPTION 'g5: actor % is not a member of engagement %', NEW."actorId", NEW."engagementId";
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER g5_membership_exc_event_trg BEFORE INSERT ON "audit_exception_events"
  FOR EACH ROW EXECUTE FUNCTION public.g5_membership_guard_exc_event();

CREATE OR REPLACE FUNCTION public.g5_membership_guard_finding() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT public.g5_is_member(NEW."auditFirmId", NEW."engagementId", NEW."createdById") THEN
    RAISE EXCEPTION 'g5: creator % is not a member of engagement %', NEW."createdById", NEW."engagementId";
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER g5_membership_finding_trg BEFORE INSERT ON "audit_findings"
  FOR EACH ROW EXECUTE FUNCTION public.g5_membership_guard_finding();

CREATE OR REPLACE FUNCTION public.g5_membership_guard_finding_ver() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE eng text;
BEGIN
  eng := public.g5_finding_engagement(NEW."auditFirmId", NEW."findingId");
  IF eng IS NULL THEN RAISE EXCEPTION 'g5: finding % not in firm %', NEW."findingId", NEW."auditFirmId"; END IF;
  IF NOT public.g5_is_member(NEW."auditFirmId", eng, NEW."preparedById") THEN
    RAISE EXCEPTION 'g5: preparer % is not a member of engagement %', NEW."preparedById", eng;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER g5_membership_finding_ver_trg BEFORE INSERT ON "audit_finding_versions"
  FOR EACH ROW EXECUTE FUNCTION public.g5_membership_guard_finding_ver();

CREATE OR REPLACE FUNCTION public.g5_membership_guard_review() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE eng text;
BEGIN
  eng := public.g5_finding_engagement(NEW."auditFirmId", NEW."findingId");
  IF eng IS NULL THEN RAISE EXCEPTION 'g5: finding % not in firm %', NEW."findingId", NEW."auditFirmId"; END IF;
  IF NOT public.g5_is_member(NEW."auditFirmId", eng, NEW."actorId") THEN
    RAISE EXCEPTION 'g5: actor % is not a member of engagement %', NEW."actorId", eng;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER g5_membership_review_trg BEFORE INSERT ON "audit_finding_review_events"
  FOR EACH ROW EXECUTE FUNCTION public.g5_membership_guard_review();

-- Least privilege: no PUBLIC EXECUTE on any G5 function; only the runtime role.
DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.g5_result_engagement(text,text)','public.g5_finding_engagement(text,text)','public.g5_is_member(text,text,text)',
    'public.g5_link_engagement_guard()','public.g5_review_preparer_guard()','public.g5_membership_guard_disposition()',
    'public.g5_membership_guard_exception()','public.g5_membership_guard_exc_event()','public.g5_membership_guard_finding()',
    'public.g5_membership_guard_finding_ver()','public.g5_membership_guard_review()'
  ] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC;', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO audit_app;', fn);
  END LOOP;
END $$;


-- ============================================================================
-- Category taxonomy seed (idempotent; owner-inserted; app has SELECT only).
-- ============================================================================
INSERT INTO "audit_finding_category_refs" ("code","label","labelAr","active","sortOrder") VALUES
  ('FS_MISSTATEMENT',      'Financial statement misstatement', 'تحريف في القوائم المالية', true, 10),
  ('CONTROL_DEFICIENCY',   'Control deficiency',               'قصور في الرقابة',           true, 20),
  ('COMPLIANCE_MATTER',    'Compliance matter',                'مسألة امتثال',               true, 30),
  ('FRAUD_RISK_INDICATOR', 'Fraud risk indicator',             'مؤشر مخاطر احتيال',          true, 40),
  ('DATA_QUALITY_MATTER',  'Data quality matter',              'مسألة جودة بيانات',          true, 50),
  ('OTHER',                'Other audit matter',               'مسألة تدقيق أخرى',           true, 90)
ON CONFLICT ("code") DO NOTHING;
