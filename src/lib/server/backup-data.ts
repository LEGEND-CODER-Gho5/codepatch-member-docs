/**
 * Full backups: a JSON copy of every table that holds chapter data, and the
 * code that loads such a copy into an empty database.
 *
 * - The application writes one every night (see backup-jobs.ts) and lets the
 *   administrator download one at any time (Admin → Backups).
 * - `npm run db:restore` loads one into an empty database (scripts/restore-backup.mjs).
 * - `npm run test:backup` proves the round trip: backup → restore → identical data.
 *
 * A backup holds password hashes (never readable passwords), so a restored
 * site keeps every member's password. Sign-in sessions, the sign-in rate-limit
 * ledger, the live-update feed, and job status are left out: they are
 * temporary and rebuilt by the application.
 *
 * This file must stay free of imports (like migrations.ts) so the command-line
 * scripts can load it directly with Node.js.
 */

export const BACKUP_FORMAT = "codepatch-member-docs-backup";
export const BACKUP_FORMAT_VERSION = 1;

/**
 * Tables in a backup, parents before children: the order a restore inserts
 * them so every foreign key already has its target.
 */
export const BACKUP_TABLES = [
  "application_settings",
  "departments",
  "positions",
  "members",
  "member_departments",
  "member_credentials",
  "member_documentation",
  "contribution_entries",
  "volunteer_hours",
  "meetings",
  "meeting_attendance",
  "audit_logs",
  "notifications",
] as const;
export type BackupTable = (typeof BACKUP_TABLES)[number];

/** Application tables deliberately left out of backups (temporary or rebuilt state). */
export const TABLES_NOT_BACKED_UP = [
  "sessions",
  "login_attempts",
  "realtime_events",
  "schema_migrations",
  "maintenance_status",
] as const;

/** Sequences whose position is saved, so restored IDs (CPS-####, history entries) never repeat. */
export const BACKUP_SEQUENCES = [
  "member_number_seq",
  "audit_logs_id_seq",
  "notifications_id_seq",
  "login_attempts_id_seq",
  "realtime_events_id_seq",
] as const;

/** Stable row order, so two backups of the same data are identical. */
const ROW_ORDER: Record<BackupTable, string> = {
  application_settings: "id",
  departments: "id",
  positions: "id",
  members: "id",
  member_departments: "member_id, department_id",
  member_credentials: "member_id",
  member_documentation: "id",
  contribution_entries: "id",
  volunteer_hours: "id",
  meetings: "id",
  meeting_attendance: "meeting_id, member_id",
  audit_logs: "id",
  notifications: "id",
};

export type BackupRow = Record<string, unknown>;

export type BackupFile = {
  format: typeof BACKUP_FORMAT;
  formatVersion: number;
  createdAt: string;
  /** What made it: "scheduled" (nightly), "manual" (Back up now), "download", or "cli". */
  source: string;
  /** Highest migration applied to the database it came from. */
  schemaVersion: number;
  migrations: number[];
  counts: Record<string, number>;
  tables: Record<string, BackupRow[]>;
  sequences: Record<string, { lastValue: number; isCalled: boolean }>;
};

export interface BackupQueryable {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
  exec(text: string): Promise<void>;
}

export interface BackupDatabase extends BackupQueryable {
  transaction<T>(fn: (tx: BackupQueryable) => Promise<T>): Promise<T>;
}

export type BackupMigration = { version: number; name: string; sql: string };

export class BackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackupError";
  }
}

/** json and jsonb results arrive parsed from node-postgres, but as text from some drivers. */
function parseJson<T>(value: unknown): T {
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
}

/**
 * Reads every backed-up table in one read-only, repeatable-read transaction,
 * so the copy is a consistent snapshot even while members are saving.
 */
