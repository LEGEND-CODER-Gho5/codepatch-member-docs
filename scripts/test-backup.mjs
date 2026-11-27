// Proves that a full backup can be restored: it fills a throwaway in-memory
// PostgreSQL (PGlite) with sample data of every kind, makes a backup, restores
// it into a second empty database, and compares every table. Also checks the
// refusal rules, the retention rules, and the spreadsheet (.xlsx) file format.
//   npm run test:backup
import assert from "node:assert/strict";
import { inflateRawSync } from "node:zlib";
import { PGlite } from "@electric-sql/pglite";
import {
  ALL_APP_TABLES,
  APP_SEQUENCES,
  MIGRATIONS,
  MIGRATION_LOCK_TIMEOUT,
  SCHEMA_MIGRATIONS_TABLE_SQL,
  assertSchemaIsCurrent,
} from "../src/lib/server/migrations.ts";
import {
  BACKUP_SEQUENCES,
  BACKUP_TABLES,
  TABLES_NOT_BACKED_UP,
  createBackup,
  restoreBackup,
  savedBackupName,
  selectBackupsToDelete,
  validateBackup,
} from "../src/lib/server/backup-data.ts";
import { buildWorkbook, crc32 } from "../src/lib/server/xlsx.ts";

const RESTORE_OPTIONS = {
  allAppTables: ALL_APP_TABLES,
  schemaMigrationsSql: SCHEMA_MIGRATIONS_TABLE_SQL,
  lockTimeoutSql: `SET LOCAL lock_timeout = '${MIGRATION_LOCK_TIMEOUT}'`,
};

let failures = 0;
async function check(label, run) {
  try {
    await run();
    console.log(`pass  ${label}`);
  } catch (error) {
    failures++;
    console.log(`FAIL  ${label} — ${error?.message ?? error}`);
  }
}

async function openDatabase(migrationCount = MIGRATIONS.length) {
  const client = await PGlite.create();
  const wrap = (target) => ({
    query: async (text, params = []) => (await target.query(text, params)).rows,
    exec: async (text) => {
      await target.exec(text);
    },
  });
  const db = { ...wrap(client), transaction: (fn) => client.transaction((tx) => fn(wrap(tx))), close: () => client.close() };
  if (migrationCount > 0) {
    await db.exec(SCHEMA_MIGRATIONS_TABLE_SQL);
    for (const migration of MIGRATIONS.slice(0, migrationCount)) {
      await db.exec(migration.sql);
      await db.query("INSERT INTO schema_migrations (version, name) VALUES ($1, $2)", [migration.version, migration.name]);
    }
  }
  return db;
}

const D1 = "00000000-0000-4000-8000-0000000000d1";
const D2 = "00000000-0000-4000-8000-0000000000d2";
const P1 = "00000000-0000-4000-8000-0000000000a1";
const P2 = "00000000-0000-4000-8000-0000000000a2";
const M1 = "00000000-0000-4000-8000-0000000000e1";
const M2 = "00000000-0000-4000-8000-0000000000e2";
const M3 = "00000000-0000-4000-8000-0000000000e3";
const DOC1 = "00000000-0000-4000-8000-0000000000f1";
const DOC2 = "00000000-0000-4000-8000-0000000000f2";
const DOC3 = "00000000-0000-4000-8000-0000000000f3";
const H1 = "00000000-0000-4000-8000-0000000000b1";
const MT1 = "00000000-0000-4000-8000-0000000000c1";
const MT2 = "00000000-0000-4000-8000-0000000000c2";

