// Tests for the migration runner and migrations 2-4, using throwaway in-memory
// PostgreSQL databases (PGlite). One database simulates Supabase: it has the
// anon / authenticated / service_role roles, Supabase-style default privileges,
// and a table belonging to another application.
//
//   npm run test:migrations
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import {
  ALL_APP_TABLES,
  APP_SEQUENCES,
  LATER_APP_TABLES,
  MIGRATIONS,
  MIGRATION_LOCK_ID,
  MIGRATION_LOCK_TIMEOUT,
  MigrationLockTimeoutError,
  applyMigrations,
  assertSchemaIsCurrent,
  readAppliedVersions,
  renderMigrationScript,
} from "../src/lib/server/migrations.ts";

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`pass  ${name}`);
  } catch (error) {
    failed++;
    console.log(`FAIL  ${name}\n      ${error?.message ?? error}`);
  }
}

function adapter(client) {
  const wrap = (target) => ({
    query: async (text, params = []) => (await target.query(text, params)).rows,
    exec: async (text) => {
      await target.exec(text);
    },
  });
  return { ...wrap(client), transaction: (fn) => client.transaction((tx) => fn(wrap(tx))) };
}

async function withDatabase(fn) {
  const client = await PGlite.create();
  try {
    await fn(client, adapter(client));
  } finally {
    await client.close();
  }
}

async function value(client, sql, params = []) {
  const { rows } = await client.query(sql, params);
  return Object.values(rows[0])[0];
}

const allVersions = MIGRATIONS.map((migration) => migration.version);
const API_ROLES = ["anon", "authenticated", "service_role"];

await test("an empty database reports no schema and is refused when automatic migration is off", () =>
  withDatabase(async (client, db) => {
    assert.equal(await readAppliedVersions(db), null);
    await assert.rejects(assertSchemaIsCurrent(db), /no application schema yet.*npm run db:migrate/s);
  }));

await test("migrations apply once, in order, and a second run is a no-op", () =>
  withDatabase(async (client, db) => {
    assert.deepEqual(await applyMigrations(db, { advisoryLock: true }), allVersions);
    assert.deepEqual(await applyMigrations(db, { advisoryLock: true }), []);
    assert.deepEqual(await readAppliedVersions(db), allVersions);
    await assertSchemaIsCurrent(db);
    for (const name of [...ALL_APP_TABLES, ...APP_SEQUENCES]) {
      assert.equal(await value(client, "SELECT to_regclass($1) IS NOT NULL", [name]), true, `${name} is missing`);
    }
  }));

/** Creates a database that has only the first `count` migrations, as an older version of the app left it. */
async function migrateTo(client, count) {
  await client.exec(
    "CREATE TABLE schema_migrations (version integer PRIMARY KEY, name text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())",
  );
  for (const migration of MIGRATIONS.slice(0, count)) {
    await client.exec(migration.sql);
    await client.query("INSERT INTO schema_migrations (version, name) VALUES ($1, $2)", [migration.version, migration.name]);
  }
}

await test("a database at migration 1 is reported as pending migrations 2, 3 and 4, then upgraded", () =>
  withDatabase(async (client, db) => {
    await migrateTo(client, 1);
    await assert.rejects(assertSchemaIsCurrent(db), /pending migrations: 2, 3, 4.*npm run db:migrate/s);
    assert.deepEqual(await applyMigrations(db, { advisoryLock: false }), [2, 3, 4]);
    await assertSchemaIsCurrent(db);
  }));

await test("a database at migration 2 (an existing development database) gets migration 3, which caps merged audit edits", () =>
  withDatabase(async (client, db) => {
    await migrateTo(client, 2);
    await assert.rejects(assertSchemaIsCurrent(db), /pending migrations: 3, 4/);
    const insert = () =>
      client.query(
        `INSERT INTO audit_logs (actor_type, actor_id, actor_name, action, entity_type, record_id, summary, new_values, occurred_at, last_occurred_at)
         VALUES ('member', 'm1', 'Member A', 'edited', 'document', 'doc-1', 'test', '{"a":1}', now() - interval '31 minutes', now() - interval '1 minute')
         RETURNING id`,
      );
    const before = (await insert()).rows[0].id;
    // Migration 1's trigger looks only at the last change, so this merge is still allowed.
    await client.query("UPDATE audit_logs SET new_values = '{\"a\":2}' WHERE id = $1", [before]);

    assert.deepEqual(await applyMigrations(db, { advisoryLock: false }), [3, 4]);
    await assertSchemaIsCurrent(db);
    const after = (await insert()).rows[0].id;
    await assert.rejects(client.query("UPDATE audit_logs SET new_values = '{\"a\":2}' WHERE id = $1", [after]), /limited to 30 minutes/);
    // The replaced function is still the one both triggers use.
    const { rows } = await client.query(
      "SELECT tgname FROM pg_trigger WHERE tgrelid = 'audit_logs'::regclass AND tgfoid = 'audit_logs_protect()'::regprocedure ORDER BY tgname",
    );
    assert.deepEqual(rows.map((row) => row.tgname), ["audit_logs_protect_rows", "audit_logs_protect_truncate"]);
  }));

