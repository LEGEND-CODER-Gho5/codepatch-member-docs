import "server-only";
import fs from "node:fs";
import { attachDatabasePool } from "@vercel/functions/db-connections";
import type { Pool, PoolClient } from "pg";
import { explainDatabaseError, resolveDatabaseConfig, type PostgresDatabaseConfig } from "./db-config";
import { applyMigrations, assertSchemaIsCurrent } from "./migrations";
import { pokeRealtime } from "./realtime";

export type Row = Record<string, unknown>;

export interface Queryable {
  /** Runs one parameterized statement. Always use $1..$n placeholders for values. */
  query<T = Row>(text: string, params?: unknown[]): Promise<T[]>;
  /** Runs one or more statements without parameters (migrations only). */
  exec(text: string): Promise<void>;
}

export interface Database extends Queryable {
  kind: "pglite" | "postgres";
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

const globalStore = globalThis as unknown as { __cpsDatabase?: Promise<Database> };

export function getDb(): Promise<Database> {
  if (!globalStore.__cpsDatabase) {
    globalStore.__cpsDatabase = openDatabase().catch((error) => {
      globalStore.__cpsDatabase = undefined;
      throw error;
    });
  }
  return globalStore.__cpsDatabase;
}

export async function sql<T = Row>(text: string, params: unknown[] = []): Promise<T[]> {
  const db = await getDb();
  return db.query<T>(text, params);
}

export async function sqlOne<T = Row>(text: string, params: unknown[] = []): Promise<T | null> {
  const rows = await sql<T>(text, params);
  return rows[0] ?? null;
}

/** Runs fn atomically, then wakes realtime listeners on this instance. */
export async function withTransaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
  const db = await getDb();
  const result = await db.transaction(fn);
  pokeRealtime();
  return result;
}

const TYPE_PARSERS: Record<number, (value: string) => unknown> = {
  20: (value) => Number(value), // int8: counts and bigserial ids
  1082: (value) => value, // date: keep as YYYY-MM-DD (no time-zone shifting)
  1700: (value) => Number(value), // numeric: hours
};

/**
 * Opens the database chosen by the environment (see db-config.ts):
 * - DATABASE_URL set → PostgreSQL (e.g. Supabase) with verified TLS by default.
 * - otherwise → the embedded PGlite database, except in production, where the
 *   app refuses to fall back silently (ALLOW_EMBEDDED_DATABASE=true opts in).
 * Pending migrations are applied automatically only to the embedded database in
 * development. For PostgreSQL (in any environment) and in production, the app
 * only checks that `npm run db:migrate` has been run; DATABASE_AUTO_MIGRATE=true
 * opts in to automatic migration.
 */
async function openDatabase(): Promise<Database> {
  const config = resolveDatabaseConfig(process.env, {
    cwd: process.cwd(),
    readFile: (file) => fs.readFileSync(/*turbopackIgnore: true*/ file, "utf8"),
  });
  for (const warning of config.warnings) console.warn(`[database] ${warning}`);

  const db = config.kind === "postgres" ? await openPostgres(config) : await openPglite(config.dataDir);
  try {
    if (config.autoMigrate) await applyMigrations(db, { advisoryLock: db.kind === "postgres" });
    else await assertSchemaIsCurrent(db);
    return db;
  } catch (error) {
    // Close before the next request retries, so the embedded database is never
    // opened twice and no pooled connections are left behind.
    await db.close().catch(() => undefined);
    throw config.kind === "postgres" ? explainDatabaseError(error, config) : error;
  }
}

type PgliteLike = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
  exec: (text: string) => Promise<unknown>;
};

async function openPglite(dataDir: string): Promise<Database> {
  const { PGlite } = await import("@electric-sql/pglite");
  // Runtime-only data location; excluded from build-time file tracing.
  fs.mkdirSync(/*turbopackIgnore: true*/ dataDir, { recursive: true });
  const client = await PGlite.create(dataDir, { parsers: TYPE_PARSERS });

  const wrap = (target: PgliteLike): Queryable => ({
    async query<T>(text: string, params: unknown[] = []) {
      const result = await target.query(text, params);
      return result.rows as T[];
    },
    async exec(text: string) {
      await target.exec(text);
    },
  });

  return {
    kind: "pglite",
    ...wrap(client as unknown as PgliteLike),
    transaction: (fn) => client.transaction((tx) => fn(wrap(tx as unknown as PgliteLike))),
    close: () => client.close(),
  };
}

async function openPostgres(config: PostgresDatabaseConfig): Promise<Database> {
  const imported = await import("pg");
  const pg = (imported as unknown as { default?: typeof imported }).default ?? imported;
  for (const [oid, parser] of Object.entries(TYPE_PARSERS)) {
    pg.types.setTypeParser(Number(oid), parser);
  }
  // TLS comes only from `config.ssl`: TLS parameters were removed from the
  // connection string so they cannot override certificate verification.
  const pool: Pool = new pg.Pool({
    connectionString: config.connectionString,
    ssl: config.ssl,
    max: config.poolMax,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: config.connectionTimeoutMillis,
  });
  // Without a listener, an error on an idle pooled connection (for example the
  // pooler closing it) would crash the process.
  pool.on("error", (error: Error & { code?: string }) => {
    console.error(`[database] idle connection error: ${error.code ?? error.message}`);
  });
  // On Vercel Fluid compute, release idle connections before an instance
  // suspends. (It has no effect outside Vercel's runtime.)
  if (process.env.VERCEL) attachDatabasePool(pool);

  const wrap = (target: Pool | PoolClient): Queryable => ({
    async query<T>(text: string, params: unknown[] = []) {
      const result = await target.query(text, params);
      return result.rows as T[];
    },
    async exec(text: string) {
      await target.query(text);
    },
  });

  return {
    kind: "postgres",
    ...wrap(pool),
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn(wrap(client));
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}
