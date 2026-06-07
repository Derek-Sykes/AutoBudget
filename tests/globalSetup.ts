import { execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

// Create a clean schema in the dedicated test database (prisma/test.db) once,
// before any test runs. We delete the file directly (not via Prisma) for a
// clean slate, then a plain `db push` creates the schema. The DATABASE_URL is
// also set in vitest.config.ts for the worker that runs the tests.
export default function setup() {
  const prismaDir = join(process.cwd(), "prisma");
  for (const file of ["test.db", "test.db-journal", "test.db-wal", "test.db-shm"]) {
    const p = join(prismaDir, file);
    if (existsSync(p)) rmSync(p);
  }

  execSync("npx prisma db push --skip-generate", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: "file:./test.db" },
  });
}
