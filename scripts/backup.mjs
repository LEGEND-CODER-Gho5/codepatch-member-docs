// Full backups from the command line (the same files as Admin → Backups).
//
//   npm run db:backup  -- --env-file <file> [--out <backup.json>]
//        saves a backup of that database to a file (read-only; default name in ./backups/)
//   npm run db:backup  -- --embedded [--out <backup.json>]
//        the same for the local embedded database (stop `npm run dev` first)
//   npm run db:restore -- --file <backup.json> --check
//        only reads the file and prints what it contains (no database)
//   npm run db:restore -- --file <backup.json> --env-file <file> --confirm-target <project-ref>
//        restores into the PostgreSQL/Supabase database named in that env file
//   npm run db:restore -- --file <backup.json> --embedded
//        restores into the local embedded database (PGLITE_DATA_DIR, default ./.data/pglite)
//
// A restore goes only into a database that has none of this application's
// tables yet: it never overwrites or merges with existing data. It creates the
// schema as it was when the backup was made, loads every row, restores the ID
// sequences, then applies any newer migrations, all in one transaction (if
// anything fails, nothing is changed). Passwords keep working (their hashes
// are in the backup); everyone has to sign in again.
//
// Backup files contain password hashes: keep them private. ./backups/ is
// git-ignored and never uploaded to Vercel.
//
// Target safety is the same as db:migrate (scripts/lib/cli.mjs): with
// --env-file no DATABASE_* setting may also be set in the shell, and a restore
// into a database that is not on this machine needs --confirm-target.
// Credentials are never printed.
import fs from "node:fs";
import path from "node:path";
import { describeDatabaseTarget, explainDatabaseError, resolveDatabaseConfig } from "../src/lib/server/db-config.ts";
import {
  ALL_APP_TABLES,
  MIGRATIONS,
  MIGRATION_LOCK_TIMEOUT,
  SCHEMA_MIGRATIONS_TABLE_SQL,
} from "../src/lib/server/migrations.ts";
import { BACKUP_TABLES, BackupError, createBackup, restoreBackup, validateBackup } from "../src/lib/server/backup-data.ts";
import { UsageError, checkTargetConfirmation, loadEnvironment, openCliDatabase, parseArguments } from "./lib/cli.mjs";

const USAGE = `Usage:
  npm run db:backup  -- --env-file <file> | --embedded  [--out <backup.json>]
  npm run db:restore -- --file <backup.json> --check
  npm run db:restore -- --file <backup.json> --env-file <file> --confirm-target <project-ref | host>
  npm run db:restore -- --file <backup.json> --embedded`;

function describe(backup) {
  console.log(`Backup made ${backup.createdAt} (${backup.source}), schema version ${backup.schemaVersion}`);
  for (const table of BACKUP_TABLES) console.log(`  ${String(backup.counts[table]).padStart(6)}  ${table}`);
}

/** Resolves the database from --env-file / --embedded and prints the Target line. */
function resolveTarget(flags, options, command, { confirmationRequired }) {
  const { env, sourceOf } = loadEnvironment(process.cwd(), options["env-file"]);
  const hasUrl = Boolean(env.DATABASE_URL?.trim());
  if (!hasUrl && !flags.embedded) {
    throw new UsageError("Pass --env-file <file> for PostgreSQL/Supabase, or --embedded for the local embedded database.");
  }
  if (hasUrl && flags.embedded) throw new UsageError("--embedded cannot be combined with DATABASE_URL. Remove one of them.");
  const config = resolveDatabaseConfig(env, {
    cwd: process.cwd(),
    readFile: (name) => fs.readFileSync(name, "utf8"),
    allowEmbedded: flags.embedded === true,
  });
  console.log(`Target: ${describeDatabaseTarget(config)}`);
  if (config.kind === "postgres") console.log(`DATABASE_URL from: ${sourceOf("DATABASE_URL")}`);
  for (const warning of config.warnings) console.warn(`Warning: ${warning}`);
  const confirmation = checkTargetConfirmation(config, options["confirm-target"], { required: confirmationRequired, command });
  if (confirmation.confirmed) console.log(`Target confirmed: ${confirmation.label} ${confirmation.name}`);
  return config;
}

