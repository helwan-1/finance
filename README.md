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
    page.tsx           # Dashboard page
    globals.css
    api/anomalies/route.ts   # Filtered, tenant-scoped anomalies API
  components/
    layout/            # Sidebar, Header, EngagementSwitcher, DashboardShell
    anomalies/         # AnomaliesFeed, FilterBar, AnomalyCard, StatCards
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

`runAuditEngine()` composes them and returns findings ranked by score/severity.

## Multi-tenancy & audit trail

- Every tenant-owned row carries `auditFirmId`; engagement-scoped rows also
  carry `engagementId`. **Every query filters by both** — see
  `src/app/api/anomalies/route.ts`.
- `recordAuditLog()` appends immutable entries for user actions (viewing files,
  resolving anomalies, exporting data).

## Getting started

```bash
npm install
cp .env.example .env          # set DATABASE_URL to your PostgreSQL instance
npm run prisma:generate
npm run prisma:migrate        # create the schema
npm run prisma:seed           # load mock data + generated anomalies
npm run dev                   # http://localhost:3000
```

The dashboard renders even **without** a database: the anomalies API falls back
to an in-memory demo dataset (`src/lib/demo-data.ts`).

### Run the engine tests

```bash
npx tsx src/lib/audit/__tests__/engine.test.ts
```

## Notes on AI / document processing

`Document.parsedData` (JSON) is the integration point for OCR/parsing output
(PaddleOCR / AWS Textract / Claude). Hooks are wired via `OCR_SERVICE_URL` and
`ANTHROPIC_API_KEY` in `.env`.
