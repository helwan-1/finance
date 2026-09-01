# مدقق مالي — Financial Audit Dashboard

لوحة تدقيق مالي مدعومة بالذكاء الاصطناعي للمدققين. تستوعب المستندات المالية
(فواتير، كشوف بنكية، إقرارات ضريبة القيمة المضافة، دفاتر الأستاذ)، وتحللها،
وتُجري مطابقة ذكية، وتكشف الحالات الشاذة إحصائياً، وتعرضها في لوحة تفاعلية.

An AI-powered financial audit dashboard for auditors. It ingests financial
documents, parses them, performs smart reconciliation, detects anomalies with
statistical algorithms, and surfaces an actionable, Arabic-first (RTL) feed.

> Status: **MVP scaffold** — the initial phase from the project brief (project
> setup, Prisma data layer + seed, dashboard shell + anomalies feed/filter bar,
> and the audit algorithms engine).

## Tech stack

| Layer            | Choice                                                    |
| ---------------- | --------------------------------------------------------- |
| Framework        | Next.js 14 (App Router) + TypeScript (strict)             |
| Styling          | Tailwind CSS, RTL-first (`dir="rtl"`), Tajawal Arabic font |
| Data fetching    | TanStack Query (React Query)                              |
| UI state         | Zustand                                                   |
| Icons            | `lucide-react`                                            |
| Database / ORM   | PostgreSQL + Prisma (`@db.Decimal(15, 2)` for all money)  |

## Project structure

```
prisma/
  schema.prisma        # Multi-tenant schema (firm + engagement isolation)
  seed.ts              # Mock audit data; runs the engine to plant anomalies
src/
  app/
    layout.tsx         # RTL + Arabic root layout
    page.tsx           # Dashboard page (anomalies feed)
    documents/page.tsx       # Document upload + OCR extraction
    reconciliation/page.tsx  # Reconciliation results page
    analytics/page.tsx       # Benford's Law analytics
    audit-log/page.tsx       # Immutable audit trail
    globals.css
    api/anomalies/route.ts       # Filtered, tenant-scoped anomalies API
    api/documents/route.ts       # List (GET) + upload/parse (POST) documents
    api/reconciliation/route.ts  # Tenant-scoped reconciliation sessions API
    api/analytics/route.ts       # Benford analysis over engagement txns
    api/audit-log/route.ts       # Immutable audit-trail feed
  components/
    layout/            # Sidebar (navigable), Header, EngagementSwitcher, Shell
    anomalies/         # AnomaliesFeed, FilterBar, AnomalyCard, StatCards
    documents/         # DocumentsView, UploadButton
    reconciliation/    # ReconciliationView, SessionCard, MatchesTable
    analytics/         # AnalyticsView, BenfordChart (dependency-free SVG)
    audit-log/         # AuditLogView
  lib/ocr/             # Document parser interface + stub (Textract/Claude seam)
  lib/
    prisma.ts          # Prisma client singleton
    audit/             # Audit algorithms engine (see below)
    audit-log.ts       # Immutable audit-trail helper
    format.ts          # ar-SA currency/date formatting
    demo-data.ts       # In-memory fallback so the UI runs without a DB
  providers/query-provider.tsx
  store/ui-store.ts    # Zustand store (engagement scope + filters)
```

## Audit algorithms engine (`src/lib/audit`)

Pure, dependency-free, unit-testable analyzers. Monetary values are converted
to **integer minor units** — never handled as JS floats.

1. **Benford's Law** (`benford.ts`) — first-digit distribution with a
   Chi-Square goodness-of-fit test (8 df, 95% critical value 15.507).
2. **Duplicate detection** (`duplicates.ts`) — exact (amount + party +
   reference) and near-match (same amount + party within a time window,
   different reference).
3. **Off-hours & weekend** (`offHours.ts`) — timezone-aware (default
   `Asia/Riyadh`, weekend Fri–Sat, business hours 07:00–19:00).
4. **VAT discrepancy** (`vat.ts`) — ZATCA standard 15% check: compares the
   declared VAT against `round(base × rate)` in minor units (half-up), flagging
   deviations beyond a configurable tolerance.

`runAuditEngine()` composes them and returns findings ranked by score/severity.

## Reconciliation engine (`src/lib/reconciliation`)

`reconcile(sourceTxns, targetTxns, options)` matches two sources (e.g. Bank vs
Ledger) by amount, value-date proximity, and reference/counterparty similarity.
Matching is **greedy on descending confidence** (each entry used once), yielding
`MATCHED` / `PARTIAL` (within an amount tolerance) / `UNMATCHED` results with a
0–1 confidence and the amount delta. `reconciliationAnomalies()` turns residual
unmatched entries into `UNRECONCILED` anomaly flags for the feed.

