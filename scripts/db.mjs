// Database schema commands.
//
//   npm run db:print-sql                         print the full schema SQL (no connection)
//   npm run db:print-sql -- --out schema.sql     write it to a UTF-8 file instead
//   npm run db:status  -- --env-file <file>      show applied and pending migrations (read-only)
//   npm run db:migrate -- --env-file <file> --confirm-target <project-ref>
//                                                apply pending migrations in one transaction
//
// DATABASE_URL (from the shell environment or --env-file) selects the database,
// using the same TLS verification as the application (see db-config.ts).
// Without DATABASE_URL, pass --embedded to target the local embedded database;
// stop `npm run dev` first, because only one process may open it.
//
// Target safety (all checked before connecting):
// - With --env-file, every DATABASE_* setting must come from that file; the
//   command refuses to run if any is also set in the shell.
// - The Target line names the Supabase project (pooler host names are shared).
// - db:migrate against a database that is not on this machine requires
//   --confirm-target with the Supabase project ref, or the host name for other
//   servers. db:status accepts it (and checks it) but does not require it.
// Credentials are never printed.
import fs from "node:fs";
import path from "node:path";
import {
  DatabaseConfigError,
  describeDatabaseTarget,
  explainDatabaseError,
  resolveDatabaseConfig,
} from "../src/lib/server/db-config.ts";
import {
  DatabaseSchemaError,
  MIGRATIONS,
  MigrationLockTimeoutError,
  applyMigrations,
  findPendingMigrations,
  readAppliedVersions,
  renderMigrationScript,
} from "../src/lib/server/migrations.ts";
import { TargetSafetyError, UsageError, checkTargetConfirmation, loadEnvironment, parseArguments } from "./lib/cli.mjs";

const USAGE = `Usage:
  npm run db:print-sql [-- --out <file>]
  npm run db:status  [-- --env-file <file> | --embedded] [--confirm-target <project-ref | host>]
  npm run db:migrate [-- --env-file <file> | --embedded] [--confirm-target <project-ref | host>]

db:migrate needs --confirm-target for any database that is not on this machine: the
Supabase project ref (or the host name for other PostgreSQL servers) shown on the Target line.`;

async function openCliDatabase(config) {
  if (config.kind === "pglite") {
    const { PGlite } = await import("@electric-sql/pglite");
    fs.mkdirSync(config.dataDir, { recursive: true });
    const client = await PGlite.create(config.dataDir);
    const wrap = (target) => ({
      query: async (text, params = []) => (await target.query(text, params)).rows,
      exec: async (text) => {
        await target.exec(text);
      },
    });
    return { ...wrap(client), transaction: (fn) => client.transaction((tx) => fn(wrap(tx))), close: () => client.close() };
  }

  const pg = (await import("pg")).default;
  const client = new pg.Client({
    connectionString: config.connectionString,
    ssl: config.ssl,
    connectionTimeoutMillis: config.connectionTimeoutMillis,
  });
  try {
    await client.connect();
  } catch (error) {
    throw explainDatabaseError(error, config);
  }
  const queryable = {
    query: async (text, params = []) => (await client.query(text, params)).rows,
    exec: async (text) => {
      await client.query(text);
    },
  };
  return {
    ...queryable,
    async transaction(fn) {
      await client.query("BEGIN");
      try {
        const result = await fn(queryable);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      }
    },
    close: () => client.end(),
  };
}

async function printStatus(db) {
  const applied = await readAppliedVersions(db);
  const pending = findPendingMigrations(applied);
  const known = new Set(MIGRATIONS.map((migration) => migration.version));
  const appliedSet = new Set(applied ?? []);
  console.log(
    applied === null
      ? "Schema: empty (no migrations applied yet)"
      : `Schema: ${MIGRATIONS.length - pending.length} of ${MIGRATIONS.length} migrations applied`,
  );
  for (const migration of MIGRATIONS) {
    console.log(`  ${appliedSet.has(migration.version) ? "applied" : "pending"}  ${migration.version}  ${migration.name}`);
  }
  for (const version of applied ?? []) {
    if (!known.has(version)) console.log(`  unknown  ${version}  (applied by a newer version of the application)`);
  }
  return pending.length;
}

