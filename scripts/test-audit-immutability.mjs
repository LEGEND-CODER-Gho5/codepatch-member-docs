// Verifies the database-level guarantees on audit_logs using a throwaway
// in-memory PostgreSQL (PGlite) with the real migrations applied, and the
// application's own merge logic (recordAudit in src/lib/server/audit.ts)
// against the same database.
//   npm run test:audit
import fs from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { MIGRATIONS } from "../src/lib/server/migrations.ts";

// Lets this test import the application's server modules directly: it stubs
// the "server-only" marker and resolves the extensionless relative imports
// that Next.js allows (./realtime → ./realtime.ts).
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: "data:text/javascript,export {};", shortCircuit: true };
    if (/^\.\.?\//.test(specifier) && !path.extname(specifier) && context.parentURL?.endsWith(".ts")) {
      const candidate = new URL(`${specifier}.ts`, context.parentURL);
      if (fs.existsSync(fileURLToPath(candidate))) return { url: candidate.href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
const { recordAudit } = await import("../src/lib/server/audit.ts");

const db = await PGlite.create();
await db.exec(
  "CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, name text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())",
);
for (const migration of MIGRATIONS) await db.exec(migration.sql);

let failures = 0;
let inserted = 0;
async function expectError(label, run, pattern) {
  try {
    await run();
    console.log(`FAIL  ${label} — statement succeeded but should have been rejected`);
    failures++;
  } catch (error) {
    if (pattern && !pattern.test(error.message)) {
      console.log(`FAIL  ${label} — rejected for the wrong reason (${error.message})`);
      failures++;
      return;
    }
    console.log(`pass  ${label} — rejected (${error.message})`);
  }
}
async function expectOk(label, run) {
  try {
    await run();
    console.log(`pass  ${label}`);
  } catch (error) {
    console.log(`FAIL  ${label} — ${error.message}`);
    failures++;
  }
}
function check(label, ok, detail = "") {
  console.log(`${ok ? "pass" : "FAIL"}  ${label}${!ok && detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}
/** Runs one application case in its own transaction; an error (such as the trigger refusing a merge) is a failure. */
async function appCase(fn) {
  try {
    await db.transaction(fn);
  } catch (error) {
    console.log(`FAIL  App: a save failed — ${error.message}`);
    failures++;
  }
}

/** Inserts an entry; times are SQL expressions such as "now() - interval '20 minutes'". */
const insert = async (action, { lastOccurred = "now()", occurred = "now()", record = "doc-1", q = db } = {}) => {
  inserted++;
  const { rows } = await q.query(
    `INSERT INTO audit_logs (actor_type, actor_id, actor_name, action, entity_type, record_id, summary, previous_values, new_values, occurred_at, last_occurred_at)
     VALUES ('member', 'm1', 'Member A', $1, 'document', $2, 'test', '{"a":1}', '{"a":2}', ${occurred}, ${lastOccurred}) RETURNING id`,
    [action, record],
  );
  return rows[0].id;
};

/* ------------------------------ Trigger (database) ------------------------------ */

const sealed = await insert("deleted");
await expectError("DELETE an audit record", () => db.query("DELETE FROM audit_logs WHERE id = $1", [sealed]));
await expectError("TRUNCATE audit_logs", () => db.exec("TRUNCATE audit_logs CASCADE"));
await expectError("UPDATE a deleted-action record", () => db.query("UPDATE audit_logs SET new_values = '{}' WHERE id = $1", [sealed]));

const open = await insert("edited");
await expectError("Change the actor of an open record", () => db.query("UPDATE audit_logs SET actor_name = 'Someone else' WHERE id = $1", [open]));
await expectError("Change the previous version of an open record", () =>
  db.query("UPDATE audit_logs SET previous_values = '{}' WHERE id = $1", [open]),
);
await expectError("Change the timestamp of an open record", () =>
  db.query("UPDATE audit_logs SET occurred_at = now() - interval '1 day' WHERE id = $1", [open]),
);
await expectOk("Extend an open editing session (new_values only)", () =>
  db.query("UPDATE audit_logs SET new_values = '{\"a\":3}', last_occurred_at = now(), revision_count = 2 WHERE id = $1", [open]),
);

const old = await insert("edited", { lastOccurred: "now() - interval '20 minutes'", occurred: "now() - interval '20 minutes'" });
await expectError("Modify an editing session after it has sealed (15 minutes since its last change)", () =>
  db.query("UPDATE audit_logs SET new_values = '{}' WHERE id = $1", [old]),
);

const capped = await insert("edited", { occurred: "now() - interval '31 minutes'", lastOccurred: "now() - interval '1 minute'" });
await expectError(
  "Extend a merged entry whose first save was 31 minutes ago, though its last change was 1 minute ago",
  () => db.query("UPDATE audit_logs SET new_values = '{\"a\":4}', last_occurred_at = now(), revision_count = 2 WHERE id = $1", [capped]),
  /limited to 30 minutes/,
);
const young = await insert("edited", { occurred: "now() - interval '29 minutes'", lastOccurred: "now() - interval '1 minute'" });
await expectOk("Extend a merged entry whose first save was 29 minutes ago", () =>
  db.query("UPDATE audit_logs SET new_values = '{\"a\":4}', last_occurred_at = now(), revision_count = 2 WHERE id = $1", [young]),
);
// now() is fixed within a transaction, so this checks the exact 30-minute boundary.
await expectError(
  "Extend a merged entry exactly 30 minutes after its first save",
  () =>
    db.transaction(async (tx) => {
      const id = await insert("edited", { occurred: "now() - interval '30 minutes'", lastOccurred: "now() - interval '1 minute'", q: tx });
      await tx.query("UPDATE audit_logs SET new_values = '{\"a\":4}' WHERE id = $1", [id]);
    }),
  /limited to 30 minutes/,
);
inserted--; // that insert was rolled back with its transaction

/* --------------------------- Merge logic (application) -------------------------- */

const adapter = (target) => ({
  query: async (text, params = []) => (await target.query(text, params)).rows,
  exec: async (text) => {
    await target.exec(text);
  },
});
const member = { type: "member", id: "m1", name: "Member A" };
const save = (tx, record, next, actor = member) =>
  recordAudit(adapter(tx), {
    actor,
    action: "edited",
    entityType: "document",
    recordId: record,
    summary: "Saved the document",
    previous: { a: 1 },
    next,
    coalesce: true,
  });
const entriesFor = async (record) =>
  (await db.query("SELECT id, revision_count, new_values FROM audit_logs WHERE record_id = $1 ORDER BY id", [record])).rows;

await appCase(async (tx) => {
  const first = await save(tx, "doc-app-1", { a: 2 });
  const second = await save(tx, "doc-app-1", { a: 3 });
  check("App: consecutive saves by the same member merge into one entry", first === second);
});
inserted++;
const merged = await entriesFor("doc-app-1");
check(
  "App: the merged entry holds the latest values and counts both saves",
  merged.length === 1 && merged[0].revision_count === 2 && merged[0].new_values.a === 3,
  JSON.stringify(merged),
);

const longSession = await insert("edited", {
  record: "doc-app-2",
  occurred: "now() - interval '31 minutes'",
  lastOccurred: "now() - interval '1 minute'",
});
await appCase(async (tx) => {
  const id = await save(tx, "doc-app-2", { a: 5 });
  check("App: a save more than 30 minutes after the entry's first save starts a new entry", id !== longSession);
});
inserted++;
const afterCap = await entriesFor("doc-app-2");
check(
  "App: the capped entry is left exactly as it was",
  afterCap.length === 2 && afterCap[0].revision_count === 1 && afterCap[0].new_values.a === 2 && afterCap[1].new_values.a === 5,
  JSON.stringify(afterCap),
);

const withinCap = await insert("edited", {
  record: "doc-app-3",
  occurred: "now() - interval '29 minutes'",
  lastOccurred: "now() - interval '2 minutes'",
});
await appCase(async (tx) => {
  const id = await save(tx, "doc-app-3", { a: 6 });
  check("App: a save 29 minutes after the first save still merges", id === withinCap);
});

await appCase(async (tx) => {
  const boundary = await insert("edited", {
    record: "doc-app-4",
    occurred: "now() - interval '30 minutes'",
    lastOccurred: "now() - interval '1 minute'",
    q: tx,
  });
  const id = await save(tx, "doc-app-4", { a: 7 });
  check("App: exactly 30 minutes after the first save, a save starts a new entry (the trigger agrees)", id !== boundary);
});
inserted++;

const idle = await insert("edited", {
  record: "doc-app-5",
  occurred: "now() - interval '12 minutes'",
  lastOccurred: "now() - interval '11 minutes'",
});
await appCase(async (tx) => {
  const id = await save(tx, "doc-app-5", { a: 8 });
  check("App: the 10-minute idle rule is unchanged (11 minutes since the last save starts a new entry)", id !== idle);
});
inserted++;

const otherActor = await insert("edited", { record: "doc-app-6" });
await appCase(async (tx) => {
  const id = await save(tx, "doc-app-6", { a: 9 }, { type: "admin", id: null, name: "Administrator" });
  check("App: a save by a different actor never merges into another actor's entry", id !== otherActor);
});
inserted++;

const count = (await db.query("SELECT count(*)::int AS n FROM audit_logs")).rows[0].n;
check(`All ${inserted} audit records are still present`, count === inserted, `found ${count}`);

await db.close();
console.log(failures === 0 ? "\nAll audit immutability checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