/** Sample data covering every backed-up table, unusual text, nulls, numerics, JSON, and a sequence ahead of its rows. */
async function seed(db, { live = true } = {}) {
  await db.exec(`
    INSERT INTO application_settings (site_password_hash, admin_password_hash, chapter_name)
      VALUES ('scrypt$16384$8$1$c2l0ZQ==$aGFzaA==', 'scrypt$16384$8$1$YWRtaW4=$aGFzaA==', 'SB Chapter');
    INSERT INTO departments (id, name, description, sort_order) VALUES
      ('${D1}', 'Coding Department', '', 1),
      ('${D2}', 'Math Department', E'Numbers\\nand "proofs" & <more>', 2);
    INSERT INTO positions (id, name, sort_order) VALUES ('${P1}', 'Member', 1), ('${P2}', 'Department Lead', 2);
    INSERT INTO members (id, full_name, department_id, position_id, email, start_date) VALUES
      ('${M1}', 'Ana "AJ" O''Neil', '${D1}', '${P1}', 'ana@example.com', '2026-09-01'),
      ('${M2}', 'Bao Nguyễn 🚀', '${D2}', '${P2}', NULL, NULL),
      ('${M3}', 'Removed Member', '${D1}', '${P1}', NULL, NULL);
    DELETE FROM members WHERE id = '${M3}';
    INSERT INTO member_departments (member_id, department_id) VALUES ('${M1}', '${D2}');
    INSERT INTO member_credentials (member_id, password_hash, password_version, last_login_at) VALUES
      ('${M1}', 'scrypt$16384$8$1$bTE=$aGFzaA==', 2, '2026-11-20 14:03:05.123456+00'),
      ('${M2}', 'scrypt$16384$8$1$bTI=$aGFzaA==', 1, NULL);
    INSERT INTO member_documentation (id, member_id, document_type, period, supervisor_name, date_submitted, last_edited_by_type) VALUES
      ('${DOC1}', '${M1}', 'member_documentation', '2026–2027 School Year', 'Ms. Smith', '2026-11-20', 'member'),
      ('${DOC2}', '${M1}', 'volunteer_hours_record', '', '', NULL, NULL),
      ('${DOC3}', '${M2}', 'volunteer_hours_record', 'Fall', '', NULL, 'admin');
    INSERT INTO contribution_entries (document_id, member_id, entry_date, title, details) VALUES
      ('${DOC1}', '${M1}', '2026-10-01', 'Tutoring', E'Line 1\\nLine 2 with =1+1 and \\t tab');
    INSERT INTO volunteer_hours (id, document_id, member_id, service_date, description, hours) VALUES
      ('${H1}', '${DOC2}', '${M1}', '2026-10-02', 'General meeting', 1.75),
      (gen_random_uuid(), '${DOC3}', '${M2}', '2026-10-03', 'Robotics event', 0.5),
      (gen_random_uuid(), '${DOC3}', '${M2}', NULL, '', NULL);
    INSERT INTO meetings (id, name, meeting_date, hours, recorded_by_name) VALUES
      ('${MT1}', 'General meeting', '2026-10-02', 1.75, 'Administrator');
    INSERT INTO meeting_attendance (meeting_id, member_id, hours, volunteer_hours_id) VALUES ('${MT1}', '${M1}', 1.75, '${H1}');
    INSERT INTO audit_logs (actor_type, actor_id, actor_name, member_id, member_name, action, entity_type, summary, previous_values, new_values) VALUES
      ('member', '${M1}', 'Ana', '${M1}', 'Ana', 'edited', 'document', 'Edited details', '{"a": {"nested": [1, 2, {"x": null}]}, "q": "\\"quoted\\""}', '{"a": 2.5}'),
      ('admin', 'admin', 'Administrator', NULL, NULL, 'deleted', 'member', 'Deleted Removed Member', '{"name": "Removed Member"}', NULL);
    INSERT INTO notifications (type, audit_log_id, actor_type, actor_name, description, read_at) VALUES
      ('documentation.edited', 1, 'member', 'Ana', 'Ana edited their Member Documentation.', NULL),
      ('member.deleted', 2, 'admin', 'Administrator', 'Removed Member was deleted.', '2026-11-21 10:00:00+00');
    SELECT nextval('audit_logs_id_seq');
    INSERT INTO sessions (token_hash, kind, credential_version, expires_at) VALUES ('not-backed-up', 'site', 1, now() + interval '1 hour');
    INSERT INTO login_attempts (scope, target, ip_address, succeeded) VALUES ('site', 'site', '127.0.0.1', false);
  `);
  if (live) {
    await db.exec(`
      INSERT INTO meetings (id, name, meeting_date, recorded_by_name, status, started_at) VALUES
        ('${MT2}', 'Live meeting', '2026-11-27', 'Administrator', 'in_progress', '2026-11-27 23:00:00+00');
      INSERT INTO meeting_attendance (meeting_id, member_id, checked_in_at) VALUES ('${MT2}', '${M2}', '2026-11-27 23:05:00+00');
    `);
  }
}

