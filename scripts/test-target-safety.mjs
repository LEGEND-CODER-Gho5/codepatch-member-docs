// Tests for the database target-safety checks. No real database is used.
//   F1  with --env-file, a DATABASE_* setting also set in the shell stops the command
//   F2  the Target line names the Supabase project, and db:migrate and
//       credentials:reset need --confirm-target for any database that is not on
//       this machine
//   F3  `npm run dev` applies migrations automatically only to the embedded database
//
// Command-line runs happen in child processes with a network guard preloaded
// (scripts/lib/test-network-guard.mjs). It blocks every outgoing connection and
// reports the attempt, so each test shows whether a command stopped before
// connecting, and nothing can reach a real server even if a check were broken.
// The `next dev` tests point DATABASE_URL at a fake PostgreSQL server inside this
// process: it answers the schema check, records every statement it receives,
// and runs none of them.
//
//   npm run test:target-safety
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveDatabaseConfig } from "../src/lib/server/db-config.ts";
import { TargetSafetyError, checkTargetConfirmation, loadEnvironment } from "./lib/cli.mjs";

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`pass  ${name}`);
  } catch (error) {
    failed++;
    console.log(`FAIL  ${name}\n      ${String(error?.message ?? error).split("\n").join("\n      ")}`);
  }
}

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const guard = pathToFileURL(path.join(project, "scripts", "lib", "test-network-guard.mjs")).href;
const GUARD_MARKER = "[network-guard] blocked"; // printed by the guard (not imported: it would patch this process)
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "cps-target-safety-"));

// Fake values used only by these tests.
const FAKE_PASSWORD = "fake-Pa55word-not-real";
const SHELL_PASSWORD = "fake-shell-Pa55word";
const STAGING_REF = "stagingrefabcdefghij";
const OTHER_REF = "productionrefklmnopq";
const poolerUrl = (ref, user = `postgres.${ref}`) =>
  `postgresql://${user}:${FAKE_PASSWORD}@aws-0-us-east-1.pooler.supabase.com:5432/postgres`;

// Child processes never see the caller's database settings and never use the project's .data folder.
const baseEnv = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !/^(DATABASE_.*|PGLITE_DATA_DIR|ALLOW_EMBEDDED_DATABASE|NODE_ENV)$/i.test(name)),
);
baseEnv.PGLITE_DATA_DIR = path.join(scratch, "pglite");

function writeEnvFile(name, lines) {
  const file = path.join(scratch, name);
  fs.writeFileSync(file, `${lines.join("\n")}\n`);
  return file;
}
const stagingFile = writeEnvFile(".env.staging.test", [`DATABASE_URL=${poolerUrl(STAGING_REF)}`]);

/** Runs a script from scripts/ with the network guard, in the scratch folder. */
function run(script, args, extraEnv = {}) {
  const result = spawnSync(
    process.execPath,
    ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--import", guard, path.join(project, "scripts", script), ...args],
    { cwd: scratch, env: { ...baseEnv, ...extraEnv }, encoding: "utf8", timeout: 120_000 },
  );
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  return { status: result.status, stdout: result.stdout ?? "", output, connected: output.includes(GUARD_MARKER) };
}

/** Prints the refusal a command gave, so the test output shows what an operator would see. */
function show(result) {
  const error = result.output.split("\n").find((line) => line.startsWith("Error:"));
  if (error) console.log(`      ${error.length > 150 ? `${error.slice(0, 147)}...` : error}`);
}

function assertNoSecrets(result) {
  for (const secret of [FAKE_PASSWORD, SHELL_PASSWORD, `postgres.${STAGING_REF}:`, "postgresql://"]) {
    assert.ok(!result.output.includes(secret), `the output contains a credential or connection string (${secret.slice(0, 10)}…)`);
  }
}

function assertStoppedBeforeConnecting(result, pattern) {
  assert.equal(result.status, 1, `expected exit code 1, got ${result.status}:\n${result.output}`);
  assert.match(result.output, pattern);
  assert.ok(!result.connected, `a connection was attempted:\n${result.output}`);
  assertNoSecrets(result);
  show(result);
}

