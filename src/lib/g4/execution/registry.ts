import type { TestPin } from "./context";
import { type TestExecutor, pinKind } from "./contracts";
import { populationMemberExecutor } from "./data-quality/population-member";
import { sourceToCanonicalExecutor } from "./data-quality/source-to-canonical";
import { unbalancedJournalEntryExecutor } from "./accounting/unbalanced-je";
import { invalidDebitCreditExecutor } from "./accounting/invalid-debit-credit";
import { tbAccountDuplicationExecutor } from "./accounting/tb-account-duplication";
import { roundNumberFrequencyExecutor } from "./statistical/round-number-frequency";
import { duplicateAmountFrequencyExecutor } from "./statistical/duplicate-amount-frequency";

/** Registry key = "<testType>:<kind>". */
function key(testType: string, kind: string): string {
  return `${testType}:${kind}`;
}

const EXECUTORS: TestExecutor[] = [
  populationMemberExecutor, // C1 (unchanged semantics)
  sourceToCanonicalExecutor,
  unbalancedJournalEntryExecutor,
  invalidDebitCreditExecutor,
  tbAccountDuplicationExecutor,
  roundNumberFrequencyExecutor, // C3
  duplicateAmountFrequencyExecutor, // C3
];

export const REGISTRY: ReadonlyMap<string, TestExecutor> = new Map(EXECUTORS.map((e) => [key(e.testType, e.kind), e]));

/** Resolve the executor for a frozen pin (by testType + frozen kind). null = unsupported. */
export function resolveExecutor(pin: TestPin): TestExecutor | null {
  const kind = pinKind(pin);
  if (!kind) return null;
  return REGISTRY.get(key(pin.testType, kind)) ?? null;
}
