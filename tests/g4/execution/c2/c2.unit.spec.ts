import { describe, it, expect } from "vitest";
import { journalEntryEOI } from "@/lib/g4/semantic-identity";

describe("C2 g4je.1 journal-entry EOI (unit)", () => {
  it("same datasetHash + sourceEntryId → same EOI (retry / re-import stable)", () => {
    expect(journalEntryEOI({ datasetHash: "DH", sourceEntryId: "E1" }))
      .toBe(journalEntryEOI({ datasetHash: "DH", sourceEntryId: "E1" }));
  });
  it("same sourceEntryId in a different dataset (different content) → different EOI", () => {
    expect(journalEntryEOI({ datasetHash: "DH1", sourceEntryId: "E1" }))
      .not.toBe(journalEntryEOI({ datasetHash: "DH2", sourceEntryId: "E1" }));
  });
  it("different sourceEntryId in the same dataset → different EOI", () => {
    expect(journalEntryEOI({ datasetHash: "DH", sourceEntryId: "E1" }))
      .not.toBe(journalEntryEOI({ datasetHash: "DH", sourceEntryId: "E2" }));
  });
});
