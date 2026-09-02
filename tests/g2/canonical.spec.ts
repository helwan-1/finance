import { describe, it, expect } from "vitest";
import {
  rawHash, datasetHash, profileHash, mappingHash, sha256Bytes, type RawCell,
} from "@/lib/import/canonical";

const cells = (rows: Array<[number, string | null, string | null]>): RawCell[] =>
  rows.map(([i, h, v]) => ({ i, h, v }));

describe("G2 canonical hashing (C4/C5)", () => {
  it("rawHash is deterministic and order-independent by column index", () => {
    const a = cells([[0, "acc", "1000"], [1, "date", "2024-01-01"]]);
    const b = cells([[1, "date", "2024-01-01"], [0, "acc", "1000"]]); // shuffled
    expect(rawHash(a)).toBe(rawHash(b));
    expect(rawHash(a)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("preserves duplicate headers as distinct positional cells", () => {
    const dup = cells([[0, "amount", "10"], [1, "amount", "20"]]);
    const collapsed = cells([[0, "amount", "20"]]); // if header-keyed, 20 would overwrite 10
    expect(rawHash(dup)).not.toBe(rawHash(collapsed));
    // swapping the two duplicate columns' values changes identity
    const swapped = cells([[0, "amount", "20"], [1, "amount", "10"]]);
    expect(rawHash(dup)).not.toBe(rawHash(swapped));
  });

  it("NULL and empty string are distinct (typed framing)", () => {
    expect(rawHash(cells([[0, "a", null]]))).not.toBe(rawHash(cells([[0, "a", ""]])));
  });

  it("length-prefix framing is injection-proof (no delimiter collision)", () => {
    const oneCell = cells([[0, "a", "1,2"]]);
    const twoCells = cells([[0, "a", "1"], [1, "2", null]]);
    expect(rawHash(oneCell)).not.toBe(rawHash(twoCells));
  });

  it("datasetHash is deterministic and order/content sensitive", () => {
    const base = {
      sourceFileSha256: "aa".repeat(32), effectiveProfileHash: "bb".repeat(32),
      mappingHash: "cc".repeat(32), datasetKind: "GENERAL_LEDGER", normalizerVersion: "g2.1",
      orderedRawHashes: ["11".repeat(32), "22".repeat(32)],
    };
    expect(datasetHash(base)).toBe(datasetHash({ ...base }));
    expect(datasetHash(base)).not.toBe(
      datasetHash({ ...base, orderedRawHashes: ["22".repeat(32), "11".repeat(32)] }),
    );
    expect(datasetHash(base)).not.toBe(datasetHash({ ...base, mappingHash: "dd".repeat(32) }));
  });

  it("profileHash and mappingHash change with their inputs", () => {
    const p = { format: "CSV", encoding: "utf-8", delimiter: ",", sheet: null, headerRow: 1,
      locale: "ar-SA", dateInterpretation: "ISO", numberInterpretation: "decimal-point",
      parserVersion: "g2.1", normalizerVersion: "g2.1" };
    expect(profileHash(p)).toBe(profileHash({ ...p }));
    expect(profileHash(p)).not.toBe(profileHash({ ...p, delimiter: ";" }));

    const m = mappingHash("GENERAL_LEDGER", "g2.1", { "الحساب": "accountCode" });
    expect(m).toBe(mappingHash("GENERAL_LEDGER", "g2.1", { "الحساب": "accountCode" }));
    expect(m).not.toBe(mappingHash("GENERAL_LEDGER", "g2.1", { "الحساب": "reference" }));
  });

  it("sha256Bytes matches a known vector", () => {
    // sha256("abc")
    expect(sha256Bytes(Buffer.from("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
