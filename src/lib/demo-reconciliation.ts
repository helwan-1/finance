import type { ReconSessionDTO } from "./ui-types";

/**
 * In-memory demo reconciliation session, mirroring what the seed produces by
 * running the reconciliation engine (exact + partial + unmatched). Used as the
 * API fallback when no database is provisioned.
 */
export const DEMO_RECON_SESSIONS: ReconSessionDTO[] = [
  {
    id: "recon-nakheel-2025",
    name: "Bank vs Ledger — FY2025",
    status: "COMPLETED",
    sourceA: "BANK",
    sourceB: "LEDGER",
    matchedCount: 6,
    partialCount: 1,
    unmatchedCount: 1,
    totalCount: 8,
    matches: [
      {
        id: "m1",
        sourceRef: "BANK-1000",
        sourceAmount: "125430.00",
        targetRef: "JV-1000",
        status: "MATCHED",
        confidence: "0.9500",
        amountDelta: "0.00",
      },
      {
        id: "m2",
        sourceRef: "BANK-1001",
        sourceAmount: "8720.50",
        targetRef: "JV-1001",
        status: "MATCHED",
        confidence: "0.9500",
        amountDelta: "0.00",
      },
      {
        id: "m3",
        sourceRef: "BANK-1003",
        sourceAmount: "45200.50",
        targetRef: "JV-1003",
        status: "PARTIAL",
        confidence: "0.8400",
        amountDelta: "0.50",
      },
      {
        id: "m4",
        sourceRef: "BANK-1004",
        sourceAmount: "3150.00",
        targetRef: "JV-1004",
        status: "MATCHED",
        confidence: "0.9000",
        amountDelta: "0.00",
      },
      {
        id: "m5",
        sourceRef: "BANK-1005",
        sourceAmount: "67890.00",
        targetRef: "JV-1005",
        status: "MATCHED",
        confidence: "0.9500",
        amountDelta: "0.00",
      },
      {
        id: "m6",
        sourceRef: "BANK-1006",
        sourceAmount: "12000.00",
        targetRef: "JV-1006",
        status: "MATCHED",
        confidence: "0.9200",
        amountDelta: "0.00",
      },
      {
        id: "m7",
        sourceRef: "BANK-1002",
        sourceAmount: "23410.00",
        targetRef: "JV-1002",
        status: "MATCHED",
        confidence: "0.9500",
        amountDelta: "0.00",
      },
      {
        id: "m8",
        sourceRef: "JV-1007",
        sourceAmount: "9900.00",
        targetRef: null,
        status: "UNMATCHED",
        confidence: "0.0000",
        amountDelta: null,
      },
    ],
  },
];
