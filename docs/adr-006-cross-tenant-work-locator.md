# ADR-006 Cross-Tenant Background Work Discovery via Narrow SECURITY DEFINER Locator

- **Status:** ACCEPTED / FROZEN
- **Date:** 2026-09-05
- **Gate:** G6 Phase C3
- **Supersedes / relates:** ADR-005a (RLS propagation); G6-DEBT-002 (deferred), G6-DEBT-005 (closed), G6-DEBT-006 (closed)

## Context

Background preparation and execution of audit runs must be driven without losing
work if a process crashes between a DB commit and any external notification (the
lost-wakeup / dual-write problem), while preserving the G1 tenant-isolation model
(runtime role `audit_app` is non-owner, non-BYPASSRLS, RLS-subject).

Evidence (G6 Phase C3 discovery + C2):

- The **authoritative DB state is itself the durable work source**: a `PREPARING`
  run with a `PREPARING` `AuditRunPreparation` is claimable preparation work (via
  the C2 `claimAndMaterializeBatch` primitive); a `QUEUED` run — or a `RUNNING`
  run whose latest attempt lease has expired — is claimable execution work (via
  the existing `AuditJob` lease/fence/`claimInTx`).
- Because the work is reconstructable from state, **no transactional outbox and no
  external queue are required for correctness**.
- The only missing capability is **cross-tenant discovery**: as `audit_app`, RLS
  forbids scanning runnable work across firms (it cannot even enumerate
  `audit_firms`).

## Decision

Introduce a single, narrow, read-only, cross-tenant **SECURITY DEFINER locator
function** that returns only opaque runnable-work coordinates. It is a *discovery
mechanism only* — never authorization, never the source of audit truth, never a
queue source of truth, never a mutation authority. All actual work re-enters
normal tenant-scoped RLS execution and re-derives authoritative state before any
mutation.

### Durable work state (frozen)

- **PREPARATION:** `audit_runs.status = 'PREPARING'` AND the current
  `audit_run_preparations.status = 'PREPARING'`. This intentionally covers **both**
  (A) unfinished preparation chunks and (B) zero-undone-but-unsealed preparation
  (the crash-after-final-chunk state). A preparation with `status = 'COMPLETE'` is
  **not** background work — it awaits explicit human Publish.
- **EXECUTION:** `audit_runs.status = 'QUEUED'` **OR** (`status = 'RUNNING'` AND the
  latest `AuditJob` attempt has `status = 'RUNNING'` AND `leaseExpiresAt <` locator
  DB transaction time).

### AuditJob state invariant (frozen)

`RUNNING` run + latest `AuditJob` `FAILED` is **not** a legitimate recoverable
state and the locator must not invent recovery for it. `failRunInTx` transitions
job→FAILED and run→FAILED atomically in one transaction; the claim path marks an
expired predecessor FAILED but always supersedes it with a newer RUNNING attempt
in the same flow. Inconsistent states are not repaired by the locator.

### Latest attempt (frozen)

Latest attempt = highest `attemptNo` for a `runId`, resolved via the existing
`unique(runId, attemptNo)` index. No new `AuditJob` status; no pre-created
`QUEUED` `AuditJob`; `AuditJob` remains an execution-attempt record created by the
existing claim path.

### Locator output contract (frozen)

Exactly three fields: `auditFirmId`, `runId`, `workType` (closed domain:
`PREPARATION`, `EXECUTION`). **Forbidden** in the output: `clientId`,
`engagementId`, `preparationId`, `datasetId`, `testVersionId`, `jobId`,
`leaseOwner`, any client/engagement/dataset names, accounting data, balances,
findings, exceptions, results, failure details, source metadata.

### Non-authoritative contract (frozen)

Locator results are **non-authoritative routing hints**. `auditFirmId`, `runId`,
and `workType` are **not** authorization. The worker must: (1) establish a
*candidate* tenant context from `auditFirmId`; (2) re-read the run under normal
RLS; (3) verify the run belongs to that tenant; (4) re-derive current
authoritative state; (5) invoke the existing tenant-scoped claim/state machine;
(6) no-op / reject if stale, mismatched, terminal, or unauthorized.

### Delivery semantics (frozen)

**At-least-once discovery/delivery + idempotent and fenced database effects.**
Not global exactly-once execution; not exactly-once messaging. Local deterministic
uniqueness/fingerprint protections (e.g. occurrence-fingerprint dedup, unique
scope members) are local DB-effect guarantees only.

