-- G4-DEBT-011 — Corrective migration: restore G2 composite tenant FKs
-- that the committed G3 migration (20260902120000) incorrectly DROPs on a
-- fresh deploy. Forward-only, additive, idempotent. Definitions recovered
-- verbatim from the authoritative G2 migration (20260902100000). Zero DROPs.
-- Each FK is guarded so it is a no-op where the constraint already exists.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ds_firm_fkey') THEN
    ALTER TABLE "datasets" ADD CONSTRAINT "ds_firm_fkey" FOREIGN KEY ("auditFirmId") REFERENCES "audit_firms"("id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ds_attempt_tfkey') THEN
    ALTER TABLE "datasets" ADD CONSTRAINT "ds_attempt_tfkey" FOREIGN KEY ("auditFirmId","importAttemptId") REFERENCES "import_attempts"("auditFirmId","id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ds_batch_tfkey') THEN
    ALTER TABLE "datasets" ADD CONSTRAINT "ds_batch_tfkey" FOREIGN KEY ("auditFirmId","importBatchId") REFERENCES "import_batches"("auditFirmId","id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ds_client_fkey') THEN
    ALTER TABLE "datasets" ADD CONSTRAINT "ds_client_fkey" FOREIGN KEY ("clientCompanyId") REFERENCES "client_companies"("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ds_eng_fkey') THEN
    ALTER TABLE "datasets" ADD CONSTRAINT "ds_eng_fkey" FOREIGN KEY ("engagementId") REFERENCES "audit_engagements"("id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ds_sf_tfkey') THEN
    ALTER TABLE "datasets" ADD CONSTRAINT "ds_sf_tfkey" FOREIGN KEY ("auditFirmId","sourceFileId") REFERENCES "source_files"("auditFirmId","id");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'doc_sf_tfkey') THEN
    ALTER TABLE "documents" ADD CONSTRAINT "doc_sf_tfkey" FOREIGN KEY ("auditFirmId","sourceFileId") REFERENCES "source_files"("auditFirmId","id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ia_batch_tfkey') THEN
    ALTER TABLE "import_attempts" ADD CONSTRAINT "ia_batch_tfkey" FOREIGN KEY ("auditFirmId","importBatchId") REFERENCES "import_batches"("auditFirmId","id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ia_cuser_fkey') THEN
    ALTER TABLE "import_attempts" ADD CONSTRAINT "ia_cuser_fkey" FOREIGN KEY ("confirmedById") REFERENCES "users"("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ia_firm_fkey') THEN
    ALTER TABLE "import_attempts" ADD CONSTRAINT "ia_firm_fkey" FOREIGN KEY ("auditFirmId") REFERENCES "audit_firms"("id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ia_user_fkey') THEN
    ALTER TABLE "import_attempts" ADD CONSTRAINT "ia_user_fkey" FOREIGN KEY ("startedById") REFERENCES "users"("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ib_eng_fkey') THEN
    ALTER TABLE "import_batches" ADD CONSTRAINT "ib_eng_fkey" FOREIGN KEY ("engagementId") REFERENCES "audit_engagements"("id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ib_firm_fkey') THEN
    ALTER TABLE "import_batches" ADD CONSTRAINT "ib_firm_fkey" FOREIGN KEY ("auditFirmId") REFERENCES "audit_firms"("id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ib_mapv_tfkey') THEN
    ALTER TABLE "import_batches" ADD CONSTRAINT "ib_mapv_tfkey" FOREIGN KEY ("auditFirmId","importMappingVersionId") REFERENCES "import_mapping_versions"("auditFirmId","id");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ib_prof_tfkey') THEN
    ALTER TABLE "import_batches" ADD CONSTRAINT "ib_prof_tfkey" FOREIGN KEY ("auditFirmId","importProfileId") REFERENCES "import_profiles"("auditFirmId","id");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ib_result_tfkey') THEN
    ALTER TABLE "import_batches" ADD CONSTRAINT "ib_result_tfkey" FOREIGN KEY ("auditFirmId","resultDatasetId") REFERENCES "datasets"("auditFirmId","id");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ib_sf_tfkey') THEN
    ALTER TABLE "import_batches" ADD CONSTRAINT "ib_sf_tfkey" FOREIGN KEY ("auditFirmId","sourceFileId") REFERENCES "source_files"("auditFirmId","id");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ib_user_fkey') THEN
    ALTER TABLE "import_batches" ADD CONSTRAINT "ib_user_fkey" FOREIGN KEY ("startedById") REFERENCES "users"("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ii_attempt_tfkey') THEN
    ALTER TABLE "import_issues" ADD CONSTRAINT "ii_attempt_tfkey" FOREIGN KEY ("auditFirmId","importAttemptId") REFERENCES "import_attempts"("auditFirmId","id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ii_batch_tfkey') THEN
    ALTER TABLE "import_issues" ADD CONSTRAINT "ii_batch_tfkey" FOREIGN KEY ("auditFirmId","importBatchId") REFERENCES "import_batches"("auditFirmId","id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ii_ds_tfkey') THEN
    ALTER TABLE "import_issues" ADD CONSTRAINT "ii_ds_tfkey" FOREIGN KEY ("auditFirmId","datasetId") REFERENCES "datasets"("auditFirmId","id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ii_firm_fkey') THEN
    ALTER TABLE "import_issues" ADD CONSTRAINT "ii_firm_fkey" FOREIGN KEY ("auditFirmId") REFERENCES "audit_firms"("id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ii_ir_tfkey') THEN
    ALTER TABLE "import_issues" ADD CONSTRAINT "ii_ir_tfkey" FOREIGN KEY ("auditFirmId","importedRecordId") REFERENCES "imported_records"("auditFirmId","id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'imv_firm_fkey') THEN
    ALTER TABLE "import_mapping_versions" ADD CONSTRAINT "imv_firm_fkey" FOREIGN KEY ("auditFirmId") REFERENCES "audit_firms"("id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'imv_mapping_tfkey') THEN
    ALTER TABLE "import_mapping_versions" ADD CONSTRAINT "imv_mapping_tfkey" FOREIGN KEY ("auditFirmId","importMappingId") REFERENCES "import_mappings"("auditFirmId","id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'imv_user_fkey') THEN
    ALTER TABLE "import_mapping_versions" ADD CONSTRAINT "imv_user_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'im_client_fkey') THEN
    ALTER TABLE "import_mappings" ADD CONSTRAINT "im_client_fkey" FOREIGN KEY ("clientCompanyId") REFERENCES "client_companies"("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'im_firm_fkey') THEN
    ALTER TABLE "import_mappings" ADD CONSTRAINT "im_firm_fkey" FOREIGN KEY ("auditFirmId") REFERENCES "audit_firms"("id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ip_client_fkey') THEN
    ALTER TABLE "import_profiles" ADD CONSTRAINT "ip_client_fkey" FOREIGN KEY ("clientCompanyId") REFERENCES "client_companies"("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ip_firm_fkey') THEN
    ALTER TABLE "import_profiles" ADD CONSTRAINT "ip_firm_fkey" FOREIGN KEY ("auditFirmId") REFERENCES "audit_firms"("id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ip_user_fkey') THEN
    ALTER TABLE "import_profiles" ADD CONSTRAINT "ip_user_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ir_batch_tfkey') THEN
    ALTER TABLE "imported_records" ADD CONSTRAINT "ir_batch_tfkey" FOREIGN KEY ("auditFirmId","importBatchId") REFERENCES "import_batches"("auditFirmId","id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ir_ds_tfkey') THEN
    ALTER TABLE "imported_records" ADD CONSTRAINT "ir_ds_tfkey" FOREIGN KEY ("auditFirmId","datasetId") REFERENCES "datasets"("auditFirmId","id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ir_firm_fkey') THEN
    ALTER TABLE "imported_records" ADD CONSTRAINT "ir_firm_fkey" FOREIGN KEY ("auditFirmId") REFERENCES "audit_firms"("id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ir_sf_tfkey') THEN
    ALTER TABLE "imported_records" ADD CONSTRAINT "ir_sf_tfkey" FOREIGN KEY ("auditFirmId","sourceFileId") REFERENCES "source_files"("auditFirmId","id");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sf_client_fkey') THEN
    ALTER TABLE "source_files" ADD CONSTRAINT "sf_client_fkey" FOREIGN KEY ("clientCompanyId") REFERENCES "client_companies"("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sf_eng_fkey') THEN
    ALTER TABLE "source_files" ADD CONSTRAINT "sf_eng_fkey" FOREIGN KEY ("engagementId") REFERENCES "audit_engagements"("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sf_firm_fkey') THEN
    ALTER TABLE "source_files" ADD CONSTRAINT "sf_firm_fkey" FOREIGN KEY ("auditFirmId") REFERENCES "audit_firms"("id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sf_user_fkey') THEN
    ALTER TABLE "source_files" ADD CONSTRAINT "sf_user_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tx_ds_tfkey') THEN
    ALTER TABLE "transactions" ADD CONSTRAINT "tx_ds_tfkey" FOREIGN KEY ("auditFirmId","datasetId") REFERENCES "datasets"("auditFirmId","id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tx_ir_tfkey') THEN
    ALTER TABLE "transactions" ADD CONSTRAINT "tx_ir_tfkey" FOREIGN KEY ("auditFirmId","importedRecordId") REFERENCES "imported_records"("auditFirmId","id") ON DELETE SET NULL;
  END IF;
END $$;
