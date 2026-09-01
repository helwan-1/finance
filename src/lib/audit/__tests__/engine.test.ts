/**
 * Lightweight, dependency-free tests for the audit engine.
 *
 * Runnable with any TS runner (e.g. `npx tsx src/lib/audit/__tests__/engine.test.ts`).
 * Uses a tiny assert helper so it works without a test framework installed.
 */

import { analyzeBenford, leadingDigit } from "../benford";
import { detectDuplicates } from "../duplicates";
import { detectOffHours, zonedParts } from "../offHours";
import { toMinorUnits, minorUnitsToString } from "../money";
import type { AnalyzableTransaction } from "../types";

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed += 1;
  } else {
    failed += 1;
    console.error(`  ✗ ${message}`);
  }
}

// ---- money ----
assert(toMinorUnits("1234.50") === 123450, "toMinorUnits parses two decimals");
assert(toMinorUnits("100") === 10000, "toMinorUnits handles integers");
assert(toMinorUnits("-0.05") === -5, "toMinorUnits handles negative & padding");
assert(minorUnitsToString(123450) === "1234.50", "minorUnitsToString formats");
try {
  toMinorUnits("12.345");
  assert(false, "toMinorUnits rejects >2 decimals");
} catch {
  assert(true, "toMinorUnits rejects >2 decimals");
}

// ---- benford ----
assert(leadingDigit(123450) === 1, "leadingDigit of 1234.50 is 1");
assert(leadingDigit(9900) === 9, "leadingDigit of 99.00 is 9");
assert(leadingDigit(0) === null, "leadingDigit of 0 is null");

// A perfectly Benford-conforming set should NOT reject.
const benfordAmounts: string[] = [];
// Build counts proportional to Benford expectation for n=900.
const expectedCounts = [301, 176, 125, 97, 79, 67, 58, 51, 46];
for (let d = 1; d <= 9; d += 1) {
  for (let i = 0; i < (expectedCounts[d - 1] ?? 0); i += 1) {
    benfordAmounts.push(`${d}00.00`);
  }
}
const benfordResult = analyzeBenford(benfordAmounts);
assert(!benfordResult.rejectsBenford, "conforming set does not reject Benford");

// A degenerate set (all leading 9) should reject strongly.
const skewed = Array.from({ length: 200 }, () => "900.00");
assert(
  analyzeBenford(skewed).rejectsBenford,
  "all-nines set rejects Benford",
);

// ---- duplicates ----
const dupTxns: AnalyzableTransaction[] = [
  {
    id: "a",
    reference: "INV-1",
    description: "x",
    amount: "500.00",
    counterparty: "ACME",
    postedAt: "2025-07-01T09:00:00Z",
  },
  {
    id: "b",
    reference: "INV-1",
    description: "x",
    amount: "500.00",
    counterparty: "ACME",
    postedAt: "2025-07-01T09:00:00Z",
  },
  {
    id: "c",
    reference: "INV-2",
    description: "x",
    amount: "500.00",
    counterparty: "ACME",
    postedAt: "2025-07-02T09:00:00Z",
  },
];
const dupFindings = detectDuplicates(dupTxns);
assert(
  dupFindings.some((f) => f.ruleCode === "DUPLICATE_EXACT"),
  "detects exact duplicate (a,b)",
);
assert(
  dupFindings.some((f) => f.ruleCode === "DUPLICATE_NEAR"),
  "detects near duplicate (different reference within window)",
);

// Outside the window: no near-duplicate.
const farTxns: AnalyzableTransaction[] = [
  {
    id: "a",
    reference: "R1",
    description: "x",
    amount: "500.00",
    counterparty: "ACME",
    postedAt: "2025-07-01T09:00:00Z",
  },
  {
    id: "b",
    reference: "R2",
    description: "x",
    amount: "500.00",
    counterparty: "ACME",
    postedAt: "2025-07-30T09:00:00Z",
  },
];
assert(
  detectDuplicates(farTxns, { nearWindowHours: 72 }).length === 0,
  "no near-duplicate outside time window",
);

// ---- off-hours ----
const offHoursTxns: AnalyzableTransaction[] = [
  {
    id: "night",
    reference: "N1",
    description: "x",
    amount: "100.00",
    counterparty: null,
    postedAt: "2025-09-02T00:00:00Z", // 03:00 Riyadh, Tuesday
  },
  {
    id: "friday",
    reference: "F1",
    description: "x",
    amount: "100.00",
    counterparty: null,
    postedAt: "2025-09-05T09:00:00Z", // Friday
  },
  {
    id: "normal",
    reference: "D1",
    description: "x",
    amount: "100.00",
    counterparty: null,
    postedAt: "2025-09-03T09:00:00Z", // 12:00 Riyadh, Wednesday
  },
];
const offFindings = detectOffHours(offHoursTxns);
assert(
  offFindings.some(
    (f) => f.ruleCode === "OFF_HOURS_ENTRY" && f.transactionIds[0] === "night",
  ),
  "flags 03:00 weekday entry as off-hours",
);
assert(
  offFindings.some(
    (f) => f.ruleCode === "WEEKEND_ENTRY" && f.transactionIds[0] === "friday",
  ),
  "flags Friday entry as weekend",
);
assert(
  !offFindings.some((f) => f.transactionIds[0] === "normal"),
  "does not flag a normal weekday business-hours entry",
);

const parts = zonedParts("2025-09-03T09:00:00Z", "Asia/Riyadh");
assert(parts.hour === 12 && parts.weekday === 3, "zonedParts resolves Riyadh time");

// ---- summary ----
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