## Document processing (OCR) — `src/lib/ocr`

The app depends only on a `DocumentParser` interface, so PaddleOCR / AWS
Textract / the Claude API can be plugged in via `getParser()` without touching
routes or UI. A deterministic `StubDocumentParser` runs until a real provider is
configured (`OCR_SERVICE_URL` / `ANTHROPIC_API_KEY`), so the upload → parse →
extract-transactions flow works end to end. `POST /api/documents` registers an
uploaded file, runs the parser, and (with a DB) persists the document plus the
extracted transactions in a single Prisma transaction.

## Authentication & RBAC (`src/lib/auth`)

- **Sessions:** signed JWT (HS256 via `jose`) in an httpOnly cookie; passwords
  hashed with bcrypt. `POST /api/auth/login`, `POST /api/auth/logout`,
  `GET /api/auth/me`. Sign with `AUTH_SECRET`.
- **RBAC:** a permission matrix per `UserRole` (`rbac.ts`); `authorize()`
  (`guard.ts`) enforces, in order, authentication → role permission → **tenant
  isolation** (an authenticated user may only touch engagements in their own
  firm). Applied to every data route.
- **Demo vs. enforced:** with `AUTH_REQUIRED=false` (default) the public demo
  renders with in-memory data and no login. Set `AUTH_REQUIRED=true` to require
  a session on all API routes (verified end-to-end: unauth → 401, valid login →
  200, cross-tenant → 403).
- Seed users (password `Audit@1234`): `partner@almeezan.sa` (PARTNER),
  `senior@almeezan.sa` (SENIOR).

## Live updates (SSE)

- `GET /api/stream?engagementId=...` is a Server-Sent Events channel. Resolving
  an anomaly or uploading a document publishes an event on an in-process bus
  (`src/lib/events.ts`); every connected dashboard receives it and refetches, so
  changes made by one user appear in other tabs/users in real time.
- The header shows a **مباشر / live** indicator; `useLiveUpdates()` manages the
  `EventSource` and query invalidation. The in-process bus is the seam for Redis
  pub/sub in a multi-instance deployment.

## Report export

- **Excel:** `GET /api/anomalies/export` streams a real `.xlsx` (via `exceljs`,
  RTL sheet) of the filtered anomalies feed; requires the `data:export`
  permission and records an immutable `EXPORT_DATA` audit-log entry.
- **PDF:** a print-optimized report (`window.print()` + `@media print` rules)
  that hides the app chrome and renders the anomalies as a clean, RTL document.

## Multi-tenancy & audit trail

- Every tenant-owned row carries `auditFirmId`; engagement-scoped rows also
  carry `engagementId`. **Every query filters by both** — see
  `src/app/api/anomalies/route.ts` and `authorize()` in `src/lib/auth/guard.ts`.
- `recordAuditLog()` appends immutable entries for user actions (login, viewing
  files, resolving anomalies, exporting data).

## Getting started

```bash
npm install
docker compose up -d          # local PostgreSQL 16 on host port 5433 (avoids 5432 clashes)
cp .env.example .env          # DATABASE_URL already matches docker-compose (localhost:5433)
npm run prisma:generate
npm run prisma:migrate        # applies prisma/migrations (initial: _init)
npm run prisma:seed           # load mock data + generated anomalies
npm run dev                   # http://localhost:3000
```

The committed initial migration (`prisma/migrations/*_init`) has been applied and
seeded against a real PostgreSQL 16 instance: 134 transactions, 7 reconciliation
matches, and 7 anomaly flags across the seeded engagement.

The dashboard renders even **without** a database: the anomalies API falls back
to an in-memory demo dataset (`src/lib/demo-data.ts`).

### Tests

```bash
npm test          # Vitest: engine + auth + API route integration tests
npm run test:watch
```

Coverage: the algorithms engine (Benford / duplicates / off-hours / VAT /
reconciliation), the auth layer (bcrypt, RBAC matrix, JWT session round-trip and
tamper rejection), and the API routes' demo paths (filters + the .xlsx export).

## Notes on AI / document processing

`Document.parsedData` (JSON) is the integration point for OCR/parsing output
(PaddleOCR / AWS Textract / Claude). Hooks are wired via `OCR_SERVICE_URL` and
`ANTHROPIC_API_KEY` in `.env`.