await test("a database at migration 3 (with members) gets migration 4: other departments start empty and keep integrity", () =>
  withDatabase(async (client, db) => {
    await migrateTo(client, 3);
    await assert.rejects(assertSchemaIsCurrent(db), /pending migration: 4/);
    const [coding, math, art] = (
      await client.query("INSERT INTO departments (name) VALUES ('Coding'), ('Math'), ('Art') RETURNING id")
    ).rows.map((row) => row.id);
    const position = (await client.query("INSERT INTO positions (name) VALUES ('Member') RETURNING id")).rows[0].id;
    const member = (
      await client.query("INSERT INTO members (full_name, department_id, position_id) VALUES ('Ada', $1, $2) RETURNING id", [coding, position])
    ).rows[0].id;

    assert.deepEqual(await applyMigrations(db, { advisoryLock: false }), [4]);
    await assertSchemaIsCurrent(db);
    assert.equal(await value(client, "SELECT count(*)::int FROM members"), 1, "existing members are kept");
    assert.equal(await value(client, "SELECT department_id FROM members WHERE id = $1", [member]), coding, "main department unchanged");
    assert.equal(await value(client, "SELECT count(*)::int FROM member_departments"), 0, "nobody starts with other departments");

    await client.query("INSERT INTO member_departments (member_id, department_id) VALUES ($1, $2), ($1, $3)", [member, math, art]);
    await assert.rejects(
      client.query("INSERT INTO member_departments (member_id, department_id) VALUES ($1, $2)", [member, math]),
      /duplicate key/,
      "the same other department cannot be listed twice",
    );
    await assert.rejects(client.query("DELETE FROM departments WHERE id = $1", [math]), /foreign key/, "a listed department cannot be deleted");
    await client.query("DELETE FROM members WHERE id = $1", [member]);
    assert.equal(await value(client, "SELECT count(*)::int FROM member_departments"), 0, "deleting a member removes their rows");
    await client.query("DELETE FROM departments WHERE id = $1", [math]);
  }));

await test(`migrations set a ${MIGRATION_LOCK_TIMEOUT} lock timeout first, and stop cleanly when a lock is not granted in time`, async () => {
  // A stand-in database whose advisory lock is held elsewhere: PostgreSQL then
  // cancels the wait with SQLSTATE 55P03 once lock_timeout expires.
  const statements = [];
  const lockTimeout = Object.assign(new Error("canceling statement due to lock timeout"), { code: "55P03" });
  const queryable = {
    async query(text) {
      statements.push(text);
      if (text.includes("pg_advisory_xact_lock")) throw lockTimeout;
      return [];
    },
    async exec(text) {
      statements.push(text);
    },
  };
  const db = {
    ...queryable,
    async transaction(fn) {
      statements.push("BEGIN");
      try {
        const result = await fn(queryable);
        statements.push("COMMIT");
        return result;
      } catch (error) {
        statements.push("ROLLBACK");
        throw error;
      }
    },
  };
  await assert.rejects(applyMigrations(db, { advisoryLock: true }), (error) => {
    assert.ok(error instanceof MigrationLockTimeoutError, `expected MigrationLockTimeoutError, got ${error?.name}`);
    assert.match(error.message, /waited more than 5s for a database lock.*Nothing was changed/s);
    assert.equal(error.cause, lockTimeout);
    return true;
  });
  assert.deepEqual(statements, [
    "BEGIN",
    `SET LOCAL lock_timeout = '${MIGRATION_LOCK_TIMEOUT}'`,
    `SELECT pg_advisory_xact_lock(${MIGRATION_LOCK_ID})`,
    "ROLLBACK",
  ]);
});

await test("the lock timeout applies inside the migration transaction only", () =>
  withDatabase(async (client, db) => {
    const probe = { version: 9999, name: "test_probe", sql: "CREATE TABLE lock_probe AS SELECT current_setting('lock_timeout') AS value;" };
    MIGRATIONS.push(probe);
    try {
      await applyMigrations(db, { advisoryLock: true });
    } finally {
      MIGRATIONS.pop();
    }
    assert.equal(await value(client, "SELECT value FROM lock_probe"), MIGRATION_LOCK_TIMEOUT);
    assert.equal(await value(client, "SELECT current_setting('lock_timeout')"), "0", "the setting leaked out of the transaction");
  }));

