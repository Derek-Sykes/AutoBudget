# Local Setup

Use this guide for a fresh clone of `Derek-Sykes/AutoBudget`.

## Prerequisites

- Node.js 22 or newer. The local reset script uses `node:sqlite`.
- npm
- Git

This workspace was verified with Node `v25.9.0` and npm `11.12.1`.

## Install Dependencies

```powershell
npm ci
```

Use `npm install` only when intentionally changing dependencies.

## Configure Environment

```powershell
Copy-Item .env.example .env
```

Required value:

```dotenv
DATABASE_URL="file:./dev.db"
```

Optional value:

```dotenv
MOCK_MAIN_ACCOUNT_STARTING_BALANCE_CENTS=500000
```

Prisma resolves `file:./dev.db` relative to the `prisma/` directory, so the local database is `prisma/dev.db`.

## Create And Seed The Database

```powershell
npm run db:reset
```

This is destructive: it deletes and recreates the SQLite database configured by `DATABASE_URL`.

That command runs the repo-local reset script, which:

- loads `.env`
- validates `prisma/schema.prisma`
- generates Prisma Client
- generates SQLite schema SQL from the Prisma schema
- deletes and recreates the configured SQLite database
- runs `prisma/seed.ts`
- verifies the seeded demo user and Main Account

The seed creates:

- demo user `demo@example.com`
- one simulated `Main Account`
- categories and pockets
- one Overflow pocket per category
- a default funding plan
- recurring income jobs
- an initial activity log entry

## Run The App

```powershell
npm run dev
```

Open http://localhost:3100.

Main routes:

- http://localhost:3100/dashboard
- http://localhost:3100/jobs
- http://localhost:3100/funding-plan
- http://localhost:3100/activity

## Useful Reset Commands

Regenerate Prisma Client:

```powershell
npm run db:generate
```

Recreate local database and seed data:

```powershell
npm run db:reset
```

## Troubleshooting

If Prisma reports `DATABASE_URL` is missing, confirm `.env` exists and was copied from `.env.example`.

If the app cannot find the Main Account or demo data, run `npm run db:reset`.

If build or page rendering fails after schema changes, run `npm run db:generate` and `npm run db:reset`.

If dependency installation behaves strangely, delete `node_modules` and run `npm ci` again.

Direct `prisma db push` currently fails in this Windows workspace with a schema-engine error after schema validation succeeds. Use `npm run db:reset` only when you are okay with destroying and reseeding the configured local SQLite database.
