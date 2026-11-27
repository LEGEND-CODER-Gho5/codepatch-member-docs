/**
 * Ordered PostgreSQL migrations and the runner that applies them.
 *
 * - Embedded development database: applied automatically when the server first
 *   opens it.
 * - Any PostgreSQL database (Supabase, staging, production, local), in every
 *   environment: applied deliberately with `npm run db:migrate`; requests only
 *   check that the schema is current (see db.ts and DATABASE_AUTO_MIGRATE).
 * - `npm run db:print-sql` prints exactly what an empty database receives.
 *
 * Never edit a migration that has been applied to a shared or production
 * database; add a new one instead. This file must stay free of imports so the
 * command-line scripts can load it directly with Node.js.
 */

/** Tables created by this application. Permission changes are limited to these. */
export const APP_TABLES = [
  "application_settings",
  "departments",
  "positions",
  "members",
  "member_credentials",
  "member_documentation",
  "contribution_entries",
  "volunteer_hours",
  "audit_logs",
  "notifications",
  "sessions",
  "login_attempts",
  "realtime_events",
  "schema_migrations",
] as const;

/** Sequences created by this application (member_number_seq and the bigserial columns). */
export const APP_SEQUENCES = [
  "member_number_seq",
  "audit_logs_id_seq",
  "notifications_id_seq",
  "login_attempts_id_seq",
  "realtime_events_id_seq",
] as const;

function sqlTextArray(items: readonly string[]): string {
  return `ARRAY[${items.map((item) => `'${item}'`).join(", ")}]`;
}