/* ------------------------------ F1: --env-file vs shell ------------------------------ */

await test("F1 unit: a DATABASE_* variable set in both the shell and the --env-file is refused, naming both places", () => {
  let caught;
  try {
    loadEnvironment(scratch, ".env.staging.test", { PATH: "x", DATABASE_URL: `postgresql://shell:${SHELL_PASSWORD}@shell.example.com/db` });
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof TargetSafetyError, `expected TargetSafetyError, got ${caught?.name}`);
  assert.match(caught.message, /DATABASE_URL: set in the shell environment and in \.env\.staging\.test/);
  assert.match(caught.message, /nothing was run and no connection was made/);
  assert.ok(!caught.message.includes(SHELL_PASSWORD) && !caught.message.includes(FAKE_PASSWORD), "a value was printed");
});

await test("F1 unit: a DATABASE_* setting only in the shell is refused too, whatever its letter case", () => {
  assert.throws(
    () => loadEnvironment(scratch, ".env.staging.test", { database_ssl: "disable" }),
    (error) => error instanceof TargetSafetyError && /database_ssl: set in the shell environment\n/.test(error.message),
  );
});

await test("F1 unit: with a clean shell, --env-file is the only source of database settings", () => {
  const { env, sourceOf } = loadEnvironment(scratch, ".env.staging.test", { PATH: "x", PGLITE_DATA_DIR: "y" });
  assert.equal(sourceOf("DATABASE_URL"), ".env.staging.test");
  assert.equal(env.PATH, "x", "other shell variables still pass through");
});

await test("F1 unit: without --env-file, behaviour is unchanged (the shell wins over .env.local)", () => {
  const folder = fs.mkdtempSync(path.join(scratch, "dotenv-"));
  fs.writeFileSync(path.join(folder, ".env.local"), "DATABASE_URL=postgresql://file@localhost/db\n");
  const { sourceOf } = loadEnvironment(folder, undefined, { DATABASE_URL: "postgresql://shell@localhost/db" });
  assert.equal(sourceOf("DATABASE_URL"), "environment");
});

const shellUrl = { DATABASE_URL: `postgresql://shell_user:${SHELL_PASSWORD}@shell-db.example.com:5432/postgres` };
for (const [label, script, args] of [
  ["db:status", "db.mjs", ["status", "--env-file", stagingFile]],
  ["db:migrate", "db.mjs", ["migrate", "--env-file", stagingFile, "--confirm-target", STAGING_REF]],
  ["db:print-sql", "db.mjs", ["print-sql", "--env-file", stagingFile]],
  ["credentials:reset", "reset-credential.mjs", ["admin", "--env-file", stagingFile, "--confirm-target", STAGING_REF]],
]) {
  await test(`F1: ${label} with --env-file and DATABASE_URL also set in the shell stops before connecting`, () => {
    const result = run(script, args, shellUrl);
    assertStoppedBeforeConnecting(result, /DATABASE_URL: set in the shell environment and in \.env\.staging\.test/);
    assert.ok(!/^Target:/m.test(result.stdout), "it should stop before choosing a target");
  });
}

await test("F1 control: the same db:status proceeds (to the network guard) once the shell is clean", () => {
  const result = run("db.mjs", ["status", "--env-file", stagingFile]);
  assert.match(result.stdout, /^DATABASE_URL from: \.env\.staging\.test$/m);
  assert.ok(result.connected, `expected a connection attempt:\n${result.output}`);
  assertNoSecrets(result);
});

/* ------------------------- F2: project ref and --confirm-target ------------------------- */

await test("F2: the Target line names the Supabase project ref, never the user name or password", () => {
  const result = run("db.mjs", ["status", "--env-file", stagingFile]);
  assert.match(
    result.stdout,
    new RegExp(`^Target: PostgreSQL at aws-0-us-east-1\\.pooler\\.supabase\\.com:5432/postgres, Supabase project ${STAGING_REF} \\(TLS verify-full`, "m"),
  );
  assertNoSecrets(result);
  console.log(`      ${result.stdout.split("\n").find((line) => line.startsWith("Target:"))}`);
});

