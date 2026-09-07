SELECT r.id, r.status,
  (SELECT count(*) FROM audit_run_datasets d WHERE d."preparationId"=r."freezeGeneration") AS ds_in_prep,
  (SELECT count(*) FROM audit_run_scope_members m WHERE m."preparationId"=r."freezeGeneration") AS members,
  (SELECT count(*) FROM audit_results a WHERE a."runId"=r.id) AS results
FROM audit_runs r ORDER BY r."createdAt" DESC;

SELECT ds.id, ds.status,
  (SELECT count(*) FROM imported_records ir WHERE ir."datasetId"=ds.id) AS imported
FROM datasets ds ORDER BY ds."createdAt" DESC;