export async function createBackup(db: BackupDatabase, source: string): Promise<BackupFile> {
  return db.transaction(async (tx) => {
    await tx.exec("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");
    const versions = (await tx.query<{ version: unknown }>("SELECT version FROM schema_migrations ORDER BY version")).map(
      (row) => Number(row.version),
    );
    if (versions.length === 0) throw new BackupError("The database has no application schema, so there is nothing to back up.");

    const tables: Record<string, BackupRow[]> = {};
    const counts: Record<string, number> = {};
    for (const table of BACKUP_TABLES) {
      // A database on an older schema may not have every table yet (for
      // example meetings, added by migration 6): it is saved as empty, and a
      // restore creates it with the later migrations.
      const [exists] = await tx.query<{ present: boolean }>("SELECT to_regclass($1) IS NOT NULL AS present", [`public.${table}`]);
      if (!exists?.present) {
        tables[table] = [];
        counts[table] = 0;
        continue;
      }
      // Table and column names come only from the fixed lists above.
      const [result] = await tx.query<{ rows: unknown }>(
        `SELECT coalesce(json_agg(t ORDER BY ${ROW_ORDER[table]}), '[]'::json) AS rows FROM ${table} t`,
      );
      const rows = parseJson<BackupRow[]>(result?.rows ?? "[]");
      tables[table] = rows;
      counts[table] = rows.length;
    }

    const sequences: BackupFile["sequences"] = {};
    for (const sequence of BACKUP_SEQUENCES) {
      const [state] = await tx.query<{ last_value: unknown; is_called: unknown }>(
        `SELECT last_value, is_called FROM ${sequence}`,
      );
      if (state) sequences[sequence] = { lastValue: Number(state.last_value), isCalled: state.is_called === true || state.is_called === "t" };
    }

    return {
      format: BACKUP_FORMAT,
      formatVersion: BACKUP_FORMAT_VERSION,
      createdAt: new Date().toISOString(),
      source,
      schemaVersion: Math.max(...versions),
      migrations: versions,
      counts,
      tables,
      sequences,
    };
  });
}

/** Checks that a parsed file is a backup this code can restore, and returns it typed. */
export function validateBackup(value: unknown, migrations: readonly BackupMigration[]): BackupFile {
  const fail = (reason: string): never => {
    throw new BackupError(`This is not a usable backup file: ${reason}.`);
  };
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("it is not a JSON object");
  const backup = value as Partial<BackupFile>;
  if (backup.format !== BACKUP_FORMAT) fail("it was not made by this portal");
  if (backup.formatVersion !== BACKUP_FORMAT_VERSION) {
    fail(`it uses backup format ${String(backup.formatVersion)}, and this version of the portal reads format ${BACKUP_FORMAT_VERSION}`);
  }
  if (!Array.isArray(backup.migrations) || !backup.migrations.every((v) => Number.isInteger(v))) fail("its migration list is missing");
  const known = new Set(migrations.map((migration) => migration.version));
  const unknown = backup.migrations!.filter((version) => !known.has(version));
  if (unknown.length > 0) {
    fail(`it comes from a newer version of the portal (migration ${unknown.join(", ")}); restore it with that version`);
  }
  const expected = migrations.map((m) => m.version).filter((v) => v <= Number(backup.schemaVersion));
  if (backup.migrations!.join(",") !== expected.join(",")) fail("its migration list does not match its schema version");
  if (!backup.tables || typeof backup.tables !== "object") fail("its tables are missing");
  for (const table of BACKUP_TABLES) {
    const rows = backup.tables![table];
    if (!Array.isArray(rows)) fail(`the ${table} table is missing`);
    if (!rows!.every((row) => row && typeof row === "object" && !Array.isArray(row))) fail(`the ${table} table has invalid rows`);
    if (backup.counts?.[table] !== rows!.length) fail(`the ${table} table has ${rows!.length} rows but should have ${backup.counts?.[table]}`);
  }
  const extra = Object.keys(backup.tables!).filter((table) => !(BACKUP_TABLES as readonly string[]).includes(table));
  if (extra.length > 0) fail(`it contains unexpected tables (${extra.join(", ")})`);
  if (!backup.sequences || typeof backup.sequences !== "object") fail("its sequence positions are missing");
  return backup as BackupFile;
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

const INSERT_BATCH = 500;

export type RestoreSummary = { counts: Record<string, number>; appliedAfter: number[] };

/**
 * Loads a backup into an EMPTY database, in one transaction: it creates the
 * schema as it was when the backup was made (the backup's migrations), inserts
 * every row, restores the sequence positions, then applies any newer migrations
 * so the data is upgraded exactly as a live database would be. If anything
 * fails, the database is left unchanged.
 *
 * Refuses a database that already has any of this application's tables: a
 * restore never overwrites or merges with existing data.
 */
export async function restoreBackup(
  db: BackupDatabase,
  input: unknown,
  migrations: readonly BackupMigration[],
  options: { allAppTables: readonly string[]; schemaMigrationsSql: string; lockTimeoutSql: string },
): Promise<RestoreSummary> {
  const backup = validateBackup(input, migrations);
  return db.transaction(async (tx) => {
    await tx.exec(options.lockTimeoutSql);
    const existing = await tx.query<{ relname: string }>(
      "SELECT relname FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relname = ANY($1) ORDER BY relname",
      [[...options.allAppTables]],
    );
    if (existing.length > 0) {
      throw new BackupError(
        `The target database is not empty: it already has ${existing.length} of this portal's tables ` +
          `(${existing.map((row) => row.relname).join(", ")}). A restore only goes into an empty database, so nothing was changed.`,
      );
    }

    await tx.exec(options.schemaMigrationsSql);
    const before = migrations.filter((m) => m.version <= backup.schemaVersion);
    const after = migrations.filter((m) => m.version > backup.schemaVersion);
    for (const migration of before) {
      await tx.exec(migration.sql);
      await tx.query("INSERT INTO schema_migrations (version, name) VALUES ($1, $2)", [migration.version, migration.name]);
    }

    for (const table of BACKUP_TABLES) {
      const rows = backup.tables[table];
      if (rows.length === 0) continue;
      const columnRows = await tx.query<{ column_name: string }>(
        "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1",
        [table],
      );
      const actual = new Set(columnRows.map((row) => row.column_name));
      const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
      const unknown = columns.filter((column) => !actual.has(column));
      if (unknown.length > 0) {
        throw new BackupError(`The backup's ${table} table has columns this schema does not have (${unknown.join(", ")}). Nothing was changed.`);
      }
      const list = columns.map(quoteIdent).join(", ");
      for (let start = 0; start < rows.length; start += INSERT_BATCH) {
        const batch = rows.slice(start, start + INSERT_BATCH);
        await tx.query(`INSERT INTO ${table} (${list}) SELECT ${list} FROM json_populate_recordset(NULL::${table}, $1::json)`, [
          JSON.stringify(batch),
        ]);
      }
    }

    for (const sequence of BACKUP_SEQUENCES) {
      const state = backup.sequences[sequence];
      if (!state || !Number.isFinite(state.lastValue)) continue;
      await tx.query("SELECT setval($1::regclass, $2, $3)", [sequence, state.lastValue, state.isCalled === true]);
    }

    for (const migration of after) {
      await tx.exec(migration.sql);
      await tx.query("INSERT INTO schema_migrations (version, name) VALUES ($1, $2)", [migration.version, migration.name]);
    }

    const counts: Record<string, number> = {};
    for (const table of BACKUP_TABLES) {
      const [row] = await tx.query<{ n: unknown }>(`SELECT count(*) AS n FROM ${table}`);
      counts[table] = Number(row?.n ?? 0);
      if (counts[table] !== backup.counts[table]) {
        throw new BackupError(`After loading, ${table} has ${counts[table]} rows instead of ${backup.counts[table]}. Nothing was changed.`);
      }
    }
    return { counts, appliedAfter: after.map((m) => m.version) };
  });
}

/* --------------------------------- Retention -------------------------------- */

export const KEEP_DAILY_DAYS = 30;
export const KEEP_MONTHLY_MONTHS = 12;

/** Saved backups are named backups/<YYYYMMDD>T<HHMMSS>Z-<source>.json (UTC). */
export const SAVED_BACKUP_PATTERN = /^backups\/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z-(scheduled|manual)\.json$/;

export function savedBackupName(date: Date, source: "scheduled" | "manual"): string {
  const stamp = date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `backups/${stamp}-${source}.json`;
}

export function savedBackupDate(pathname: string): Date | null {
  const match = SAVED_BACKUP_PATTERN.exec(pathname);
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match.map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h, mi, s));
}

