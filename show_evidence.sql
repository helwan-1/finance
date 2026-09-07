SELECT ar."resultCode", e."evidenceType", ir."sourceRowNo", ir."rawCells"
FROM audit_results ar
JOIN audit_result_evidence e ON e."auditResultId"=ar.id
JOIN imported_records ir ON ir.id=e."importedRecordId"
ORDER BY ir."sourceRowNo"
LIMIT 12;