async function snapshot(db) {
  const tables = {};
  for (const table of BACKUP_TABLES) {
    const [row] = await db.query(`SELECT coalesce(json_agg(t), '[]'::json)::text AS rows FROM ${table} t`);
    const rows = JSON.parse(row.rows);
    rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    tables[table] = rows;
  }
  const sequences = {};
  for (const sequence of BACKUP_SEQUENCES) {
    const [state] = await db.query(`SELECT last_value::text, is_called FROM ${sequence}`);
    sequences[sequence] = state;
  }
  return { tables, sequences };
}

/* ------------------------------- Round trip -------------------------------- */

const source = await openDatabase();
await seed(source);
const backup = await createBackup(source, "test");
// Exactly as it is stored: text, read back later.
const stored = JSON.parse(JSON.stringify(backup));

await check("Every application table is either backed up or deliberately left out", () => {
  assert.deepEqual([...BACKUP_TABLES, ...TABLES_NOT_BACKED_UP].sort(), [...ALL_APP_TABLES].sort());
  assert.deepEqual([...BACKUP_SEQUENCES].sort(), [...APP_SEQUENCES].sort());
});

await check("The backup records the schema version and every row", () => {
  assert.equal(backup.schemaVersion, MIGRATIONS.at(-1).version);
  assert.deepEqual(backup.migrations, MIGRATIONS.map((m) => m.version));
  assert.equal(backup.counts.members, 2);
  assert.equal(backup.counts.volunteer_hours, 3);
  assert.equal(backup.counts.audit_logs, 2);
  assert.equal(backup.tables.sessions, undefined, "sessions are not backed up");
  assert.equal(backup.tables.login_attempts, undefined, "the sign-in ledger is not backed up");
});

await check("Password hashes are in the backup, so restored members keep their passwords", () => {
  assert.ok(backup.tables.member_credentials.every((row) => String(row.password_hash).startsWith("scrypt$")));
  assert.ok(String(backup.tables.application_settings[0].admin_password_hash).startsWith("scrypt$"));
});

const target = await openDatabase(0);
const summary = await restoreBackup(target, stored, MIGRATIONS, RESTORE_OPTIONS);

await check("Restoring into an empty database recreates every table and row exactly", async () => {
  const before = await snapshot(source);
  const after = await snapshot(target);
  for (const table of BACKUP_TABLES) assert.deepEqual(after.tables[table], before.tables[table], `${table} differs`);
  assert.deepEqual(summary.counts, backup.counts);
});

await check("Sequence positions are restored (no member ID or history ID is reused)", async () => {
  assert.deepEqual((await snapshot(target)).sequences, (await snapshot(source)).sequences);
  const [next] = await target.query("SELECT nextval('member_number_seq')::int AS n");
  assert.equal(next.n, 1004, "CPS-1003 belonged to a deleted member, so the next member is CPS-1004");
});

await check("The restored database has the current schema and works", async () => {
  await assertSchemaIsCurrent(target);
  await target.query(
    "INSERT INTO members (full_name, department_id, position_id) VALUES ('New Member', $1, $2)",
    [D1, P1],
  );
});

await check("The edit history is still append-only after a restore", async () => {
  await assert.rejects(() => target.query("DELETE FROM audit_logs WHERE id = 1"), /append-only/);
});

await check("Sessions are not restored: everyone signs in again", async () => {
  const [row] = await target.query("SELECT count(*)::int AS n FROM sessions");
  assert.equal(row.n, 0);
});

/* ------------------------------ Refusals ----------------------------------- */

await check("A restore refuses a database that already has the portal's tables, and changes nothing", async () => {
  const before = await snapshot(target);
  await assert.rejects(() => restoreBackup(target, stored, MIGRATIONS, RESTORE_OPTIONS), /not empty/);
  assert.deepEqual(await snapshot(target), before);
});

