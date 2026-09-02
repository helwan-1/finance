import { describe, it, expect } from "vitest";
import { importedRecordEOI, mappingSemanticHash, semanticScopeAnchor, datasetAccountSemanticId } from "@/lib/g4/semantic-identity";
import { sealFold, foldMember, FOLD_SEED } from "@/lib/g4/framing";

const pop = (eois: string[]) => { let a = FOLD_SEED; for (const e of eois) a = foldMember(a, Buffer.from(e, "hex")); return sealFold("g4pop.2", a, eois.length); };

describe("G4 EOI / duplicate rows (matrix G)", () => {
  it("identical content (rawHash) at different sourceRowNo → distinct EOI", () => {
    const row10 = importedRecordEOI({ datasetHash: "D", sourceRowNo: 10, rawHash: "H_A" });
    const row11 = importedRecordEOI({ datasetHash: "D", sourceRowNo: 11, rawHash: "H_A" });
    expect(row10).not.toBe(row11);
  });
  it("{row10} != {row11} != {row10,row11} as population fingerprints", () => {
    const r10 = importedRecordEOI({ datasetHash: "D", sourceRowNo: 10, rawHash: "H_A" });
    const r11 = importedRecordEOI({ datasetHash: "D", sourceRowNo: 11, rawHash: "H_A" });
    const only10 = pop([r10]), only11 = pop([r11]), both = pop([r10, r11]);
    expect(new Set([only10, only11, both]).size).toBe(3);
  });
  it("same content re-imported under same datasetHash reproduces the same EOI (no row PK)", () => {
    const a = importedRecordEOI({ datasetHash: "D", sourceRowNo: 42, rawHash: "H" });
    const b = importedRecordEOI({ datasetHash: "D", sourceRowNo: 42, rawHash: "H" });
    expect(a).toBe(b);
  });
});

describe("G4 mappingSemanticHash (matrix K)", () => {
  const base = { datasetAccountSemanticId: datasetAccountSemanticId({ datasetHash: "D", sourceSystem: "SAP", sourceEntity: "E1", sourceLedger: "GL", sourceAccountCode: "110100" }), mappingVersion: 1, basis: "AUDITOR_ASSERTED", accountingScopeKey: "SAP:E1:GL", accountCode: "110100" };
  it("same semantic mapping → same hash (independent of relational rows)", () => {
    expect(mappingSemanticHash(base)).toBe(mappingSemanticHash({ ...base }));
  });
  it("changed version / basis / target account → different hash", () => {
    expect(mappingSemanticHash({ ...base, mappingVersion: 2 })).not.toBe(mappingSemanticHash(base));
    expect(mappingSemanticHash({ ...base, basis: "IMPORT_CONFIRMED" })).not.toBe(mappingSemanticHash(base));
    expect(mappingSemanticHash({ ...base, accountCode: "220200" })).not.toBe(mappingSemanticHash(base));
    expect(mappingSemanticHash({ ...base, accountingScopeKey: "ODOO:E2:GL" })).not.toBe(mappingSemanticHash(base));
  });
});

describe("G4 semantic scope anchor (matrix C)", () => {
  it("same client key → same anchor; different client key → different", () => {
    const a = semanticScopeAnchor({ firmLicenseNo: "LIC-A", clientSemanticKey: "vat:300", fiscalYear: 2024 });
    const a2 = semanticScopeAnchor({ firmLicenseNo: "LIC-A", clientSemanticKey: "vat:300", fiscalYear: 2024 });
    const b = semanticScopeAnchor({ firmLicenseNo: "LIC-A", clientSemanticKey: "vat:999", fiscalYear: 2024 });
    expect(a).toBe(a2);
    expect(a).not.toBe(b);
  });
});
