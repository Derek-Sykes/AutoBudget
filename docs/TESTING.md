# Testing And Verification

Use this sequence before handing off setup, schema, or shared money-flow changes:

```powershell
npm run db:reset
npm run typecheck
npm test
npm run build
```

## Commands

`npm run db:reset` destructively deletes and recreates the local SQLite database through `scripts/reset-db.mjs`, then runs `prisma/seed.ts`.

`npm run typecheck` runs TypeScript with `--noEmit`.

`npm test` runs Vitest once.

`npm run test:watch` starts Vitest watch mode.

`npm run build` creates a production Next.js build.

`npm run lint` runs ESLint.

## Test Suite

The suite includes pure domain tests, service integration tests, auth tests, and user-isolation tests.

Coverage includes:

- cents parsing, formatting, and Free to Spend math
- allocation conservation, rounding, capping, and Overflow routing
- funding-plan validation and persistence
- balance derivation
- manual set-aside to pockets and categories
- paycheck deposit and auto-disperse
- paycheck correction for manual and payroll-generated deposits, including negative Free to Spend exception coverage
- payback/refund restoration
- purchase, cancel, and transfer flows
- Overflow lifecycle guards and archived-category restrictions
- manual adjustments
- recurring payroll scheduling and catch-up idempotency
- funding-plan auto-even split when a zeroed category becomes funded
- safe reversal rules
- signup, login credential checks, password hashing, session expiry, and session invalidation
- account deletion validation, demo-account protection, session invalidation, and cross-user isolation
- server-side capitalization of user-created names
- in-app confirmation dialog regression coverage for native browser popups
- protected-route/action auth guards
- cross-user isolation for categories, pockets, ledger reversal, notifications, jobs, payroll, funding-plan editor data, and Overflow pockets

## Test Database

Vitest uses `DATABASE_URL="file:./test.db"` from `vitest.config.ts`.

`tests/globalSetup.ts` removes old `prisma/test.db` files and runs `node scripts/reset-db.mjs --skip-seed --skip-generate` before tests. Test cases wipe tables before each run in `tests/setup.ts`.

The app and build use the local `.env` database, normally `prisma/dev.db`.
