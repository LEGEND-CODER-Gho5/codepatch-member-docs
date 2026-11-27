// Shared helpers for the command-line scripts: argument parsing, .env loading,
// and the target-safety checks that run before any database connection.
// Never print environment values from here: they can contain credentials.
import fs from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import { explainDatabaseError, isLocalHost } from "../../src/lib/server/db-config.ts";

export class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = "UsageError";
  }
}

/** A command refused to run because its database target is ambiguous or unconfirmed. */
export class TargetSafetyError extends Error {
  constructor(message) {
    super(message);
    this.name = "TargetSafetyError";
  }
}

/**
 * Parses `--flag`, `--option value` and `--option=value` arguments.
 * Unknown options are rejected so typos never fall through silently.
 */
export function parseArguments(argv, { flags: flagNames = [], options: optionNames = [] } = {}) {
  const flags = {};
  const options = {};
  const positionals = [];
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (!argument.startsWith("--")) {
      positionals.push(argument);
      continue;
    }
    const equals = argument.indexOf("=");
    const name = equals === -1 ? argument.slice(2) : argument.slice(2, equals);
    if (flagNames.includes(name)) {
      if (equals !== -1) throw new UsageError(`--${name} does not take a value.`);
      flags[name] = true;
    } else if (optionNames.includes(name)) {
      const value = equals === -1 ? argv[++index] : argument.slice(equals + 1);
      if (!value || value.startsWith("--")) throw new UsageError(`--${name} needs a value.`);
      options[name] = value;
    } else {
      throw new UsageError(`Unknown option --${name}.`);
    }
  }
  return { flags, options, positionals };
}

const isDatabaseSetting = (name) => name.toUpperCase().startsWith("DATABASE_");

/**
 * Loads environment variables the way the scripts document:
 * - with envFile: only that file. Every DATABASE_* setting must then come from
 *   that file alone: if any is also set in the shell environment, this throws
 *   TargetSafetyError (naming the variables and where they are set, never the
 *   values), because a shell value would silently override the file and point
 *   the command at a different database.
 * - otherwise: .env, then .env.local (later files win).
 * Other variables already set in the process environment take precedence.
 * Returns the merged variables and where each one came from (a file name or
 * "environment"), never the values themselves.
 */
export function loadEnvironment(cwd, envFile, environment = process.env) {
  const files = envFile ? [path.resolve(cwd, envFile)] : [path.join(cwd, ".env"), path.join(cwd, ".env.local")];
  const env = {};
  const sources = {};
  for (const file of files) {
    if (!fs.existsSync(file)) {
      if (envFile) throw new UsageError(`Environment file not found: ${envFile}`);
      continue;
    }
    const parsed = parseEnv(fs.readFileSync(file, "utf8"));
    for (const [key, value] of Object.entries(parsed)) {
      env[key] = value;
      sources[key] = path.relative(cwd, file) || file;
    }
  }

  if (envFile) {
    // Windows treats variable names case-insensitively, so compare in upper case.
    const shellSettings = Object.keys(environment)
      .filter((name) => environment[name] !== undefined && isDatabaseSetting(name))
      .sort();
    if (shellSettings.length > 0) {
      const fileLabel = path.relative(cwd, files[0]) || files[0];
      const fileSettings = new Set(Object.keys(env).map((name) => name.toUpperCase()));
      const lines = shellSettings.map(
        (name) => `  ${name}: set in the shell environment${fileSettings.has(name.toUpperCase()) ? ` and in ${fileLabel}` : ""}`,
      );
      throw new TargetSafetyError(
        `--env-file was given, but database settings are also set in the shell environment:\n${lines.join("\n")}\n` +
          `With --env-file, every DATABASE_* setting must come from that file alone, so nothing was run and no connection was made.\n` +
          `Remove ${shellSettings.length === 1 ? "it" : "them"} from this shell and run the command again ` +
          `(PowerShell: Remove-Item Env:${shellSettings[0]}  bash: unset ${shellSettings[0]}). Values are never shown.`,
      );
    }
  }

  for (const [key, value] of Object.entries(environment)) {
    if (value === undefined) continue;
    env[key] = value;
    sources[key] = "environment";
  }
  return { env, sourceOf: (key) => sources[key] ?? null };
}

/**
 * The name an operator must give with --confirm-target for this target: the
 * Supabase project ref, or the host name for any other PostgreSQL server.
 * Returns null for the embedded database (nothing to confirm) and for Supabase
 * pooler URLs whose user name names no project (the target cannot be confirmed).
 */
export function confirmationName(config) {
  if (config.kind !== "postgres") return null;
  const { host, supabase } = config.target;
  if (supabase) return supabase.projectRef;
  return host.toLowerCase();
}

/**
 * Checks --confirm-target before any connection is opened.
 * - required (db:migrate, credentials:reset): a database that is not on this
 *   machine can only be changed when --confirm-target names it exactly.
 * - Whenever --confirm-target is given (any command), it must match the target.
 * The embedded database and localhost need no confirmation. Throws
 * TargetSafetyError; the given value is never echoed (it could be a pasted secret).
 */
export function checkTargetConfirmation(config, confirmation, { required, command }) {
  const given = confirmation?.trim().replace(/^\[|\]$/g, "").toLowerCase() || null;
  const stopped = "Stopped before connecting; nothing was changed.";

  if (config.kind !== "postgres") {
    if (given) {
      throw new TargetSafetyError(`--confirm-target was given, but the target is the embedded database on this machine. ${stopped}`);
    }
    return { confirmed: false };
  }

  const { host, supabase } = config.target;
  const remote = !isLocalHost(host);
  const expected = confirmationName(config);
  const label = supabase ? "Supabase project ref" : "host name";

  if (supabase && expected === null && (given || (required && remote))) {
    throw new TargetSafetyError(
      `${command} cannot confirm this target: it is a Supabase pooler address, but the user name in DATABASE_URL does not name a ` +
        `project (expected postgres.<project-ref>). ${stopped}`,
    );
  }
  if (!given) {
    if (required && remote) {
      throw new TargetSafetyError(
        `Refusing to run ${command} against a database that is not on this machine without --confirm-target.\n` +
          `Check the Target line above. If it is the database you mean, run the command again with ` +
          `--confirm-target <the ${label} shown there>. ${stopped}`,
      );
    }
    return { confirmed: false };
  }
  if (given !== expected) {
    throw new TargetSafetyError(`The --confirm-target value does not match this database's ${label} (${expected}). ${stopped}`);
  }
  return { confirmed: true, label, name: expected };
}

/**
 * Opens the configured database for a command-line script: one PostgreSQL
 * connection (same TLS verification as the application) or the embedded
 * database. Returns query/exec/transaction/close.
 */
export async function openCliDatabase(config) {
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