### Time contract (frozen)

The locator compares lease expiry with `transaction_timestamp()` and is declared
`STABLE`. Authoritative execution takeover remains existing engine behavior using
`clock_timestamp()` in `claimInTx`/`fenceOrThrow`. The locator never performs
takeover; any skew only yields a safe no-op.

### Human Publish boundary (frozen)

A preparation driver may materialize, observe `COMPLETE`, and seal — but must
**never** call `publishRun`. After a preparation becomes `COMPLETE`, background
processing stops; only the existing authenticated auditor boundary may Publish.
Publish remains a human authorization.

## Security Boundary

- **Function owner:** `audit_owner` (schema owner; the DEFINER's RLS-exempt read is
  the controlled bypass — same pattern as G1 `app_authenticate`).
- **Dedicated dispatcher principal:** `audit_dispatch` — no BYPASSRLS, no table
  SELECT/INSERT/UPDATE/DELETE, no schema CREATE, no role management. Allowed
  minimum: database CONNECT, schema USAGE, and `EXECUTE` on the locator only.
- **Runtime tenant worker:** `audit_app` — unchanged, RLS-subject; does the actual
  work. **No** `EXECUTE` on the locator.
- **PUBLIC:** no `EXECUTE` on the locator.

### SECURITY DEFINER hardening (frozen)

`SECURITY DEFINER`; `SET search_path = pg_catalog, public`; schema-qualify all
referenced relations; `REVOKE ALL ON FUNCTION … FROM PUBLIC`; `GRANT EXECUTE …
TO audit_dispatch`; no caller-supplied `auditFirmId`; no arbitrary
SQL/filter/order input; no mutation; no side effects.

### Fairness / limit (frozen)

Hard server-side limit: **≤ 200 rows per invocation** (no unbounded query).
Ordering: `updatedAt ASC` plus a bounded per-firm cap within an invocation to
prevent a single noisy tenant from monopolizing the result window. Strict
persisted round-robin fairness is **not** part of G6 C3 and remains deferred; no
persisted fairness state is introduced.

## Invariants

1. Locator is read-only, side-effect-free, `STABLE`.
2. Output is exactly `{auditFirmId, runId, workType}`; no audit/client payload.
3. Output is a non-authoritative hint; the worker re-derives under RLS.
4. `audit_app` and `PUBLIC` cannot execute the locator; only `audit_dispatch`.
5. No BYPASSRLS; no table grants to the dispatcher; existing RLS policies unchanged.
6. Publish stays an explicit human action; background never publishes.
7. Existing C2 claim and `AuditJob` lease/fence semantics are unchanged.

## Lost-wakeup contract

- **LW-1** beginPreparation commits then dies → PREPARING rediscovered.
- **LW-2** final chunk commits then dies before seal → prep still PREPARING →
  rediscovered → sealed.
- **LW-3** seal COMPLETE, no publish → intentional human wait, **not** a lost wakeup.
- **LW-4** publish commits QUEUED then dies → QUEUED rediscovered.
- **LW-5** execution worker dies → lease expires → stale RUNNING rediscovered.
- **LW-6/LW-7** locator/dispatcher dies → DB state unchanged → next pass rediscovers.
- **LW-8** duplicate discovery → existing claim/idempotency/fencing handles it.
- **LW-9** state becomes terminal before invocation → worker re-derives → no-op.
- **LW-10** tampered `firmId`/`runId` → RLS re-derivation → no unauthorized mutation.

## Performance evidence (disposable fixture; not a production SLA)

Disposable PostgreSQL fixture: 100,000 `audit_runs` across 100 firms; 1,000
`audit_run_preparations`; 800 `audit_run_prep_chunks`; 900 `audit_jobs`; runnable
mix of PREPARING, QUEUED, RUNNING (live + expired lease) and historical attempts.

- Candidate locator query with **current indexes**: ~3.5 ms at 100k, no heap seq
  scan — but the QUEUED/RUNNING path used an **O(total-runs)** composite-index scan.
- With `ix_runs_runnable`: ~3.0 ms; runnable discovery became index-supported over
  the small runnable population (cost ~1158 → ~17).
- Correctness: PREPARATION = 800; EXECUTION = 850 (600 QUEUED + 250 stale-RUNNING);
  sealed-prep (200) and live-lease RUNNING (250) correctly excluded.

