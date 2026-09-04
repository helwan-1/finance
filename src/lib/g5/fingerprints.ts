import { fingerprint, fields, multiset, str } from "@/lib/g4/framing";
import { decimalToMicros, microsToDecimalString } from "@/lib/accounting/decimal";

/**
 * G5 professional-disposition semantic identities. Built with the same
 * injection-safe framed-fingerprint primitives as G4 (no raw concatenation),
 * so equal content always produces an equal hash and distinct content never
 * collides. Money is normalized through the canonical integer-micros path so
 * "50" / "50.00" / "50.000000" hash identically; NULL is a distinct framed tag.
 */

/** Canonical decimal string for hashing (Decimal(24,6)-normalized), or null. */
function canonAmount(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  return microsToDecimalString(decimalToMicros(v));
}

/**
 * Advisory matter-correlation hint (g5mattercorr.1). Derived ONCE at creation
 * from the engagement + the FIRST linked result's cross-run semantic
 * fingerprint. Never identity, never unique, never changed by later links.
 * Excludes runId/resultId/occurrence-fingerprint/membership/timestamps/actor.
 */
export function matterCorrelationKey(a: { engagementId: string; resultSemanticFingerprint: string }): string {
  return fingerprint("g5mattercorr.1", fields([
    ["engagementId", str(a.engagementId)],
    ["semantic", str(a.resultSemanticFingerprint)],
  ]));
}

/**
 * Derived membership snapshot (g5members.1) over the CURRENT active linked
 * results' semantic fingerprints — order-independent (multiset). Changes as
 * membership evolves; NEVER the matter's identity.
 */
export function membershipFingerprint(activeResultSemanticFingerprints: string[]): string {
  return fingerprint("g5members.1", multiset(activeResultSemanticFingerprints.map((s) => str(s))));
}

export interface FindingContent {
  category: string;
  condition: string;
  criteria: string;
  cause: string;
  effect: string;
  auditorConclusion: string;
  recommendation: string | null;
  observedAmount: string | null;
  observedCurrency: string | null;
  estimatedExposureAmount: string | null;
  estimatedExposureCurrency: string | null;
}

/**
 * Immutable FindingVersion content hash (g5finding.1). Includes every
 * authoritative professional content field; EXCLUDES physical id, timestamps,
 * versionNo, review outcome, currentVersionId and all mutable projection state.
 */
export function findingContentHash(c: FindingContent): string {
  return fingerprint("g5finding.1", fields([
    ["category", str(c.category)],
    ["condition", str(c.condition)],
    ["criteria", str(c.criteria)],
    ["cause", str(c.cause)],
    ["effect", str(c.effect)],
    ["auditorConclusion", str(c.auditorConclusion)],
    ["recommendation", str(c.recommendation)],
    ["observedAmount", str(canonAmount(c.observedAmount))],
    ["observedCurrency", str(c.observedCurrency)],
    ["estimatedExposureAmount", str(canonAmount(c.estimatedExposureAmount))],
    ["estimatedExposureCurrency", str(c.estimatedExposureCurrency)],
  ]));
}
