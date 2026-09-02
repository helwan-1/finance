# SARAT — Security Debt Register

Durable record of accepted security debt and deployment invariants. Each entry
is evidence-based and names the gate/condition under which it must be resolved.

## SEC-DEBT-009 — Login rate limiter is process-local

- **Severity:** MEDIUM (availability of the brute-force control), CONFIRMED.
- **Component:** `src/lib/security/rate-limit.ts` (used by `POST /api/auth/login`).
- **Guarantee:**
  - **Single process / single limiter-state domain: PASS** — counters are
    authoritative; thresholds (10/account, 30/IP per 15 min) enforced.
  - **Multiple processes / horizontally scaled instances: NOT SUFFICIENT** —
    each instance holds independent in-memory counters, so the effective limit
    scales with the instance count and an attacker can spread attempts across
    instances.
- **Deployment invariant (accepted control):**
  > The current G1 login limiter is an accepted control **only while
  > authentication traffic is handled by a single limiter-state domain.**
- **Future requirement (conceptual — no provider selected now):**
  > Before multi-instance production deployment, replace or process-share login
  > abuse state through a distributed/shared rate-limit mechanism or an
  > equivalent upstream enforcement layer (gateway/WAF).
- **Status:** ACCEPTED for single-instance G1. Do **not** horizontally scale
  authentication traffic while silently assuming this limiter is globally
  enforced.

## Deferred items carried from the G1 report (tracked here for durability)

- **SEC-DEBT-004** — Stateless 8h JWT: a user deactivated mid-session keeps a
  valid token until expiry. Login checks `isActive`; mid-session revocation
  (shorter TTL or a revocation check) deferred to a session-hardening step.
- **RLS parent-EXISTS tables** — `engagement_members`, `reconciliation_matches`
  are protected via parent-EXISTS policies; a denormalized `auditFirmId` column
  (v1.2 invariant #8) is deferred to the accounting/scale gate.
- **Durable, tenant-aware security-event store** — pre-auth events currently go
  to structured stderr (`securityLog`); a durable store is deferred to the
  Reporting / Audit File gate (G14).
- **CSP `'unsafe-inline'`** — required by Next.js app-router without nonces;
  nonce-based CSP hardening deferred.