export type Migration = { version: number; name: string; sql: string };

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "initial_schema",
    sql: /* sql */ `
CREATE TABLE application_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  organization_name text NOT NULL DEFAULT 'Code Patch STEM',
  chapter_name text NOT NULL DEFAULT 'South Brunswick High School (SBHS)',
  admin_display_name text NOT NULL DEFAULT 'Chapter Administrator',
  default_documentation_period text NOT NULL DEFAULT '',
  site_password_hash text NOT NULL,
  site_password_version integer NOT NULL DEFAULT 1,
  site_password_changed_at timestamptz NOT NULL DEFAULT now(),
  admin_password_hash text NOT NULL,
  admin_password_version integer NOT NULL DEFAULT 1,
  admin_password_changed_at timestamptz NOT NULL DEFAULT now(),
  site_session_hours integer NOT NULL DEFAULT 12 CHECK (site_session_hours BETWEEN 1 AND 168),
  member_idle_minutes integer NOT NULL DEFAULT 60 CHECK (member_idle_minutes BETWEEN 5 AND 720),
  admin_idle_minutes integer NOT NULL DEFAULT 60 CHECK (admin_idle_minutes BETWEEN 5 AND 720),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  description text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX departments_name_unique ON departments (lower(name));

CREATE TABLE positions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX positions_name_unique ON positions (lower(name));

CREATE SEQUENCE member_number_seq START WITH 1001;

CREATE TABLE members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_number integer NOT NULL UNIQUE DEFAULT nextval('member_number_seq'),
  full_name text NOT NULL CHECK (length(btrim(full_name)) BETWEEN 1 AND 120),
  department_id uuid NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
  position_id uuid NOT NULL REFERENCES positions(id) ON DELETE RESTRICT,
  email text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  start_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deactivated_at timestamptz
);
ALTER SEQUENCE member_number_seq OWNED BY members.member_number;
CREATE INDEX members_department_idx ON members (department_id);
CREATE INDEX members_status_idx ON members (status);

CREATE TABLE member_credentials (
  member_id uuid PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
  password_hash text NOT NULL,
  password_version integer NOT NULL DEFAULT 1,
  password_changed_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);

CREATE TABLE member_documentation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  document_type text NOT NULL CHECK (document_type IN ('member_documentation', 'volunteer_hours_record')),
  period text NOT NULL DEFAULT '',
  supervisor_name text NOT NULL DEFAULT '',
  supervisor_position text NOT NULL DEFAULT '',
  supervisor_signature text NOT NULL DEFAULT '',
  member_confirmation text NOT NULL DEFAULT '',
  date_submitted date,
  verification_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_edited_by_type text,
  last_edited_by_name text
);
CREATE INDEX member_documentation_member_idx ON member_documentation (member_id, document_type, created_at);

CREATE TABLE contribution_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES member_documentation(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  entry_date date,
  title text NOT NULL DEFAULT '',
  details text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX contribution_entries_document_idx ON contribution_entries (document_id, created_at);
CREATE INDEX contribution_entries_member_idx ON contribution_entries (member_id);

CREATE TABLE volunteer_hours (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES member_documentation(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  service_date date,
  description text NOT NULL DEFAULT '',
  hours numeric(7, 2) CHECK (hours IS NULL OR (hours >= 0 AND hours <= 1000)),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX volunteer_hours_document_idx ON volunteer_hours (document_id, created_at);
CREATE INDEX volunteer_hours_member_idx ON volunteer_hours (member_id);

-- Audit records intentionally have no foreign keys so they survive deletion of
-- the member, document, or entry they describe. Names are snapshotted.
CREATE TABLE audit_logs (
  id bigserial PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  last_occurred_at timestamptz NOT NULL DEFAULT now(),
  revision_count integer NOT NULL DEFAULT 1,
  actor_type text NOT NULL CHECK (actor_type IN ('member', 'admin', 'system')),
  actor_id text,
  actor_name text NOT NULL,
  member_id uuid,
  member_name text,
  department_id uuid,
  department_name text,
  action text NOT NULL,
  entity_type text NOT NULL,
  document_type text,
  document_id uuid,
  record_id text,
  summary text NOT NULL,
  previous_values jsonb,
  new_values jsonb
);
CREATE INDEX audit_logs_recent_idx ON audit_logs (last_occurred_at DESC, id DESC);
CREATE INDEX audit_logs_member_idx ON audit_logs (member_id);
CREATE INDEX audit_logs_document_idx ON audit_logs (document_id);
CREATE INDEX audit_logs_record_idx ON audit_logs (entity_type, record_id, id DESC);

-- Append-only protection. The only permitted update is extending a still-open
-- editing session (consecutive autosaves by the same actor within 10 minutes),
-- which may change new_values / last_occurred_at / revision_count only.
CREATE FUNCTION audit_logs_protect() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'audit_logs is append-only: records cannot be deleted';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.occurred_at IS DISTINCT FROM OLD.occurred_at
     OR NEW.actor_type IS DISTINCT FROM OLD.actor_type
     OR NEW.actor_id IS DISTINCT FROM OLD.actor_id
     OR NEW.actor_name IS DISTINCT FROM OLD.actor_name
     OR NEW.member_id IS DISTINCT FROM OLD.member_id
     OR NEW.member_name IS DISTINCT FROM OLD.member_name
     OR NEW.department_id IS DISTINCT FROM OLD.department_id
     OR NEW.department_name IS DISTINCT FROM OLD.department_name
     OR NEW.action IS DISTINCT FROM OLD.action
     OR NEW.entity_type IS DISTINCT FROM OLD.entity_type
     OR NEW.document_type IS DISTINCT FROM OLD.document_type
     OR NEW.document_id IS DISTINCT FROM OLD.document_id
     OR NEW.record_id IS DISTINCT FROM OLD.record_id
     OR NEW.summary IS DISTINCT FROM OLD.summary
     OR NEW.previous_values IS DISTINCT FROM OLD.previous_values THEN
    RAISE EXCEPTION 'audit_logs is append-only: recorded fields cannot be changed';
  END IF;
  IF OLD.action NOT IN ('created', 'edited') OR OLD.last_occurred_at < now() - interval '15 minutes' THEN
    RAISE EXCEPTION 'audit_logs record is sealed';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER audit_logs_protect_rows BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_protect();
CREATE TRIGGER audit_logs_protect_truncate BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_protect();

CREATE TABLE notifications (
  id bigserial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  type text NOT NULL,
  audit_log_id bigint REFERENCES audit_logs(id),
  member_id uuid,
  member_name text,
  department_name text,
  actor_type text NOT NULL,
  actor_id text,
  actor_name text NOT NULL,
  description text NOT NULL,
  link text,
  read_at timestamptz
);
CREATE INDEX notifications_recent_idx ON notifications (updated_at DESC, id DESC);
CREATE INDEX notifications_unread_idx ON notifications (id) WHERE read_at IS NULL;
CREATE INDEX notifications_audit_idx ON notifications (audit_log_id);

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,
  kind text NOT NULL CHECK (kind IN ('site', 'member', 'admin')),
  member_id uuid REFERENCES members(id) ON DELETE CASCADE,
  credential_version integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  ip_address text,
  user_agent text,
  CHECK ((kind = 'member') = (member_id IS NOT NULL))
);
CREATE INDEX sessions_member_idx ON sessions (member_id);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

CREATE TABLE login_attempts (
  id bigserial PRIMARY KEY,
  scope text NOT NULL CHECK (scope IN ('site', 'member', 'admin')),
  target text NOT NULL,
  ip_address text NOT NULL,
  succeeded boolean NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX login_attempts_key_idx ON login_attempts (scope, target, attempted_at DESC);
CREATE INDEX login_attempts_ip_idx ON login_attempts (ip_address, attempted_at DESC);

CREATE TABLE realtime_events (
  id bigserial PRIMARY KEY,
  scope text NOT NULL CHECK (scope IN ('directory', 'member', 'admin')),
  member_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX realtime_events_created_idx ON realtime_events (created_at);

-- Row Level Security: every table is deny-by-default for any role that is not
-- the table owner. The application connects as the owner from the server only;
-- on Supabase this blocks the public anon/authenticated API roles entirely.
-- The REVOKE below is limited to this application's own tables and sequences,
-- so other objects in a shared database keep their permissions.
ALTER TABLE application_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE members ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_documentation ENABLE ROW LEVEL SECURITY;
ALTER TABLE contribution_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE volunteer_hours ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE login_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE realtime_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  role_name text;
  object_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      FOREACH object_name IN ARRAY ${sqlTextArray(APP_TABLES)} LOOP
        EXECUTE format('REVOKE ALL ON TABLE %I FROM %I', object_name, role_name);
      END LOOP;
      FOREACH object_name IN ARRAY ${sqlTextArray(APP_SEQUENCES)} LOOP
        EXECUTE format('REVOKE ALL ON SEQUENCE %I FROM %I', object_name, role_name);
      END LOOP;
    END IF;
  END LOOP;
END;
$$;
`,
  },
  {
    version: 2,
    name: "revoke_api_role_privileges",
    sql: /* sql */ `
-- Supabase automatically grants new objects in the public schema to its Data
-- API roles (anon, authenticated, service_role). This application never uses
-- the Data API, so those roles need no access to its tables, sequences, or the
-- audit trigger function. Only this application's own objects are changed.
-- Where the roles do not exist (plain PostgreSQL or the embedded development
-- database) this migration changes nothing.
DO $$
DECLARE
  api_role text;
  object_name text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      FOREACH object_name IN ARRAY ${sqlTextArray(APP_TABLES)} LOOP
        EXECUTE format('REVOKE ALL ON TABLE %I FROM %I', object_name, api_role);
      END LOOP;
      FOREACH object_name IN ARRAY ${sqlTextArray(APP_SEQUENCES)} LOOP
        EXECUTE format('REVOKE ALL ON SEQUENCE %I FROM %I', object_name, api_role);
      END LOOP;
      EXECUTE format('REVOKE ALL ON FUNCTION audit_logs_protect() FROM %I', api_role);
    END IF;
  END LOOP;

  -- PostgreSQL grants EXECUTE on new functions to PUBLIC, which every role
  -- inherits. Triggers still fire for all writers without that privilege.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role')) THEN
    REVOKE ALL ON FUNCTION audit_logs_protect() FROM PUBLIC;
  END IF;
END;
$$;
`,
  },
  {
    version: 3,
    name: "cap_merged_audit_edits",
    sql: /* sql */ `
-- Merged audit edits (consecutive saves by the same actor folded into one
-- entry) get a hard limit of 30 minutes, measured from the entry's first save
-- (occurred_at, which can never change). After that the entry is sealed, and
-- the application records the next save as a new entry. Every existing rule is
-- unchanged: no deletes or truncation, recorded fields frozen, only created and
-- edited entries can be extended, and only within 15 minutes of their last
-- change. CREATE OR REPLACE keeps the function's owner, its privileges
-- (migration 2), and both triggers that use it.
CREATE OR REPLACE FUNCTION audit_logs_protect() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'audit_logs is append-only: records cannot be deleted';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.occurred_at IS DISTINCT FROM OLD.occurred_at
     OR NEW.actor_type IS DISTINCT FROM OLD.actor_type
     OR NEW.actor_id IS DISTINCT FROM OLD.actor_id
     OR NEW.actor_name IS DISTINCT FROM OLD.actor_name
     OR NEW.member_id IS DISTINCT FROM OLD.member_id
     OR NEW.member_name IS DISTINCT FROM OLD.member_name
     OR NEW.department_id IS DISTINCT FROM OLD.department_id
     OR NEW.department_name IS DISTINCT FROM OLD.department_name
     OR NEW.action IS DISTINCT FROM OLD.action
     OR NEW.entity_type IS DISTINCT FROM OLD.entity_type
     OR NEW.document_type IS DISTINCT FROM OLD.document_type
     OR NEW.document_id IS DISTINCT FROM OLD.document_id
     OR NEW.record_id IS DISTINCT FROM OLD.record_id
     OR NEW.summary IS DISTINCT FROM OLD.summary
     OR NEW.previous_values IS DISTINCT FROM OLD.previous_values THEN
    RAISE EXCEPTION 'audit_logs is append-only: recorded fields cannot be changed';
  END IF;
  IF OLD.action NOT IN ('created', 'edited') OR OLD.last_occurred_at < now() - interval '15 minutes' THEN
    RAISE EXCEPTION 'audit_logs record is sealed';
  END IF;
  IF OLD.occurred_at <= now() - interval '30 minutes' THEN
    RAISE EXCEPTION 'audit_logs record is sealed: merged edits are limited to 30 minutes from the first save';
  END IF;
  RETURN NEW;
END;
$$;
`,
  },
];