await test("F2: db:migrate against Supabase without --confirm-target stops before connecting", () => {
  assertStoppedBeforeConnecting(run("db.mjs", ["migrate", "--env-file", stagingFile]), /Refusing to run db:migrate against a database that is not on this machine without --confirm-target/);
});

await test("F2: db:migrate with the wrong --confirm-target stops before connecting (the value given is not echoed)", () => {
  const result = run("db.mjs", ["migrate", "--env-file", stagingFile, "--confirm-target", OTHER_REF]);
  assertStoppedBeforeConnecting(result, new RegExp(`does not match this database's Supabase project ref \\(${STAGING_REF}\\)`));
  assert.ok(!result.output.includes(OTHER_REF));
});

await test("F2 control: db:migrate with the matching --confirm-target (any letter case) proceeds to connect", () => {
  const result = run("db.mjs", ["migrate", "--env-file", stagingFile, "--confirm-target", STAGING_REF.toUpperCase()]);
  assert.match(result.stdout, new RegExp(`^Target confirmed: Supabase project ref ${STAGING_REF}$`, "m"));
  assert.ok(result.connected, `expected a connection attempt:\n${result.output}`);
  assertNoSecrets(result);
});

await test("F2: a Supabase pooler URL whose user name names no project cannot be confirmed at all", () => {
  const file = writeEnvFile(".env.noref.test", [`DATABASE_URL=${poolerUrl(STAGING_REF, "postgres")}`]);
  assertStoppedBeforeConnecting(run("db.mjs", ["migrate", "--env-file", file]), /cannot confirm this target/);
  assertStoppedBeforeConnecting(run("db.mjs", ["migrate", "--env-file", file, "--confirm-target", STAGING_REF]), /cannot confirm this target/);
});

await test("F2: other PostgreSQL servers are confirmed by host name", () => {
  const file = writeEnvFile(".env.remote.test", [`DATABASE_URL=postgresql://app:${FAKE_PASSWORD}@db.internal.example.com:5432/app`]);
  assertStoppedBeforeConnecting(run("db.mjs", ["migrate", "--env-file", file]), /--confirm-target <the host name shown there>/);
  assertStoppedBeforeConnecting(
    run("db.mjs", ["migrate", "--env-file", file, "--confirm-target", "db.other.example.com"]),
    /does not match this database's host name \(db\.internal\.example\.com\)/,
  );
  const confirmed = run("db.mjs", ["migrate", "--env-file", file, "--confirm-target", "db.internal.example.com"]);
  assert.ok(confirmed.connected, `expected a connection attempt:\n${confirmed.output}`);
});

await test("F2: db:status is read-only and needs no --confirm-target, but a wrong one still stops it", () => {
  assert.ok(run("db.mjs", ["status", "--env-file", stagingFile]).connected, "status should proceed without the flag");
  assertStoppedBeforeConnecting(run("db.mjs", ["status", "--env-file", stagingFile, "--confirm-target", OTHER_REF]), /does not match/);
});

await test("F2: db:print-sql connects to nothing and needs no flag (--confirm-target is rejected)", () => {
  const result = run("db.mjs", ["print-sql"]);
  assert.equal(result.status, 0, result.output);
  assert.ok(result.stdout.includes("BEGIN;") && result.stdout.trimEnd().endsWith("COMMIT;"));
  assert.ok(!result.connected);
  const flagged = run("db.mjs", ["print-sql", "--confirm-target", STAGING_REF]);
  assert.equal(flagged.status, 1);
  assert.match(flagged.output, /no target to confirm/);
});