await test("a failing migration leaves the database exactly as it was", () =>
  withDatabase(async (client, db) => {
    await client.exec("CREATE TABLE members (id integer)"); // name collision with the app's members table
    await assert.rejects(applyMigrations(db, { advisoryLock: true }));
    assert.equal(await readAppliedVersions(db), null, "schema_migrations should not exist");
    assert.equal(await value(client, "SELECT to_regclass('application_settings') IS NOT NULL"), false);
    assert.equal(await value(client, "SELECT count(*)::int FROM members"), 0, "the existing table is untouched");
  }));

await test("without Supabase roles, migration 2 changes nothing (embedded/development databases)", () =>
  withDatabase(async (client, db) => {
    await applyMigrations(db, { advisoryLock: false });
    assert.equal(await value(client, "SELECT has_function_privilege('public', 'audit_logs_protect()', 'EXECUTE')"), true);
  }));

await test("Supabase simulation: API roles lose all access to the app's objects only", () =>
  withDatabase(async (client, db) => {
    // Recreate Supabase's setup: Data API roles, default privileges for new
    // objects, and another application's table that must keep its grants.
    await client.exec(`
      CREATE ROLE anon NOLOGIN;
      CREATE ROLE authenticated NOLOGIN;
      CREATE ROLE service_role NOLOGIN BYPASSRLS;
      GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
      CREATE TABLE other_app_items (id serial PRIMARY KEY, title text);
    `);
    assert.equal(await value(client, "SELECT has_table_privilege('anon', 'other_app_items', 'SELECT')"), true);

    await applyMigrations(db, { advisoryLock: true });
    assert.deepEqual(await readAppliedVersions(db), allVersions, "includes migration 3, which replaces the audit function");
    assert.ok(LATER_APP_TABLES.length > 0 && LATER_APP_TABLES.every((table) => ALL_APP_TABLES.includes(table)));

    for (const role of API_ROLES) {
      for (const table of ALL_APP_TABLES) {
        assert.equal(
          await value(client, "SELECT has_table_privilege($1, $2, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')", [role, table]),
          false,
          `${role} still has access to ${table}`,
        );
      }
      for (const sequence of APP_SEQUENCES) {
        assert.equal(
          await value(client, "SELECT has_sequence_privilege($1, $2, 'USAGE,SELECT,UPDATE')", [role, sequence]),
          false,
          `${role} still has access to ${sequence}`,
        );
      }
      assert.equal(
        await value(client, "SELECT has_function_privilege($1, 'audit_logs_protect()', 'EXECUTE')", [role]),
        false,
        `${role} can still execute audit_logs_protect()`,
      );
    }
    assert.equal(await value(client, "SELECT has_function_privilege('public', 'audit_logs_protect()', 'EXECUTE')"), false);

    // Another application's objects keep their permissions.
    assert.equal(await value(client, "SELECT has_table_privilege('anon', 'other_app_items', 'SELECT')"), true);
    assert.equal(await value(client, "SELECT has_sequence_privilege('anon', 'other_app_items_id_seq', 'USAGE')"), true);

    // Row Level Security stays enabled on every application table.
    const { rows } = await client.query("SELECT relname FROM pg_class WHERE relname = ANY($1) AND NOT relrowsecurity", [[...ALL_APP_TABLES]]);
    assert.deepEqual(rows, [], "tables without RLS");
  }));

await test("Supabase simulation: the append-only audit trigger still applies to other writers", () =>
  withDatabase(async (client, db) => {
    await client.exec("CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;");
    await applyMigrations(db, { advisoryLock: true });
    await client.exec(`
      INSERT INTO audit_logs (actor_type, actor_name, action, entity_type, summary) VALUES ('system', 'Test', 'deleted', 'document', 'test');
      CREATE ROLE writer_test NOLOGIN BYPASSRLS;
      GRANT SELECT, UPDATE, DELETE ON audit_logs TO writer_test;
    `);
    await client.exec("SET ROLE writer_test");
    try {
      await assert.rejects(client.exec("UPDATE audit_logs SET summary = 'changed'"), /append-only|sealed/);
      await assert.rejects(client.exec("DELETE FROM audit_logs"), /append-only/);
    } finally {
      await client.exec("RESET ROLE");
    }
    assert.equal(await value(client, "SELECT summary FROM audit_logs"), "test");
  }));

await test("the db:print-sql script builds the same schema on an empty database", () =>
  withDatabase(async (client, db) => {
    const script = renderMigrationScript();
    assert.ok(script.trimStart().startsWith("--") && script.includes("BEGIN;") && script.trimEnd().endsWith("COMMIT;"));
    await client.exec(script);
    assert.deepEqual(await readAppliedVersions(db), allVersions);
    assert.deepEqual(await applyMigrations(db, { advisoryLock: true }), [], "nothing should be pending afterwards");
  }));

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
