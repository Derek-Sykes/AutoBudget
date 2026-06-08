import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import process from "node:process";

const workspaceRoot = process.cwd();
const prismaDir = path.join(workspaceRoot, "prisma");
const schemaPath = path.join(prismaDir, "schema.prisma");
const prismaCliPath = path.join(workspaceRoot, "node_modules", "prisma", "build", "index.js");
const tsxCliPath = path.join(workspaceRoot, "node_modules", "tsx", "dist", "cli.mjs");
const skipGenerate = process.argv.includes("--skip-generate");
const skipSeed = process.argv.includes("--skip-seed");

const env = {
  ...readDotEnv(path.join(workspaceRoot, ".env")),
  ...process.env,
};
const databaseUrl = env.DATABASE_URL ?? "file:./dev.db";
const commandEnv = { ...env, DATABASE_URL: databaseUrl };

function readDotEnv(filePath) {
  if (!existsSync(filePath)) return {};

  const values = {};
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
    if (!match) continue;

    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

function runPrisma(args, options = {}) {
  const result = spawnSync(process.execPath, [prismaCliPath, ...args], {
    cwd: workspaceRoot,
    env: commandEnv,
    shell: false,
    stdio: options.capture ? ["ignore", "pipe", "inherit"] : "inherit",
    encoding: "utf8",
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`prisma ${args.join(" ")} failed with exit code ${result.status}`);
  }
  return result.stdout ?? "";
}

function runCommand(command, args) {
  const result = spawnSync(command, args, {
    cwd: workspaceRoot,
    env: commandEnv,
    shell: false,
    stdio: "inherit",
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
}

function resolveSqlitePath(url) {
  if (!url.startsWith("file:")) {
    throw new Error(`Only local SQLite file: URLs are supported. Received: ${url}`);
  }

  const rawPath = url.slice("file:".length);
  const isWindowsAbsolute = /^[a-zA-Z]:[\\/]/.test(rawPath);
  const resolved = path.normalize(
    path.isAbsolute(rawPath) || isWindowsAbsolute
      ? rawPath
      : path.resolve(prismaDir, rawPath),
  );

  if (!resolved.startsWith(workspaceRoot)) {
    throw new Error(`Refusing to reset a database outside this workspace: ${resolved}`);
  }

  return resolved;
}

function removeExistingDatabase(databasePath) {
  for (const target of [
    databasePath,
    `${databasePath}-journal`,
    `${databasePath}-shm`,
    `${databasePath}-wal`,
  ]) {
    if (existsSync(target)) {
      rmSync(target, { force: true });
    }
  }
}

function applySql(databasePath, sql) {
  mkdirSync(path.dirname(databasePath), { recursive: true });

  const db = new DatabaseSync(databasePath);
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(sql);
  db.close();
}

async function verifySeedData() {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();

  try {
    const user = await prisma.user.findUnique({
      where: { email: "demo@autobudget.local" },
      include: {
        accounts: true,
        categories: true,
        jobs: true,
        pockets: true,
      },
    });

    if (!user) throw new Error("Seed verification failed: demo user is missing.");
    if (!user.accounts.some((account) => account.isMain)) {
      throw new Error("Seed verification failed: Main Account is missing.");
    }
    if (user.categories.length === 0) {
      throw new Error("Seed verification failed: categories are missing.");
    }
    if (user.pockets.length === 0) {
      throw new Error("Seed verification failed: pockets are missing.");
    }

    console.log(
      `Seed verified: ${user.email}, ${user.categories.length} categories, ` +
        `${user.pockets.length} pockets, ${user.jobs.length} jobs.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

console.log("Validating Prisma schema...");
runPrisma(["validate"]);

if (skipGenerate) {
  console.log("Skipping Prisma Client generation.");
} else {
  console.log("Generating Prisma Client...");
  runPrisma(["generate"]);
}

console.log("Generating SQLite schema SQL...");
const schemaSql = runPrisma(
  ["migrate", "diff", "--from-empty", "--to-schema-datamodel", schemaPath, "--script"],
  { capture: true },
);

const databasePath = resolveSqlitePath(databaseUrl);
console.log(`Resetting SQLite database at ${databasePath}...`);
removeExistingDatabase(databasePath);
applySql(databasePath, schemaSql);

if (skipSeed) {
  console.log("Skipping seed data.");
} else {
  console.log("Running seed data...");
  runCommand(process.execPath, [tsxCliPath, "prisma/seed.ts"]);
  await verifySeedData();
}

console.log(`Database reset complete (${randomUUID().slice(0, 8)}).`);