/* ------------------------------------------------------------------------- */
/* Migration runner (shared by the application and scripts/db.mjs)            */
/* ------------------------------------------------------------------------- */

/** Transaction-scoped advisory lock so parallel server instances never migrate at once. */
export const MIGRATION_LOCK_ID = 727274001;

/**
 * How long a migration waits for any lock (the advisory lock above, or a lock
 * on a table another session is using) before giving up. Set with SET LOCAL,
 * so it ends with the migration's transaction.
 */
export const MIGRATION_LOCK_TIMEOUT = "5s";
const LOCK_TIMEOUT_SQL = `SET LOCAL lock_timeout = '${MIGRATION_LOCK_TIMEOUT}'`;

export const SCHEMA_MIGRATIONS_TABLE_SQL =
  "CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, name text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())";

export interface MigrationQueryable {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
  exec(text: string): Promise<void>;
}

export interface MigrationDatabase extends MigrationQueryable {
  transaction<T>(fn: (tx: MigrationQueryable) => Promise<T>): Promise<T>;
}

export class DatabaseSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatabaseSchemaError";
  }
}

/** A migration gave up waiting for a lock; its transaction was rolled back. */
export class MigrationLockTimeoutError extends Error {
  code = "55P03";
  constructor(message: string, cause: unknown) {
    super(message, { cause });
    this.name = "MigrationLockTimeoutError";
  }
}