async function main() {
  const { flags, options, positionals } = parseArguments(process.argv.slice(2), {
    flags: ["embedded"],
    options: ["env-file", "out", "confirm-target"],
  });
  const command = positionals[0];
  // Checked for every command: with --env-file, no DATABASE_* setting may also
  // be set in the shell (see loadEnvironment).
  const loaded = options["env-file"] ? loadEnvironment(process.cwd(), options["env-file"]) : null;

  if (command === "print-sql") {
    if (options["confirm-target"]) {
      throw new UsageError("db:print-sql does not connect to a database, so there is no target to confirm. Remove --confirm-target.");
    }
    const script = renderMigrationScript();
    if (options.out) {
      fs.writeFileSync(path.resolve(options.out), script, "utf8");
      console.log(`Wrote ${MIGRATIONS.length} migrations to ${options.out}`);
    } else {
      process.stdout.write(script);
    }
    return 0;
  }

  if (command !== "migrate" && command !== "status") {
    console.error(USAGE);
    return 2;
  }

  const { env, sourceOf } = loaded ?? loadEnvironment(process.cwd());
  const hasUrl = Boolean(env.DATABASE_URL?.trim());
  if (!hasUrl && !flags.embedded) {
    throw new UsageError(
      "DATABASE_URL is not set. Pass --env-file <file> (or set DATABASE_URL in the shell) to target PostgreSQL/Supabase, " +
        "or pass --embedded to target the local embedded database (stop `npm run dev` first).",
    );
  }
  if (hasUrl && flags.embedded) {
    throw new UsageError("--embedded cannot be combined with DATABASE_URL. Remove one of them.");
  }

  const config = resolveDatabaseConfig(env, {
    cwd: process.cwd(),
    readFile: (file) => fs.readFileSync(file, "utf8"),
    allowEmbedded: flags.embedded === true,
  });
  console.log(`Target: ${describeDatabaseTarget(config)}`);
  if (config.kind === "postgres") console.log(`DATABASE_URL from: ${sourceOf("DATABASE_URL")}`);
  for (const warning of config.warnings) console.warn(`Warning: ${warning}`);

  const confirmation = checkTargetConfirmation(config, options["confirm-target"], {
    required: command === "migrate",
    command: `db:${command}`,
  });
  if (confirmation.confirmed) console.log(`Target confirmed: ${confirmation.label} ${confirmation.name}`);

  const db = await openCliDatabase(config);
  try {
    if (command === "status") {
      const pending = await printStatus(db);
      if (pending > 0) console.log("Run `npm run db:migrate` (with the same options) to apply the pending migrations.");
      return 0;
    }
    const appliedNow = await applyMigrations(db, { advisoryLock: config.kind === "postgres" });
    console.log(appliedNow.length > 0 ? `Applied migrations: ${appliedNow.join(", ")}` : "Schema is already up to date. Nothing to apply.");
    await printStatus(db);
    return 0;
  } catch (error) {
    throw config.kind === "postgres" ? explainDatabaseError(error, config) : error;
  } finally {
    await db.close().catch(() => undefined);
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    const known =
      error instanceof UsageError ||
      error instanceof TargetSafetyError ||
      error instanceof DatabaseConfigError ||
      error instanceof DatabaseSchemaError ||
      error instanceof MigrationLockTimeoutError ||
      error?.name === "DatabaseConnectionError";
    // Print only the message: some driver errors carry connection details.
    console.error(`Error: ${known ? error.message : (error?.message ?? String(error))}`);
    if (error instanceof UsageError) console.error(`\n${USAGE}`);
    process.exitCode = 1;
  },
);
