# SetAside / AutoBudget

SetAside is a simulation-only budgeting MVP from the `Derek-Sykes/AutoBudget` GitHub repo. It helps each logged-in user set money aside into virtual categories and pockets before spending, so the app can show what is truly free to spend.

Core rule:

```txt
Free to Spend = Main Account Balance - Set Aside
```

The app has local email/password accounts for development use. There is no OAuth, Plaid, bank linking, transaction sync, or real money movement in the MVP.

## Stack

- Next.js 15 App Router and React 19
- TypeScript
- Prisma 6 with SQLite
- Zod
- Tailwind CSS 3
- Vitest

## Quick Start

```powershell
npm ci
Copy-Item .env.example .env
npm run db:reset
npm run dev
```

The dev server runs on http://localhost:3100.

Seeded local demo login:

```txt
email: demo@autobudget.local
password: password123
```

These demo credentials are for local development only. Do not treat them as production-safe.

## Environment

Create `.env` from `.env.example` before running Prisma or the app:

```dotenv
DATABASE_URL="file:./dev.db"
MOCK_MAIN_ACCOUNT_STARTING_BALANCE_CENTS=500000
```

`DATABASE_URL="file:./dev.db"` creates `prisma/dev.db`. SQLite database files and `.env` are ignored by Git.

`MOCK_MAIN_ACCOUNT_STARTING_BALANCE_CENTS` is optional. If it is absent, the app uses `MOCK_MAIN_ACCOUNT_STARTING_BALANCE_CENTS = 500_000` from `src/config/mockBank.ts`.

## App Routes

- `/dashboard` - balance summary, category cards, recent income, and add-money actions
- `/categories/[id]` - category detail, pocket actions, set-aside, transfers, purchase/cancel, edit/archive flows
- `/jobs` - recurring income sources and payroll catch-up controls
- `/funding-plan` - paycheck allocation plan editor
- `/activity` - notifications, activity history, and safe reversal controls
- `/account` - display name, password change, and logout
- `/login` and `/signup` - local account access

`/` is public. Protected app routes redirect unauthenticated users to `/login`.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Start Next.js on port 3100 |
| `npm run build` | Build the production app |
| `npm run start` | Start the built app |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | Run TypeScript with `--noEmit` |
| `npm test` | Run Vitest once |
| `npm run test:watch` | Run Vitest in watch mode |
| `npm run db:push` | Run Prisma `db push` against the configured database |
| `npm run db:generate` | Generate Prisma Client |
| `npm run db:seed` | Seed demo data |
| `npm run db:reset` | Force-reset SQLite schema and seed demo data |

## Current MVP

The GitHub checkout currently includes:

- one simulated Main Account per user
- local email/password accounts with hashed passwords and expiring HTTP-only session cookies
- seeded development demo account
- mock starting balance configuration
- dashboard balances with derived Free to Spend
- categories, pockets, overflow pockets, and category unallocated amounts
- manual set-aside into a pocket or whole category
- paycheck deposits with preview and auto-disperse through the funding plan
- funding-plan editor with category and pocket percentages in basis points
- transfers from pocket to pocket, Free to Spend, or whole category
- payback/refund restoration
- purchase and cancel pocket flows
- manual adjustment deposit type
- recurring jobs and payroll catch-up with idempotent paycheck generation
- notifications, activity history, and safe reversal of clean batches
- Prisma schema, seed script, service layer, server actions, app routes, and tests

## Money Rules

- Store money as integer cents.
- Use basis points for percentages.
- Derive Free to Spend instead of storing it.
- Route every balance-changing action through the ledger in `src/server/services/ledger.ts`.
- Create `MoneyMovementBatch` and `MoneyMovement` rows for balance changes.
- Write `ActivityLog` entries for user-readable history.
- Prevent negative Main Account, pocket, and Free to Spend states.
- Keep paycheck/income deposits distinct from payback/refund deposits.
- Reverse by creating opposite movement batches; do not delete or rewrite old ledger rows.

## Project Docs

- `REQUIREMENTS.md` - source of truth for MVP behavior
- `docs/SETUP.md` - fresh-checkout setup, env, database, and troubleshooting
- `docs/TESTING.md` - verification commands and test coverage notes
- `AGENTS.md` - coding-agent rules for the repo

## Verification

Recommended local check:

```powershell
npm run db:reset
npm run typecheck
npm test
npm run build
```

The current test suite covers pure money/allocation logic, service-level money flows, local auth behavior, and user-isolation checks against a dedicated SQLite test database.

Note: `npm run db:reset` is destructive. It uses `scripts/reset-db.mjs` to delete and recreate the configured SQLite database because direct `prisma db push` currently fails in this Windows workspace with a schema-engine error after schema validation succeeds.

## Deferred Scope

Deferred work includes OAuth/social login, email verification, password reset, Plaid/bank linking, multiple real accounts, real money movement, transaction sync, projections, a full wage calculator, monthly-budget reset automation, priority/deadline funding modes, manual-adjustment UI polish, and repair flows for non-clean reversals.