/** Applied migration versions, or null when no migration has ever run. Read-only. */
export async function readAppliedVersions(db: MigrationQueryable): Promise<number[] | null> {
  const [state] = await db.query<{ present: boolean }>("SELECT to_regclass('schema_migrations') IS NOT NULL AS present");
  if (!state?.present) return null;
  const rows = await db.query<{ version: number }>("SELECT version FROM schema_migrations ORDER BY version");
  return rows.map((row) => Number(row.version));
}

export function findPendingMigrations(applied: readonly number[] | null): Migration[] {
  const done = new Set(applied ?? []);
  return MIGRATIONS.filter((migration) => !done.has(migration.version));
}

/**
 * Applies every pending migration in one transaction. PostgreSQL DDL is
 * transactional, so a failure leaves the database exactly as it was.
 * Waiting for a lock is limited to MIGRATION_LOCK_TIMEOUT, so a migration fails
 * fast (MigrationLockTimeoutError) instead of queueing behind another session.
 * Returns the versions applied by this call.
 */
export async function applyMigrations(db: MigrationDatabase, options: { advisoryLock: boolean }): Promise<number[]> {
  try {
    return await db.transaction(async (tx) => {
      await tx.exec(LOCK_TIMEOUT_SQL);
      if (options.advisoryLock) await tx.query(`SELECT pg_advisory_xact_lock(${MIGRATION_LOCK_ID})`);
      await tx.exec(SCHEMA_MIGRATIONS_TABLE_SQL);
      const rows = await tx.query<{ version: number }>("SELECT version FROM schema_migrations");
      const applied = new Set(rows.map((row) => Number(row.version)));
      const appliedNow: number[] = [];
      for (const migration of MIGRATIONS) {
        if (applied.has(migration.version)) continue;
        await tx.exec(migration.sql);
        await tx.query("INSERT INTO schema_migrations (version, name) VALUES ($1, $2)", [migration.version, migration.name]);
        appliedNow.push(migration.version);
      }
      return appliedNow;
    });
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code === "55P03") {
      throw new MigrationLockTimeoutError(
        `Migration stopped: it waited more than ${MIGRATION_LOCK_TIMEOUT} for a database lock (another migration may be ` +
          "running, or another session is holding a lock on one of the tables). Nothing was changed. Run it again once that work has finished.",
        error,
      );
    }
    throw error;
  }
}

