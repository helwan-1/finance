-- G2 legacy backfill (Closure C11) — honest classification, zero fabrication.
-- Idempotent. Legacy transactions with no source-file evidence get a
-- LEGACY_UNVERIFIED container Dataset with sourceFileId = NULL (no SourceFile is
-- invented). Existing Documents with real metadata get a METADATA_ONLY
-- SourceFile (sha256 = NULL). No sourceRowNo / hash / mapping / parser version
-- is ever fabricated.
DO $$
DECLARE
  e   RECORD;
  ib_id text;
  ia_id text;
  ds_id text;
  sf_id text;
BEGIN
  -- 1) Engagements with un-lineaged transactions -> legacy container (NO SourceFile).
  FOR e IN
    SELECT DISTINCT t."auditFirmId" AS firm, t."engagementId" AS eng
    FROM "transactions" t
    WHERE t."datasetId" IS NULL
  LOOP
    SELECT id INTO ib_id FROM "import_batches"
      WHERE "auditFirmId" = e.firm AND "idempotencyKey" = 'legacy:' || e.eng
      LIMIT 1;

    IF ib_id IS NULL THEN
      ib_id := 'legacy_ib_' || replace(gen_random_uuid()::text, '-', '');
      ia_id := 'legacy_ia_' || replace(gen_random_uuid()::text, '-', '');
      ds_id := 'legacy_ds_' || replace(gen_random_uuid()::text, '-', '');

      INSERT INTO "import_batches"
        (id,"auditFirmId","engagementId","sourceFileId","datasetKind",status,"idempotencyKey","rowsTotal","rowsAccepted","rowsRejected","startedAt")
      VALUES
        (ib_id,e.firm,e.eng,NULL,'OTHER','COMPLETED_WITH_ISSUES','legacy:'||e.eng,0,0,0,now());

      INSERT INTO "import_attempts"
        (id,"auditFirmId","importBatchId","attemptNo",status,"startedAt","endedAt")
      VALUES
        (ia_id,e.firm,ib_id,1,'SUCCEEDED',now(),now());

      INSERT INTO "datasets"
        (id,"auditFirmId","engagementId","importBatchId","importAttemptId","sourceFileId",kind,label,"datasetHash","lineageClass",status,"normalizerVersion","rowCountTotal","rowCountAccepted","rowCountRejected","createdAt")
      VALUES
        (ds_id,e.firm,e.eng,ib_id,ia_id,NULL,'OTHER','Legacy (pre-G2)',NULL,'LEGACY_UNVERIFIED','COMPLETED_WITH_ISSUES','legacy',0,0,0,now());

      UPDATE "import_batches" SET "resultDatasetId" = ds_id WHERE id = ib_id;
    ELSE
      SELECT id INTO ds_id FROM "datasets" WHERE "importBatchId" = ib_id LIMIT 1;
    END IF;

    UPDATE "transactions"
      SET "datasetId" = ds_id
      WHERE "auditFirmId" = e.firm AND "engagementId" = e.eng AND "datasetId" IS NULL;
  END LOOP;

  -- 2) Documents with real metadata but no SourceFile -> METADATA_ONLY custody.
  FOR e IN
    SELECT id AS doc, "auditFirmId" AS firm, "engagementId" AS eng,
           "fileName" AS fn, "mimeType" AS mt, "sizeBytes" AS sz, "storageKey" AS sk
    FROM "documents" WHERE "sourceFileId" IS NULL
  LOOP
    sf_id := 'legacy_sf_' || replace(gen_random_uuid()::text, '-', '');
    INSERT INTO "source_files"
      (id,"auditFirmId","engagementId","originalFileName","mimeType","sizeBytes","sha256","storageProvider","custodyStatus","processingBoundary","legacyStorageKeyRaw","uploadedAt","createdAt")
    VALUES
      (sf_id,e.firm,e.eng,e.fn,e.mt,e.sz::bigint,NULL,'NONE','METADATA_ONLY','NONE',e.sk,now(),now());
    UPDATE "documents" SET "sourceFileId" = sf_id WHERE id = e.doc;
  END LOOP;
END $$;