async function runBackup(flags, options) {
  if (options.file || flags.check) throw new UsageError("db:backup takes --out, not --file or --check.");
  const config = resolveTarget(flags, options, "db:backup", { confirmationRequired: false });
  if (config.kind === "pglite" && !fs.existsSync(config.dataDir)) {
    throw new UsageError(`No embedded database found at ${config.dataDir}.`);
  }
  const db = await openCliDatabase(config);
  let backup;
  try {
    backup = await createBackup(db, "cli");
  } catch (error) {
    throw config.kind === "postgres" && !(error instanceof BackupError) ? explainDatabaseError(error, config) : error;
  } finally {
    await db.close().catch(() => undefined);
  }
  const out = path.resolve(options.out ?? path.join("backups", `code-patch-stem-backup-${backup.createdAt.replace(/[:.]/g, "-")}.json`));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(backup), { encoding: "utf8", flag: "wx" });
  describe(backup);
  console.log(`Saved ${path.relative(process.cwd(), out) || out} (${fs.statSync(out).size} bytes). It contains password hashes: keep it private.`);
  return 0;
}

async function runRestore(flags, options) {
  if (!options.file) throw new UsageError("--file <backup.json> is required.");
  if (options.out) throw new UsageError("db:restore takes --file, not --out.");
  const file = path.resolve(options.file);
  if (!fs.existsSync(file)) throw new UsageError(`Backup file not found: ${options.file}`);
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    throw new BackupError("This is not a usable backup file: it is not valid JSON.");
  }
  const backup = validateBackup(parsed, MIGRATIONS);
  describe(backup);

  if (flags.check) {
    if (options["env-file"] || options["confirm-target"] || flags.embedded) {
      throw new UsageError("--check only reads the file. Remove --env-file, --confirm-target, and --embedded.");
    }
    console.log("The file is a complete, readable backup.");
    return 0;
  }

  const config = resolveTarget(flags, options, "db:restore", { confirmationRequired: true });
  const db = await openCliDatabase(config);
  try {
    const summary = await restoreBackup(db, backup, MIGRATIONS, {
      allAppTables: ALL_APP_TABLES,
      schemaMigrationsSql: SCHEMA_MIGRATIONS_TABLE_SQL,
      lockTimeoutSql: `SET LOCAL lock_timeout = '${MIGRATION_LOCK_TIMEOUT}'`,
    });
    const total = Object.values(summary.counts).reduce((sum, n) => sum + n, 0);
    console.log(`Restored ${total} rows into ${BACKUP_TABLES.length} tables.`);
    if (summary.appliedAfter.length > 0) console.log(`Then applied newer migrations: ${summary.appliedAfter.join(", ")}`);
    console.log("Done. Everyone signs in again; passwords are unchanged.");
    return 0;
  } catch (error) {
    throw config.kind === "postgres" && !(error instanceof BackupError) ? explainDatabaseError(error, config) : error;
  } finally {
    await db.close().catch(() => undefined);
  }
}

async function main() {
  const { flags, options, positionals } = parseArguments(process.argv.slice(2), {
    flags: ["embedded", "check"],
    options: ["file", "out", "env-file", "confirm-target"],
  });
  if (positionals[0] === "create") return runBackup(flags, options);
  if (positionals[0] === "restore") return runRestore(flags, options);
  console.error(USAGE);
  return 2;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    // Print only the message: some driver errors carry connection details.
    console.error(`Error: ${error?.code === "EEXIST" ? "That output file already exists; choose another --out name." : (error?.message ?? String(error))}`);
    if (error instanceof UsageError) console.error(`\n${USAGE}`);
    process.exitCode = 1;
  },
);