/** Used when automatic migration is off: refuse to run against an outdated schema. */
export async function assertSchemaIsCurrent(db: MigrationQueryable): Promise<void> {
  const applied = await readAppliedVersions(db);
  const pending = findPendingMigrations(applied);
  if (pending.length === 0) return;
  const state =
    applied === null
      ? "The database has no application schema yet"
      : `The database schema is out of date (pending migration${pending.length === 1 ? "" : "s"}: ${pending
          .map((migration) => migration.version)
          .join(", ")})`;
  throw new DatabaseSchemaError(
    `${state}. Run \`npm run db:migrate\` against this database first (it needs --confirm-target for a database that is not ` +
      "on this machine), or set DATABASE_AUTO_MIGRATE=true to apply migrations automatically.",
  );
}

/**
 * The complete SQL that `npm run db:migrate` executes on an empty database, as
 * one transaction. Contains no data and no secrets. Intended for review, or to
 * run manually (for example in the Supabase SQL Editor) on an empty database.
 */
export function renderMigrationScript(): string {
  const lines = [
    "-- Code Patch STEM member documentation: complete database schema.",
    "-- Generated by `npm run db:print-sql`. This is exactly what `npm run db:migrate`",
    "-- runs against an EMPTY database, in a single transaction. It contains no data",
    "-- and no secrets. For a database that already has some migrations, use",
    "-- `npm run db:migrate`, which applies only the pending ones.",
    `-- Migrations: ${MIGRATIONS.map((migration) => `${migration.version} ${migration.name}`).join(", ")}`,
    "",
    "BEGIN;",
    "",
    `${LOCK_TIMEOUT_SQL};`,
    `SELECT pg_advisory_xact_lock(${MIGRATION_LOCK_ID});`,
    `${SCHEMA_MIGRATIONS_TABLE_SQL};`,
  ];
  for (const migration of MIGRATIONS) {
    lines.push(
      "",
      `-- ---------------------------------------------------------------------------`,
      `-- Migration ${migration.version}: ${migration.name}`,
      `-- ---------------------------------------------------------------------------`,
      migration.sql.trim(),
      "",
      `INSERT INTO schema_migrations (version, name) VALUES (${migration.version}, '${migration.name.replace(/'/g, "''")}');`,
    );
  }
  lines.push("", "COMMIT;", "");
  return lines.join("\n");
}