await test("F2: databases on this machine need no --confirm-target", () => {
  const file = writeEnvFile(".env.localpg.test", [`DATABASE_URL=postgresql://app:${FAKE_PASSWORD}@localhost:5432/app`]);
  assert.ok(run("db.mjs", ["migrate", "--env-file", file]).connected, "a localhost target goes straight to connecting");
  const embedded = run("db.mjs", ["migrate", "--embedded"]);
  assert.equal(embedded.status, 0, embedded.output);
  assert.match(embedded.stdout, /Applied migrations: 1, 2, 3/);
  assert.ok(!embedded.connected);
  assertStoppedBeforeConnecting(run("db.mjs", ["migrate", "--embedded", "--confirm-target", STAGING_REF]), /target is the embedded database/);
});

await test("F2: credentials:reset against Supabase needs the matching --confirm-target", () => {
  const missing = run("reset-credential.mjs", ["admin", "--env-file", stagingFile]);
  assertStoppedBeforeConnecting(missing, /Refusing to run credentials:reset against a database that is not on this machine/);
  const wrong = run("reset-credential.mjs", ["admin", "--env-file", stagingFile, "--confirm-target", OTHER_REF]);
  assertStoppedBeforeConnecting(wrong, /does not match/);
  const confirmed = run("reset-credential.mjs", ["admin", "--env-file", stagingFile, "--confirm-target", STAGING_REF]);
  assert.ok(confirmed.connected, `expected a connection attempt:\n${confirmed.output}`);
  for (const result of [missing, wrong, confirmed]) assert.ok(!/New .*password/.test(result.output), "a password was generated");
  const embedded = run("reset-credential.mjs", ["site"], { PGLITE_DATA_DIR: path.join(scratch, "missing") });
  assert.match(embedded.output, /No database found/, "the embedded database needs no confirmation");
  assert.ok(!embedded.connected);
});

await test("F2 unit: confirmation rules (required for remote writes, checked whenever given)", () => {
  const config = (url) => resolveDatabaseConfig({ DATABASE_URL: url }, { cwd: scratch });
  const supabase = config(poolerUrl(STAGING_REF));
  const write = { required: true, command: "db:migrate" };
  const read = { required: false, command: "db:status" };
  assert.throws(() => checkTargetConfirmation(supabase, undefined, write), TargetSafetyError);
  assert.throws(() => checkTargetConfirmation(supabase, "   ", write), TargetSafetyError, "blank counts as missing");
  assert.throws(() => checkTargetConfirmation(supabase, OTHER_REF, read), TargetSafetyError);
  assert.deepEqual(checkTargetConfirmation(supabase, ` ${STAGING_REF} `, write), {
    confirmed: true,
    label: "Supabase project ref",
    name: STAGING_REF,
  });
  assert.deepEqual(checkTargetConfirmation(supabase, undefined, read), { confirmed: false });
  const direct = config(`postgresql://postgres:${FAKE_PASSWORD}@db.${STAGING_REF}.supabase.co:5432/postgres`);
  assert.equal(checkTargetConfirmation(direct, STAGING_REF, write).name, STAGING_REF);
  const ipv6 = config(`postgresql://app:${FAKE_PASSWORD}@[2001:db8::10]:5432/app`);
  assert.equal(checkTargetConfirmation(ipv6, "[2001:db8::10]", write).name, "2001:db8::10");
  const local = config(`postgresql://app:${FAKE_PASSWORD}@127.0.0.1:5432/app`);
  assert.deepEqual(checkTargetConfirmation(local, undefined, write), { confirmed: false });
});

/* ------------------------ F3: automatic migration under next dev ------------------------ */

await test("F3 unit: automatic migration defaults to on only for the embedded database in development", () => {
  const resolve = (env) => resolveDatabaseConfig(env, { cwd: scratch }).autoMigrate;
  assert.equal(resolve({ NODE_ENV: "development" }), true);
  assert.equal(resolve({ NODE_ENV: "development", DATABASE_URL: poolerUrl(STAGING_REF) }), false);
  assert.equal(resolve({ NODE_ENV: "development", DATABASE_URL: poolerUrl(STAGING_REF), DATABASE_AUTO_MIGRATE: "true" }), true);
});