## Schema / index contract (frozen)

- **NEW TABLE:** NOT REQUIRED
- **NEW COLUMN:** NOT REQUIRED
- **NEW INDEX:** REQUIRED — exactly one:
  ```sql
  CREATE INDEX ix_runs_runnable
    ON public.audit_runs (status, "updatedAt")
    WHERE status IN ('PREPARING','QUEUED','RUNNING');
  ```
  (`ix_preps_preparing` is explicitly **NOT** required by this ADR; reconsider only
  with future evidence.)
- **RLS POLICY CHANGE:** NOT REQUIRED
- **SECURITY DEFINER FUNCTION:** REQUIRED
- **DISPATCHER ROLE:** REQUIRED (`audit_dispatch`)
- **AUDITJOB STATUS CHANGE:** NOT REQUIRED
- **OUTBOX:** NOT REQUIRED
- **EXTERNAL QUEUE:** NOT REQUIRED

## Alternatives Considered / Rejected (this gate)

- `audit_dispatch` with BYPASSRLS — total blast radius. Rejected.
- Direct table grants to the dispatcher — cross-tenant table read. Rejected.
- Privileged global view — coarser ACL, harder to bound, column-exposure risk. Rejected.
- Queue as source of truth — dual-write lost-wakeup. Rejected.
- External-queue-only — dual-write lost-wakeup. Rejected.
- Transactional outbox as a *required correctness* mechanism — redundant with
  authoritative state. Rejected (may be added later purely as a latency hint).
- Pre-created QUEUED `AuditJob` — needs a new status and changes claim semantics. Rejected.
- New work table — unnecessary; state is the work. Rejected.
- Auto-publish from background — violates the human authorization boundary. Rejected.
- Global exactly-once execution claim — not achievable/needed. Rejected.

**Fallback if the locator boundary is later withdrawn:** an external/config firm
registry plus per-tenant polling under normal RLS (no DB-boundary change), at the
cost of registry management and higher latency.

## Consequences

**Positive:** durable lost-wakeup recovery without a queue dual-write; no new
work-state table; existing C2 / `AuditJob` claim semantics preserved; tenant
worker remains RLS-subject; no vendor queue dependency.

**Tradeoffs:** a dedicated infrastructure principal is required; a deliberate
cross-tenant *metadata* discovery boundary is opened (the dispatcher learns opaque
firm/run work coordinates); one SECURITY DEFINER function must be tightly audited;
reconciliation latency depends on dispatcher cadence; the partial index adds small
write/maintenance cost.

## Rollback Strategy

Revoke/drop the locator function; drop `audit_dispatch` when unused; drop
`ix_runs_runnable` if desired. No audit-domain data migration to reverse; no
immutable audit facts changed. Fall back to per-tenant polling if required.

## Verification Requirements (before C3 locator implementation may PASS)

Real-PostgreSQL adversarial tests, minimum:

- V1 `audit_app` cannot execute the locator
- V2 PUBLIC cannot execute the locator
- V3 `audit_dispatch` can execute
- V4 `audit_dispatch` cannot `SELECT audit_runs`
- V5 `audit_dispatch` cannot mutate audit tables
- V6 output = exactly the three allowed fields
- V7 PREPARING unfinished discovered
- V8 PREPARING zero-undone/unsealed discovered
- V9 COMPLETE-awaiting-Publish excluded
- V10 QUEUED discovered
- V11 active RUNNING lease excluded / no premature takeover
- V12 expired RUNNING lease discovered
- V13 terminal runs excluded
- V14 tenant ownership re-derived by the worker
- V15 tampered locator coordinate → no unauthorized mutation
- V16 duplicate discovery safe
- V17 no client/accounting payload
- V18 search_path / object-shadowing attack fails
- V19 hard limit ≤ 200 enforced
- V20 per-firm bounded fairness proven
- V21 locator query/index plan acceptable at realistic cardinality
- V22 DB-time lease predicate proven
- V23 function has no write side effects
- V24 existing RLS policies unchanged

## Status of implementation

NOT IMPLEMENTED. This ADR is documentation only. The locator function, the
`audit_dispatch` role, `ix_runs_runnable`, the dispatcher/reconciler, and the
preparation/execution drivers are NOT authorized by this document and require a
separate implementation gate (proposed slices C3-1 … C3-6) with the V1–V24
verification above.