/**
 * Which saved backups to delete: every backup from the last KEEP_DAILY_DAYS
 * days stays, and so does the oldest backup of each of the last
 * KEEP_MONTHLY_MONTHS months. Files with other names are never touched.
 */
export function selectBackupsToDelete(pathnames: readonly string[], now: Date): string[] {
  const dated = pathnames
    .map((pathname) => ({ pathname, date: savedBackupDate(pathname) }))
    .filter((entry): entry is { pathname: string; date: Date } => entry.date !== null)
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  const dailyCutoff = now.getTime() - KEEP_DAILY_DAYS * 86_400_000;
  const monthKey = (date: Date) => date.getUTCFullYear() * 12 + date.getUTCMonth();
  const oldestMonth = monthKey(now) - (KEEP_MONTHLY_MONTHS - 1);
  const firstOfMonth = new Set<string>();
  const seenMonths = new Set<number>();
  for (const entry of dated) {
    const key = monthKey(entry.date);
    if (!seenMonths.has(key)) {
      seenMonths.add(key);
      if (key >= oldestMonth) firstOfMonth.add(entry.pathname);
    }
  }
  return dated
    .filter((entry) => entry.date.getTime() < dailyCutoff && !firstOfMonth.has(entry.pathname))
    .map((entry) => entry.pathname);
}
