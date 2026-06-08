# AutoBudget Requirements

This file is the source of truth for the simulation-only MVP.

## Product Rule

```txt
Free to Spend = Main Account Balance - Set Aside
```

Free to Spend is derived from stored balances. It must not be independently stored or mutated.

## MVP Boundaries

- The MVP has one simulated Main Account per user.
- The app uses local email/password accounts and keeps a seeded demo account for development.
- The starting balance comes from `MOCK_MAIN_ACCOUNT_STARTING_BALANCE_CENTS` in `src/config/mockBank.ts`, with an optional local environment override.
- The app does not link to banks, Plaid, external transactions, or real money movement.
- Multiple real source accounts are deferred.

## Auth Rules

- Store password hashes only; never store plaintext passwords.
- Use expiring server-side sessions.
- Session cookies must be HTTP-only.
- Do not store session tokens or secrets in localStorage.
- Signup must create safe default user data: Main Account, starter categories, Overflow pockets, and a default funding plan.
- All protected pages and server actions must resolve the user from the current session.
- Every query and mutation must be scoped to the authenticated user.
- Do not trust form or route ids without verifying ownership by user id.
- Non-demo users may hard-delete their own account after entering their current password and typing `DELETE`.
- The seeded demo account must not be deletable.

## Money Rules

- Store all money as integer cents.
- Use basis points for percentages.
- Do not use floating point for stored balances or allocation results.
- Prevent negative Main Account balances.
- Prevent negative pocket balances.
- Prevent normal actions that would make derived Free to Spend negative.
- Paycheck correction may make derived Free to Spend negative only when old paycheck money is no longer available. This exception must never make a pocket negative.
- Categories are grouping/allocation containers and may hold unallocated cents only where the current schema explicitly supports it.
- Pockets hold set-aside money.

## Ledger Rules

- Every balance-changing action must go through `applyBatch` or `reverseBatch` in `src/server/services/ledger.ts`.
- Balance-changing actions must create a `MoneyMovementBatch`.
- Atomic balance effects must be recorded as `MoneyMovement` rows.
- User-readable events must be recorded as `ActivityLog` rows.
- Reversal must create a new opposite batch.
- Reversal must not delete, edit, or hide original movement rows.
- Double reversal must be blocked.
- Reversal must be blocked when inverse effects would create negative balances or when the action is not cleanly reversible.

## Deposit Types

Paycheck/income deposits are new money. They may auto-disperse through the active funding plan.

Payback/refund deposits are returning money. They should restore prior movements or use an explicit destination. They must not auto-disperse by default.

Manual adjustments are correction entries. They require a note and must not auto-disperse.

Paycheck corrections must create new ledger history instead of editing or deleting the original paycheck. Payroll-generated paycheck corrections may optionally update the job amount for future paychecks only.

## Funding And Allocation

- Funding percentages are represented in basis points.
- Top-level category plus Free to Spend allocation must total 100%.
- A category's pocket splits may total less than or equal to 100%.
- Category remainders, capped-pocket overflow, and unplaceable category money should route to that category's Overflow pocket when one exists.
- Users must not create, edit, archive, purchase, or cancel an Overflow pocket directly.
- Users may transfer money to and from active Overflow pockets.
- Archived categories must hide/archive their Overflow pocket from active flows, and new pockets must not be created inside archived categories.
- When a category changes from 0% to a positive allocation and all active normal pocket allocations are 0%, saving the plan should split active normal pockets evenly.
- Allocation must conserve every cent.
- Allocation must cap pockets at their remaining target capacity.
- Fully funded pockets should be skipped for additional auto-allocation.

## Implemented User Surface

- Dashboard with Main Account, Set Aside, and Free to Spend.
- Category and pocket creation/editing/archive flows.
- Manual set-aside to pockets and categories.
- Paycheck deposit and auto-disperse.
- Paycheck correction.
- Funding-plan editor with auto-even split for newly funded zeroed categories.
- Transfers between pockets, Free to Spend, and categories.
- Payback/refund restore.
- Purchase and cancel pocket flows.
- Manual adjustment service.
- Recurring jobs and payroll catch-up.
- Account deletion for non-demo users.
- Notifications, activity history, and safe reversal controls.
- In-app confirmation dialogs for destructive actions.

## Validation

Before a change is complete, run the relevant subset of:

```powershell
npm run db:reset
npm run typecheck
npm test
npm run build
```

Run the full sequence for documentation, schema, setup, or shared money-flow changes.
