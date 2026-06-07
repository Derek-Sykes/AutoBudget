# SetAside — Bank App (simulation-only MVP)

A budgeting web app built around one idea:

```
Main Account Balance − money set aside in pockets = Free to Spend
```

You "fake buy" things by setting money aside into virtual pockets/goals before
you actually spend it, so you always know what's *truly* free to spend. This MVP
is **simulation only** — there is no bank linking, no Plaid, no real money
movement. The Main Account balance comes from one hardcoded config constant.

## Stack

Next.js (App Router) · TypeScript · Prisma · SQLite · Zod · Tailwind CSS · Vitest

## Quick start

```bash
npm install
npm run db:push      # create the SQLite schema (prisma/dev.db)
npm run db:seed      # load the demo user + categories + pockets + funding plan
npm run dev          # http://localhost:3100
```

There is no auth in the MVP (deferred per the build guide). The whole app runs
as a single seeded demo user (`demo@example.com`).

## Configuration

The simulated starting balance lives in one obvious place,
[`src/config/mockBank.ts`](src/config/mockBank.ts):

```ts
export const MOCK_MAIN_ACCOUNT_STARTING_BALANCE_CENTS = 500_000; // $5,000.00
```

You can override it for local dev via an env var in `.env`:

```
MOCK_MAIN_ACCOUNT_STARTING_BALANCE_CENTS=500000
```

`DATABASE_URL` (in `.env`) points at the SQLite file (`file:./dev.db`).

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Start the dev server on port 3100 |
| `npm run build` | Production build + type check |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Run the Vitest suite |
| `npm run db:push` | Sync the Prisma schema to SQLite |
| `npm run db:seed` | Reset demo data to a pristine state |

## How the money model works

- **All money is integer cents.** No floating point is ever used for balances.
  Percentages use **basis points** (10000 = 100%).
- **Free to Spend is derived**, never stored: `mainBalance − setAside`.
  Set Aside = sum of active/paused/fully-funded pocket balances (+ category
  unallocated).
- **Ledger-first.** Every balance change goes through a `MoneyMovementBatch`
  with atomic `MoneyMovement` rows ([`src/server/services/ledger.ts`](src/server/services/ledger.ts)).
  A single guarded effect function applies and reverses balance changes, so
  no balance can ever go negative and every action is reversible.
- **Two kinds of deposits are kept distinct** (a non-negotiable rule):
  - *Paycheck / income* is new money — it can auto-disperse through the funding
    plan.
  - *Payback / refund* is returning money — it restores the prior movement (or
    a chosen destination) and never auto-disperses.

## Architecture

```
src/
  config/mockBank.ts        Hardcoded starting balance constant
  domain/                   Pure, unit-tested logic (no IO)
    money.ts                cents parsing/formatting, free-to-spend, fully-funded
    allocation.ts           paycheck allocation engine (largest-remainder, capping)
    types.ts                enum-like unions + movement → balance-effect map
  server/
    services/
      ledger.ts             applyBatch / reverseBatch (the only balance mutator)
      balanceService.ts     dashboard balances (derived Free to Spend)
      moneyMovement.ts      manual set-aside + reallocation
      paycheck.ts           paycheck deposit + preview + auto-disperse
      payback.ts            payback/refund restore
      purchaseCancel.ts     mark-as-bought + cancel/reallocate
      reversal.ts           safe undo of a clean batch
      funding.ts            build the active plan for the engine
      catalog.ts            category/pocket CRUD
      activity.ts           activity log + notifications
    queries.ts              read models for the pages
    currentUser.ts          seeded demo user (stands in for auth)
  app/
    actions.ts              server actions (validate → service → revalidate)
    dashboard/              balances + category cards
    categories/[id]/        pockets + set-aside / buy / cancel
    activity/               history, notifications, reversal
  components/               dialogs + presentational bits
tests/                      money + allocation (pure) and service integration tests
```

## What's implemented (MVP)

- Single simulated Main Account from a hardcoded constant
- Dashboard: Main Balance, Set Aside, derived Free to Spend, category cards
- Categories & pockets — create, **edit** (rename, goal, Target Buy Date, Lock
  Until), **pause/resume**, **archive**, and **edit/archive categories**
- Manual set-aside (Free to Spend → pocket)
- Fund a whole category from Free to Spend — auto-distributes across its pockets
  by the funding plan (capped at goals, remainder → Overflow), like a paycheck
- Paycheck/income deposit with **preview** and auto-disperse (capping + overflow)
- **Funding-plan editor**: adjust category & pocket percentages in-app with live
  validation (top level must total 100%; a category's pockets may total ≤100%,
  remainder → Overflow) — no re-seed, no data loss
- **Overflow pocket**: every category has an auto-managed catch-all pocket that
  captures whatever a category can't place in its other pockets (sub-100% pocket
  splits, capped/full pockets, or a category with no other pockets) instead of
  spilling to Free to Spend
- **Transfers**: move money from a pocket to another pocket, to Free to Spend, or
  to a whole category (which auto-distributes it just like a paycheck would)
- Payback/refund deposit: restore to Free to Spend, a chosen pocket, or exact
  restore of a linked purchase (with over-payback blocking)
- Manual adjustment deposit type — correct the simulated balance (requires a
  note, never auto-disperses, decrease capped at Free to Spend)
- **Recurring jobs / payroll engine**: multiple income sources (weekly, biweekly,
  monthly, semi-monthly), after-tax net pay in cents, active/paused/archived,
  per-job auto-disperse. A deterministic catch-up (run on every money-page load,
  no 24/7 process needed) posts one **idempotent** paycheck per missed pay date
  through the existing paycheck flow — key `payroll:<jobId>:<YYYY-MM-DD>` on the
  ledger's unique constraint guarantees no duplicates on refresh/twice/multi-tab.
  Jobs page (CRUD, next/last paycheck, "Check now") + dashboard income card
  (next paycheck across jobs + estimated monthly income)
- Notifications: unread count badge in the nav, mark-read, mark-all-read, clear
- Mark as bought (with leftover release / Free-to-Spend shortfall) and cancel
- Fully-funded detection + notifications
- Activity history + money-movement ledger
- Safe reversal of clean batches (blocks double reversal & negative balances)
- Idempotent deposits

## Deferred (future phases)

Auth, Plaid/bank linking, multiple real accounts, projections/wage calculator,
monthly-budget reset engine, priority/deadline funding modes, manual-adjustment
UI, and the full repair flow for un-cleanly-reversible batches.

## Testing

```bash
npm test
```

The suite (85 tests) covers the money rules end to end: cents math, the allocation engine
(rounding, capping, conservation), Free-to-Spend derivation, set-aside guards,
paycheck auto-disperse (on/off, idempotency, $0/negative blocks), payback
restore modes, purchase/cancel, and safe reversal (clean undo, double-reversal
block, already-spent block). Pure logic is tested directly; services run against
a dedicated `prisma/test.db`.
