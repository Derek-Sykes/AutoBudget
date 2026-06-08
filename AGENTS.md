# AGENTS.md - AutoBudget

You are working on **AutoBudget**, a simulation-only, fintech-style budgeting app.

## Product priority (do not break this)

The core product is:

```
Main Account Balance − money set aside in pockets = Free to Spend
```

Free to Spend is **derived**, never stored as an independently mutable balance.

## Non-negotiable constraints

- MVP has exactly **one simulated Main Account per user**. Its starting balance
  comes from `MOCK_MAIN_ACCOUNT_STARTING_BALANCE_CENTS` in
  `src/config/mockBank.ts`. No bank linking, Plaid, multiple real accounts, or
  real money movement.
- **Money is integer cents.** Never use floating point for balances.
  Percentages use **basis points** (10000 = 100%).
- **Ledger-first.** Never mutate `Account.balanceCents` or `Pocket.currentBalanceCents`
  directly. Every balance change must go through `applyBatch` / `reverseBatch` in
  `src/server/services/ledger.ts`, creating a `MoneyMovementBatch` + `MoneyMovement`
  rows inside a Prisma transaction.
- **No negative balances** — the guarded effect function enforces this; keep it that way.
- **Two deposit types stay distinct:** paycheck/income may auto-disperse; payback/
  refund restores prior movements and must never auto-disperse by default.
- Every balance-changing action writes an `ActivityLog` entry; reversals create a
  new opposite batch and never edit/delete old ledger rows.

## Where logic lives

- Pure, IO-free domain logic: `src/domain/` (unit-tested).
- Balance-changing operations: `src/server/services/` (the only place that mutates
  balances; all go through the ledger). Do not put balance logic in UI components.
- Server actions in `src/app/actions.ts` validate input, call a service, then
  `revalidatePath`.

## Before coding

1. Read `REQUIREMENTS.md` (the master spec) and this file.
2. Inspect existing files; identify what already exists.
3. Implement the smallest safe vertical slice.
4. Add/update tests for any balance, allocation, or state-transition logic.

## Validation commands

```bash
npm run typecheck
npm test
npm run build
```

A task is done only when behavior matches the spec, money logic is tested, the
app still builds, no negative-balance path is introduced, and docs are updated if
behavior changed.
