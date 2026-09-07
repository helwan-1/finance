SELECT ds.id, ds.status,
  (SELECT count(*) FROM imported_records ir WHERE ir."datasetId"=ds.id) AS imported
FROM datasets ds ORDER BY ds."createdAt" DESC;