await check("A backup from a newer version of the portal is refused", async () => {
  const newer = structuredClone(stored);
  newer.schemaVersion = 999;
  newer.migrations = [...newer.migrations, 999];
  assert.throws(() => validateBackup(newer, MIGRATIONS), /newer version/);
});

await check("A damaged backup is refused (missing rows, unknown table, wrong file)", async () => {
  const missing = structuredClone(stored);
  missing.tables.members.pop();
  assert.throws(() => validateBackup(missing, MIGRATIONS), /members table has 1 rows but should have 2/);
  const extra = structuredClone(stored);
  extra.tables.sessions = [];
  assert.throws(() => validateBackup(extra, MIGRATIONS), /unexpected tables/);
  assert.throws(() => validateBackup({ hello: "world" }, MIGRATIONS), /not made by this portal/);
  assert.throws(() => validateBackup("[]", MIGRATIONS), /not a JSON object/);
});

await check("A column name smuggled into a backup is rejected before any SQL uses it, and nothing is created", async () => {
  const empty = await openDatabase(0);
  const tampered = structuredClone(stored);
  tampered.tables.departments[0]['name") VALUES (1); DROP TABLE members; --'] = "x";
  await assert.rejects(() => restoreBackup(empty, tampered, MIGRATIONS, RESTORE_OPTIONS), /columns this schema does not have/);
  const [row] = await empty.query("SELECT count(*)::int AS n FROM pg_class WHERE relname = 'members'");
  assert.equal(row.n, 0, "the failed restore was rolled back completely");
  await empty.close();
});

/* ------------------------- Backups from older versions --------------------- */

await check("A backup made before the latest migration restores and is then upgraded", async () => {
  const older = await openDatabase(7);
  await seed(older);
  const oldBackup = JSON.parse(JSON.stringify(await createBackup(older, "test")));
  assert.equal(oldBackup.schemaVersion, 7);
  const fresh = await openDatabase(0);
  const result = await restoreBackup(fresh, oldBackup, MIGRATIONS, RESTORE_OPTIONS);
  assert.deepEqual(result.appliedAfter, MIGRATIONS.filter((m) => m.version > 7).map((m) => m.version));
  await assertSchemaIsCurrent(fresh);
  assert.deepEqual((await snapshot(fresh)).tables, (await snapshot(older)).tables);
  await older.close();
  await fresh.close();
});

await check("A database from before meetings existed (migration 5) backs up and restores", async () => {
  const old = await openDatabase(5);
  await old.exec(`
    INSERT INTO application_settings (site_password_hash, admin_password_hash) VALUES ('scrypt$a', 'scrypt$b');
    INSERT INTO departments (id, name) VALUES ('${D1}', 'Coding Department');
    INSERT INTO positions (id, name) VALUES ('${P1}', 'Member');
    INSERT INTO members (id, full_name, department_id, position_id) VALUES ('${M1}', 'Ana', '${D1}', '${P1}');
  `);
  const oldBackup = JSON.parse(JSON.stringify(await createBackup(old, "test")));
  assert.equal(oldBackup.schemaVersion, 5);
  assert.deepEqual(oldBackup.tables.meetings, []);
  const fresh = await openDatabase(0);
  await restoreBackup(fresh, oldBackup, MIGRATIONS, RESTORE_OPTIONS);
  await assertSchemaIsCurrent(fresh);
  const [row] = await fresh.query("SELECT full_name FROM members");
  assert.equal(row.full_name, "Ana");
  await old.close();
  await fresh.close();
});

/* -------------------------------- Retention -------------------------------- */

