-- ---------------------------------------------------------------------------
-- Dataset deletion via a least-privilege SECURITY DEFINER function.
--
-- The runtime role (audit_app) has DELETE revoked on the canonical accounting
-- tables (immutability of frozen audit evidence). But an imported dataset that
-- has NOT been consumed by any audit run is not yet frozen evidence and should
-- be deletable for cleanup. This function — owned by the schema owner and
-- granted ONLY to audit_app — performs that guarded teardown without granting
-- audit_app any general DELETE on the accounting tables.
--
-- Guards (enforced inside the function, which bypasses RLS as DEFINER):
--   * the dataset must belong to the passed firm;
--   * the dataset must NOT be referenced by any audit run (audit_run_datasets).
-- Any remaining RESTRICT foreign key (other run/evidence references) still
-- aborts the delete, so frozen evidence is never removed.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.app_delete_dataset(p_firm text, p_dataset text)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
DECLARE v_eng text;
BEGIN
  SELECT "engagementId" INTO v_eng
    FROM public."datasets"
    WHERE "id" = p_dataset AND "auditFirmId" = p_firm;
  IF v_eng IS NULL THEN
    RAISE EXCEPTION 'dataset % not found in firm %', p_dataset, p_firm
      USING ERRCODE = 'no_data_found';
  END IF;

  IF EXISTS (SELECT 1 FROM public."audit_run_datasets" WHERE "datasetId" = p_dataset) THEN
    RAISE EXCEPTION 'dataset % is used in an audit run', p_dataset
      USING ERRCODE = 'raise_exception';
  END IF;

  -- Legacy G1 flat transactions + their dependents (leaf → root).
  DELETE FROM public."reconciliation_matches"
    WHERE "sourceTxnId" IN (SELECT "id" FROM public."transactions" WHERE "datasetId" = p_dataset)
       OR "targetTxnId" IN (SELECT "id" FROM public."transactions" WHERE "datasetId" = p_dataset);
  DELETE FROM public."anomaly_flags"
    WHERE "transactionId" IN (SELECT "id" FROM public."transactions" WHERE "datasetId" = p_dataset);
  DELETE FROM public."transactions" WHERE "datasetId" = p_dataset;

  -- G3 canonical facts (leaf → root).
  DELETE FROM public."journal_lines" WHERE "datasetId" = p_dataset;
  DELETE FROM public."trial_balance_rows" WHERE "datasetId" = p_dataset;
  DELETE FROM public."journal_entries" WHERE "datasetId" = p_dataset;
  DELETE FROM public."trial_balances" WHERE "datasetId" = p_dataset;
  DELETE FROM public."dataset_accounts" WHERE "datasetId" = p_dataset;
  DELETE FROM public."source_accounting_contexts" WHERE "datasetId" = p_dataset;

  -- G2 custody.
  DELETE FROM public."import_issues" WHERE "datasetId" = p_dataset;
  DELETE FROM public."imported_records" WHERE "datasetId" = p_dataset;

  -- Clear the self-referential pointer, then remove the dataset itself.
  UPDATE public."import_batches" SET "resultDatasetId" = NULL WHERE "resultDatasetId" = p_dataset;
  DELETE FROM public."datasets" WHERE "id" = p_dataset;
END; $$;

-- Least privilege: no PUBLIC execute; only the runtime role may call it.
REVOKE ALL ON FUNCTION public.app_delete_dataset(text, text) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'audit_app') THEN
    GRANT EXECUTE ON FUNCTION public.app_delete_dataset(text, text) TO audit_app;
  END IF;
END $$;