const int32 = (value) => {
  const buffer = Buffer.alloc(4);
  buffer.writeInt32BE(value);
  return buffer;
};
const int16 = (value) => {
  const buffer = Buffer.alloc(2);
  buffer.writeInt16BE(value);
  return buffer;
};
const cstring = (text) => Buffer.from(`${text}\0`, "utf8");
const pgMessage = (type, ...parts) => {
  const body = Buffer.concat(parts);
  return Buffer.concat([Buffer.from(type), int32(body.length + 4), body]);
};
const ready = (status) => pgMessage("Z", Buffer.from(status));
const refusal = () =>
  pgMessage("E", Buffer.from("S"), cstring("ERROR"), Buffer.from("V"), cstring("ERROR"), Buffer.from("C"), cstring("XX000"),
    Buffer.from("M"), cstring("statement refused by the fake test server (it runs nothing)"), Buffer.from([0]));

/**
 * Speaks just enough of the PostgreSQL wire protocol for node-postgres: it
 * reports an empty database to the schema check, acknowledges BEGIN, COMMIT
 * and ROLLBACK, refuses every other statement, and records all of them.
 */
async function startFakePostgres() {
  const statements = [];
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => undefined);
    let buffer = Buffer.alloc(0);
    let started = false;
    let status = "I";
    let refuseAtSync = false;
    const answer = (text) => {
      if (/to_regclass\('schema_migrations'\)/i.test(text)) {
        return Buffer.concat([
          pgMessage("T", int16(1), cstring("present"), int32(0), int16(0), int32(16), int16(1), int32(-1), int16(0)),
          pgMessage("D", int16(1), int32(1), Buffer.from("f")),
          pgMessage("C", cstring("SELECT 1")),
          ready(status),
        ]);
      }
      const keyword = /^\s*(BEGIN|COMMIT|ROLLBACK)\b/i.exec(text)?.[1].toUpperCase();
      if (keyword) {
        status = keyword === "BEGIN" ? "T" : "I";
        return Buffer.concat([pgMessage("C", cstring(keyword)), ready(status)]);
      }
      if (status === "T") status = "E";
      return Buffer.concat([refusal(), ready(status)]);
    };
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        if (!started) {
          if (buffer.length < 8 || buffer.length < buffer.readInt32BE(0)) return;
          const code = buffer.readInt32BE(4);
          buffer = buffer.subarray(buffer.readInt32BE(0));
          if (code === 80877103 || code === 80877104) {
            socket.write("N"); // no TLS or GSS encryption
            continue;
          }
          started = true;
          socket.write(
            Buffer.concat([
              pgMessage("R", int32(0)),
              pgMessage("S", cstring("server_version"), cstring("16.4")),
              pgMessage("S", cstring("client_encoding"), cstring("UTF8")),
              pgMessage("S", cstring("standard_conforming_strings"), cstring("on")),
              pgMessage("S", cstring("integer_datetimes"), cstring("on")),
              pgMessage("K", int32(4242), int32(4242)),
              ready("I"),
            ]),
          );
          continue;
        }
        if (buffer.length < 5 || buffer.length < 1 + buffer.readInt32BE(1)) return;
        const type = String.fromCharCode(buffer[0]);
        const body = buffer.subarray(5, 1 + buffer.readInt32BE(1));
        buffer = buffer.subarray(1 + buffer.readInt32BE(1));
        if (type === "X") {
          socket.end();
          return;
        }
        if (type === "Q") {
          const text = body.toString("utf8", 0, body.length - 1);
          statements.push(text);
          socket.write(answer(text));
        } else if (type === "P") {
          const nameEnd = body.indexOf(0);
          statements.push(body.toString("utf8", nameEnd + 1, body.indexOf(0, nameEnd + 1)));
          refuseAtSync = true;
        } else if (type === "S") {
          if (refuseAtSync && status === "T") status = "E";
          socket.write(refuseAtSync ? Buffer.concat([refusal(), ready(status)]) : ready(status));
          refuseAtSync = false;
        }
      }
    });
  });
  // 127.0.0.2 is a loopback address the configuration treats as a remote host;
  // fall back to 127.0.0.1 where only that loopback address is available.
  let host = "127.0.0.2";
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, host, resolve);
    });
  } catch {
    host = "127.0.0.1";
    await new Promise((resolve) => server.listen(0, host, resolve));
  }
  return {
    host,
    port: server.address().port,
    statements,
    close: () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

/** Starts `next dev` for this project; stop() ends the whole process tree. */
async function startNextDev(env) {
  const port = await freePort();
  const logs = [];
  const child = spawn(process.execPath, [path.join(project, "node_modules", "next", "dist", "bin", "next"), "dev", "-p", String(port)], {
    cwd: project,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
  child.stdout.on("data", (data) => logs.push(String(data)));
  child.stderr.on("data", (data) => logs.push(String(data)));
  const exited = new Promise((resolve) => child.once("exit", resolve));
  const started = Date.now();
  while (!/Ready in/i.test(logs.join("")) && child.exitCode === null && Date.now() - started < 120_000) await delay(250);
  return {
    url: `http://localhost:${port}`,
    logs: () => logs.join(""),
    async stop() {
      if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      else process.kill(-child.pid, "SIGTERM");
      await Promise.race([exited, delay(15_000)]);
    },
  };
}

async function devServerAgainstFake(extraEnv) {
  const fake = await startFakePostgres();
  const env = {
    ...baseEnv,
    NEXT_TELEMETRY_DISABLED: "1",
    DATABASE_URL: `postgresql://fake_user:${FAKE_PASSWORD}@${fake.host}:${fake.port}/fake_db`,
    DATABASE_SSL: "disable", // the fake server does not speak TLS
    ...extraEnv,
  };
  const dev = await startNextDev(env);
  try {
    const response = await fetch(`${dev.url}/login`, { signal: AbortSignal.timeout(180_000) });
    await response.text();
    await delay(1_500); // let the server finish logging
    return { status: response.status, logs: dev.logs(), statements: [...fake.statements], host: fake.host };
  } finally {
    await dev.stop();
    await fake.close();
  }
}

const WRITE_OR_TRANSACTION = /\b(BEGIN|COMMIT|CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|GRANT|REVOKE|TRUNCATE|SET|LOCK)\b/i;

await test("F3: next dev with a PostgreSQL DATABASE_URL only checks the schema, applies nothing, and says to run db:migrate", async () => {
  const run = await devServerAgainstFake({});
  console.log(`      fake PostgreSQL at ${run.host} received: ${run.statements.map((text) => JSON.stringify(text)).join(", ") || "(nothing)"}`);
  assert.ok(
    run.statements.some((text) => /to_regclass\('schema_migrations'\)/.test(text)),
    `the schema check never reached the database:\n${run.logs.slice(-2000)}`,
  );
  assert.deepEqual(run.statements.filter((text) => WRITE_OR_TRANSACTION.test(text)), [], "statements that change the database were sent");
  assert.equal(run.status, 500, "the page should not render against an unmigrated database");
  assert.match(run.logs, /The database has no application schema yet\. Run `npm run db:migrate` against this database first/);
  assert.ok(!run.logs.includes(FAKE_PASSWORD), "the server log contains the password");
  const line = run.logs.split("\n").find((text) => text.includes("no application schema yet"));
  if (line) console.log(`      server log: ${line.trim().slice(0, 170)}...`);
});

await test("F3 control: with DATABASE_AUTO_MIGRATE=true, the same next dev does try to migrate (so the check above is meaningful)", async () => {
  const run = await devServerAgainstFake({ DATABASE_AUTO_MIGRATE: "true" });
  console.log(`      fake PostgreSQL received: ${run.statements.map((text) => JSON.stringify(text)).join(", ")}`);
  assert.deepEqual(run.statements.slice(0, 2), ["BEGIN", "SET LOCAL lock_timeout = '5s'"], "a migration starts with BEGIN and the lock timeout");
  assert.ok(run.statements.includes("ROLLBACK"), "the refused migration was rolled back");
});

fs.rmSync(scratch, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