await check("Retention keeps 30 days of backups plus the oldest of each of the last 12 months", () => {
  const now = new Date("2026-11-27T08:00:00Z");
  const name = (iso, kind = "scheduled") => savedBackupName(new Date(iso), kind);
  const files = [
    name("2026-11-26T08:01:00Z"),
    name("2026-11-26T15:30:00Z", "manual"),
    name("2026-11-01T08:00:00Z"),
    name("2026-10-28T08:00:00Z"), // 30 days old: kept
    name("2026-10-20T08:00:00Z"), // 38 days old, not the oldest of October: deleted
    name("2026-10-01T08:00:00Z"), // oldest of October: kept
    name("2025-12-05T08:00:00Z"), // oldest of December 2025 (12th month back): kept
    name("2025-12-20T08:00:00Z"), // deleted
    name("2025-11-03T08:00:00Z"), // 13 months back: deleted
    "backups/notes.txt", // not a backup name: never touched
  ];
  assert.equal(files[0], "backups/20261126T080100Z-scheduled.json");
  assert.deepEqual(selectBackupsToDelete(files, now).sort(), [files[4], files[7], files[8]].sort());
  assert.deepEqual(selectBackupsToDelete([], now), []);
});

/* ------------------------------ Spreadsheet -------------------------------- */

function unzip(buffer) {
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(end >= 0, "end-of-archive record present");
  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16);
  const files = new Map();
  for (let i = 0; i < count; i++) {
    assert.equal(buffer.readUInt32LE(offset), 0x02014b50, "central directory entry");
    const crc = buffer.readUInt32LE(offset + 16);
    const size = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const local = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    assert.equal(buffer.readUInt32LE(local), 0x04034b50, `local header for ${name}`);
    const dataStart = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const data = inflateRawSync(buffer.subarray(dataStart, dataStart + size));
    assert.equal(crc32(data), crc, `checksum of ${name}`);
    files.set(name, data.toString("utf8"));
    offset += 46 + nameLength;
  }
  return files;
}

await check("The spreadsheet is a valid .xlsx package with escaped text, numbers, and dates", () => {
  const workbook = buildWorkbook(
    [
      {
        name: "Members",
        columns: [{ header: "Name", width: 30 }, { header: "Hours" }, { header: "Start date" }, { header: "Last sign-in" }],
        rows: [
          ['Ana "AJ" <O\'Neil> & co', 1.75, { date: "2026-01-01" }, { time: "2026-07-01T16:30:00Z" }],
          ["=HYPERLINK(\"x\")", null, { date: null }, { time: null }],
          ["Bao Nguyễn 🚀\u0007", 0, { date: "not a date" }, { time: "2026-01-15T05:00:00Z" }],
        ],
      },
      { name: "Hours: [all]/2026?", columns: [{ header: "A" }], rows: [] },
    ],
    { now: new Date("2026-11-27T08:00:00Z") },
  );
  const files = unzip(workbook);
  for (const part of ["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml"]) {
    assert.ok(files.has(part), `${part} present`);
  }
  const sheet = files.get("xl/worksheets/sheet1.xml");
  assert.ok(sheet.includes("Ana &quot;AJ&quot; &lt;O'Neil&gt; &amp; co"), "text is escaped");
  assert.ok(sheet.includes('<c r="A3" t="inlineStr"><is><t xml:space="preserve">=HYPERLINK(&quot;x&quot;)</t></is></c>'), "formula-like text stays text");
  assert.ok(!sheet.includes("<f>"), "no formulas are written");
  assert.ok(!sheet.includes("\u0007"), "control characters are removed");
  assert.ok(sheet.includes('<c r="C2" s="2"><v>46023</v></c>'), "2026-01-01 is Excel date 46023");
  assert.ok(sheet.includes('<c r="D2" s="3"><v>46204.5208'), "July 1, 2026 4:30 PM UTC is 12:30 PM in New York (daylight time)");
  assert.ok(sheet.includes('<c r="D4" s="3"><v>46037</v></c>'), "Jan 15, 2026 5:00 AM UTC is midnight in New York (standard time)");
  assert.ok(sheet.includes('<c r="C4" t="inlineStr"><is><t xml:space="preserve">not a date</t>'), "an unreadable date is kept as text");
  assert.ok(sheet.includes('<autoFilter ref="A1:D4"/>'), "header filters cover the data");
  const book = files.get("xl/workbook.xml");
  assert.ok(book.includes('<sheet name="Hours   all  2026" sheetId="2"'), "sheet names drop characters Excel does not allow");
});

await source.close();
await target.close();
console.log(failures === 0 ? "\nAll backup checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
