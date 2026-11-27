// Tests for the database configuration (src/lib/server/db-config.ts):
// production guard, TLS settings, connection-string sanitization, certificate
// handling, secret-free errors, and the Vercel pool helper.
//
// No real database or external network is used. The TLS tests run the real
// node-postgres driver against a throwaway local TLS server, with certificates
// generated on the fly by openssl in a temporary folder (deleted afterwards).
// They are skipped if openssl is not available (set OPENSSL_BIN to its path).
//
//   npm run test:db-config
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import tls from "node:tls";
import pg from "pg";
import { attachDatabasePool } from "@vercel/functions/db-connections";
import {
  DatabaseConfigError,
  describeDatabaseTarget,
  explainDatabaseError,
  identifySupabaseProject,
  isTlsVerificationError,
  normalizeCertificate,
  resolveDatabaseConfig,
  sanitizeConnectionString,
} from "../src/lib/server/db-config.ts";
import { loadEnvironment } from "./lib/cli.mjs";

let passed = 0;
let failed = 0;
let skipped = 0;

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

function skip(name, reason) {
  skipped++;
  console.log(`skip  ${name} (${reason})`);
}

function info(message) {
  console.log(`info  ${message}`);
}

function expectConfigError(fn, pattern, forbidden = []) {
  let caught;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, "expected a DatabaseConfigError, but nothing was thrown");
  assert.ok(caught instanceof DatabaseConfigError, `expected DatabaseConfigError, got ${caught?.name}`);
  assert.match(caught.message, pattern);
  for (const secret of forbidden) assert.ok(!caught.message.includes(secret), "error message contains a secret");
  assert.equal(caught.input, undefined, "error carries the raw input");
  return caught;
}

const cwd = process.cwd();
const resolve = (env, extra = {}) => resolveDatabaseConfig(env, { cwd, ...extra });

// Fake credentials used only by these tests.
const PASSWORD = "S3cr@t#Pass";
const PASSWORD_ENCODED = "S3cr%40t%23Pass";
const USER = "postgres.abcdefghijklmnop";
const POOLER = `postgresql://${USER}:${PASSWORD_ENCODED}@aws-0-us-east-1.pooler.supabase.com:6543/postgres`;
const SAMPLE_PEM = tls.rootCertificates[0]; // any real certificate works for parsing tests

/* -------------------------------- Production guard -------------------------------- */

await test("development without DATABASE_URL uses the embedded database and migrates automatically", () => {
  const config = resolve({ NODE_ENV: "development" });
  assert.equal(config.kind, "pglite");
  assert.equal(config.dataDir, path.join(cwd, ".data", "pglite"));
  assert.equal(config.autoMigrate, true);
});

await test("scripts and tests without NODE_ENV use the embedded database", () => {
  assert.equal(resolve({}).kind, "pglite");
});

await test("PGLITE_DATA_DIR is resolved relative to the working directory", () => {
  assert.equal(resolve({ PGLITE_DATA_DIR: "tmp/db" }).dataDir, path.join(cwd, "tmp", "db"));
});

await test("production without DATABASE_URL refuses to fall back to the embedded database", () => {
  expectConfigError(() => resolve({ NODE_ENV: "production" }), /DATABASE_URL is not set.*ALLOW_EMBEDDED_DATABASE/s);
});

await test("production with ALLOW_EMBEDDED_DATABASE=true may use the embedded database (migrations stay manual)", () => {
  const config = resolve({ NODE_ENV: "production", ALLOW_EMBEDDED_DATABASE: "true" });
  assert.equal(config.kind, "pglite");
  assert.equal(config.autoMigrate, false);
});

await test("Vercel without DATABASE_URL is always refused, even with ALLOW_EMBEDDED_DATABASE", () => {
  expectConfigError(() => resolve({ NODE_ENV: "production", VERCEL: "1" }), /Vercel/);
  expectConfigError(() => resolve({ NODE_ENV: "production", VERCEL: "1", ALLOW_EMBEDDED_DATABASE: "true" }), /Vercel/);
});

await test("an explicit command-line opt-in (--embedded) bypasses the guard", () => {
  assert.equal(resolve({ NODE_ENV: "production", VERCEL: "1" }, { allowEmbedded: true }).kind, "pglite");
});

await test("invalid ALLOW_EMBEDDED_DATABASE values are rejected", () => {
  expectConfigError(() => resolve({ NODE_ENV: "production", ALLOW_EMBEDDED_DATABASE: "maybe" }), /ALLOW_EMBEDDED_DATABASE/);
});

/* ------------------------------- Automatic migration ------------------------------- */

await test("automatic migration defaults: only the embedded database in development", () => {
  assert.equal(resolve({ NODE_ENV: "development" }).autoMigrate, true, "embedded, development");
  assert.equal(resolve({}).autoMigrate, true, "embedded, no NODE_ENV");
  assert.equal(resolve({ NODE_ENV: "development", DATABASE_URL: POOLER }).autoMigrate, false, "remote PostgreSQL, development");
  assert.equal(
    resolve({ NODE_ENV: "development", DATABASE_URL: "postgresql://app:pw@localhost:5432/app" }).autoMigrate,
    false,
    "local PostgreSQL, development",
  );
  assert.equal(resolve({ DATABASE_URL: POOLER }).autoMigrate, false, "remote PostgreSQL, no NODE_ENV");
  assert.equal(resolve({ NODE_ENV: "production", DATABASE_URL: POOLER }).autoMigrate, false, "remote PostgreSQL, production");
});

await test("DATABASE_AUTO_MIGRATE overrides the default and rejects invalid values", () => {
  assert.equal(resolve({ NODE_ENV: "development", DATABASE_URL: POOLER, DATABASE_AUTO_MIGRATE: "true" }).autoMigrate, true);
  assert.equal(resolve({ NODE_ENV: "production", DATABASE_URL: POOLER, DATABASE_AUTO_MIGRATE: "true" }).autoMigrate, true);
  assert.equal(resolve({ NODE_ENV: "development", DATABASE_AUTO_MIGRATE: "false" }).autoMigrate, false);
  expectConfigError(() => resolve({ DATABASE_AUTO_MIGRATE: "sometimes" }), /DATABASE_AUTO_MIGRATE/);
  expectConfigError(() => resolve({ DATABASE_URL: POOLER, DATABASE_AUTO_MIGRATE: "sometimes" }), /DATABASE_AUTO_MIGRATE/);
});

/* ---------------------------------- TLS settings ---------------------------------- */

await test("remote databases default to verify-full with the system CA store", () => {
  const config = resolve({ DATABASE_URL: POOLER });
  assert.equal(config.sslMode, "verify-full");
  assert.deepEqual(config.ssl, { rejectUnauthorized: true });
  assert.equal(config.certificateSource, "system");
  assert.deepEqual(config.warnings, []);
});

await test("local databases default to no TLS", () => {
  for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
    const config = resolve({ DATABASE_URL: `postgresql://u:p@${host}:5432/app` });
    assert.equal(config.sslMode, "disable", host);
    assert.equal(config.ssl, false, host);
  }
});

await test("sslmode=require in DATABASE_URL is removed and enforced as verify-full", () => {
  const config = resolve({ DATABASE_URL: `${POOLER}?sslmode=require&supa=base-pooler.x` });
  assert.equal(config.sslMode, "verify-full");
  assert.ok(!config.connectionString.includes("sslmode"), "sslmode still in the connection string");
  assert.ok(config.connectionString.includes("supa=base-pooler.x"), "other parameters must be kept");
});

await test("URL sslmode=disable and sslmode=no-verify are honoured (the latter with a warning)", () => {
  assert.equal(resolve({ DATABASE_URL: `${POOLER}?sslmode=disable` }).sslMode, "disable");
  const noVerify = resolve({ DATABASE_URL: `${POOLER}?sslmode=no-verify` });
  assert.equal(noVerify.sslMode, "require");
  assert.deepEqual(noVerify.ssl, { rejectUnauthorized: false });
  assert.ok(noVerify.warnings.some((warning) => /does not verify/.test(warning)));
});

await test("DATABASE_SSL takes precedence over the URL; legacy 'verify' means verify-full", () => {
  assert.equal(resolve({ DATABASE_URL: `${POOLER}?sslmode=verify-full`, DATABASE_SSL: "require" }).sslMode, "require");
  assert.equal(resolve({ DATABASE_URL: POOLER, DATABASE_SSL: "verify" }).sslMode, "verify-full");
  assert.equal(resolve({ DATABASE_URL: POOLER, DATABASE_SSL: "disable" }).ssl, false);
});

await test("unknown TLS settings are rejected", () => {
  expectConfigError(() => resolve({ DATABASE_URL: POOLER, DATABASE_SSL: "strict" }), /DATABASE_SSL must be one of/);
  expectConfigError(() => resolve({ DATABASE_URL: `${POOLER}?sslmode=bogus` }), /unsupported sslmode/, [PASSWORD, PASSWORD_ENCODED]);
});

await test("verify-ca requires a CA certificate and skips only the host-name check", () => {
  expectConfigError(() => resolve({ DATABASE_URL: POOLER, DATABASE_SSL: "verify-ca" }), /requires the server's CA certificate/);
  const config = resolve({ DATABASE_URL: POOLER, DATABASE_SSL: "verify-ca", DATABASE_CA_CERT: SAMPLE_PEM });
  assert.equal(config.ssl.rejectUnauthorized, true);
  assert.ok(config.ssl.ca.includes("BEGIN CERTIFICATE"));
  assert.equal(typeof config.ssl.checkServerIdentity, "function");
  assert.equal(config.ssl.checkServerIdentity("any-host", {}), undefined);
});

await test("verify-full with DATABASE_CA_CERT uses that certificate", () => {
  const config = resolve({ DATABASE_URL: POOLER, DATABASE_CA_CERT: SAMPLE_PEM });
  assert.equal(config.certificateSource, "DATABASE_CA_CERT");
  assert.equal(config.ssl.rejectUnauthorized, true);
  assert.equal(config.ssl.checkServerIdentity, undefined, "host-name verification must stay on");
  assert.equal(config.ssl.ca, normalizeCertificate(SAMPLE_PEM, "test"));
});

/* ---------------------------------- Certificates ---------------------------------- */

await test("certificates survive the ways environment variables mangle them", () => {
  const canonical = normalizeCertificate(SAMPLE_PEM, "test");
  const variants = {
    "real newlines": SAMPLE_PEM,
    "CRLF line endings": SAMPLE_PEM.replace(/\n/g, "\r\n"),
    'literal "\\n"': SAMPLE_PEM.trim().replace(/\n/g, "\\n"),
    "newlines collapsed to spaces": SAMPLE_PEM.trim().replace(/\n/g, " "),
    "wrapped in quotes": `"${SAMPLE_PEM.trim()}"`,
    base64: Buffer.from(SAMPLE_PEM).toString("base64"),
  };
  for (const [label, value] of Object.entries(variants)) assert.equal(normalizeCertificate(value, "test"), canonical, label);
});

await test("certificate bundles keep every certificate", () => {
  const bundle = `${tls.rootCertificates[0]}\n${tls.rootCertificates[1]}`;
  assert.equal(normalizeCertificate(bundle, "test").match(/BEGIN CERTIFICATE/g).length, 2);
});

await test("invalid certificates are rejected without echoing their content", () => {
  expectConfigError(() => resolve({ DATABASE_URL: POOLER, DATABASE_CA_CERT: "not-a-certificate-value" }), /must contain a PEM certificate/, [
    "not-a-certificate-value",
  ]);
  const corrupt = "-----BEGIN CERTIFICATE-----\nAAAAsecretlookingAAAA\n-----END CERTIFICATE-----";
  expectConfigError(() => resolve({ DATABASE_URL: POOLER, DATABASE_CA_CERT: corrupt }), /could not be parsed/, ["secretlooking"]);
});

await test("DATABASE_CA_CERT_FILE is read through the injected reader; conflicts and missing files are reported", () => {
  const files = { [path.join(cwd, "certs", "ca.crt")]: SAMPLE_PEM };
  const readFile = (file) => {
    if (!(file in files)) throw new Error("ENOENT");
    return files[file];
  };
  const config = resolve({ DATABASE_URL: POOLER, DATABASE_CA_CERT_FILE: "certs/ca.crt" }, { readFile });
  assert.equal(config.certificateSource, "DATABASE_CA_CERT_FILE");
  expectConfigError(() => resolve({ DATABASE_URL: POOLER, DATABASE_CA_CERT_FILE: "missing.crt" }, { readFile }), /could not be read/);
  expectConfigError(
    () => resolve({ DATABASE_URL: POOLER, DATABASE_CA_CERT: SAMPLE_PEM, DATABASE_CA_CERT_FILE: "certs/ca.crt" }, { readFile }),
    /only one of/,
  );
});

await test("a CA certificate with verification turned off produces a warning", () => {
  const config = resolve({ DATABASE_URL: POOLER, DATABASE_SSL: "require", DATABASE_CA_CERT: SAMPLE_PEM });
  assert.ok(config.warnings.some((warning) => /not used/.test(warning)));
});

await test("a multi-line PEM in an env file loads through the scripts' env loader", () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "cps-env-"));
  try {
    fs.writeFileSync(
      path.join(folder, ".env.test"),
      `DATABASE_URL=${POOLER}\nDATABASE_CA_CERT="${SAMPLE_PEM.trim()}"\n`,
    );
    const { env, sourceOf } = loadEnvironment(folder, ".env.test", {});
    assert.ok(env.DATABASE_CA_CERT.includes("\n"), "newlines were lost");
    assert.equal(sourceOf("DATABASE_URL"), ".env.test");
    assert.equal(resolve({ DATABASE_URL: env.DATABASE_URL, DATABASE_CA_CERT: env.DATABASE_CA_CERT }).certificateSource, "DATABASE_CA_CERT");
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
});

/* ------------------------------ Connection strings ------------------------------ */

await test("sanitized connection strings keep credentials intact and give TLS control to the app", () => {
  const config = resolve({ DATABASE_URL: `${POOLER}?sslmode=require`, DATABASE_CA_CERT: SAMPLE_PEM });
  const parameters = new pg.Client({ connectionString: config.connectionString, ssl: config.ssl }).connectionParameters;
  assert.equal(parameters.user, USER);
  assert.equal(parameters.password, PASSWORD);
  assert.equal(parameters.host, "aws-0-us-east-1.pooler.supabase.com");
  assert.equal(Number(parameters.port), 6543);
  assert.equal(parameters.database, "postgres");
  assert.equal(parameters.ssl.rejectUnauthorized, true);
  assert.equal(parameters.ssl.ca, config.ssl.ca, "the custom CA must reach the driver");
});

await test("(reference) unsanitized URLs let sslmode discard the CA in node-postgres", () => {
  const emit = process.emitWarning;
  process.emitWarning = () => undefined; // silence pg's sslmode notice for this demonstration
  try {
    const parameters = new pg.Client({
      connectionString: `${POOLER}?sslmode=require`,
      ssl: { rejectUnauthorized: true, ca: SAMPLE_PEM },
    }).connectionParameters;
    if (parameters.ssl?.ca === undefined) info("node-postgres replaced the ssl options with the URL's sslmode (why DATABASE_URL is sanitized)");
    else info("this node-postgres version keeps explicit ssl options; sanitizing remains harmless");
  } finally {
    process.emitWarning = emit;
  }
});

await test("connection strings without TLS parameters are passed through unchanged", () => {
  assert.equal(sanitizeConnectionString(POOLER).connectionString, POOLER);
});

await test("malformed DATABASE_URL values are rejected without leaking the password", () => {
  // An unencoded "#" would otherwise turn the rest of the password into a URL fragment.
  expectConfigError(() => resolve({ DATABASE_URL: `postgresql://${USER}:${PASSWORD}@db.example.com:5432/postgres` }), /contains "#"/, [
    PASSWORD,
    USER,
  ]);
  expectConfigError(() => resolve({ DATABASE_URL: "not a url with S3cr@t#Pass" }), /not a valid connection URL/, [PASSWORD]);
  expectConfigError(() => resolve({ DATABASE_URL: `mysql://${USER}:${PASSWORD_ENCODED}@host/db` }), /must start with postgresql/, [
    PASSWORD_ENCODED,
  ]);
});

await test("target descriptions never include credentials", () => {
  const description = describeDatabaseTarget(resolve({ DATABASE_URL: POOLER, DATABASE_CA_CERT: SAMPLE_PEM }));
  assert.match(description, /aws-0-us-east-1\.pooler\.supabase\.com:6543\/postgres/);
  assert.match(description, /verify-full, CA from DATABASE_CA_CERT/);
  for (const secret of [PASSWORD, PASSWORD_ENCODED, USER]) assert.ok(!description.includes(secret));
});

await test("target descriptions name the Supabase project, which pooler host names alone do not identify", () => {
  const staging = describeDatabaseTarget(
    resolve({ DATABASE_URL: `postgresql://postgres.stagingprojectref0001:${PASSWORD_ENCODED}@aws-0-us-east-1.pooler.supabase.com:5432/postgres` }),
  );
  const production = describeDatabaseTarget(
    resolve({ DATABASE_URL: `postgresql://postgres.productionprojref002:${PASSWORD_ENCODED}@aws-0-us-east-1.pooler.supabase.com:5432/postgres` }),
  );
  assert.match(staging, /, Supabase project stagingprojectref0001 \(TLS/);
  assert.match(production, /, Supabase project productionprojref002 \(TLS/);
  assert.notEqual(staging, production);

  const direct = describeDatabaseTarget(resolve({ DATABASE_URL: `postgresql://postgres:${PASSWORD_ENCODED}@db.directprojectref0003.supabase.co:5432/postgres` }));
  assert.match(direct, /db\.directprojectref0003\.supabase\.co:5432\/postgres, Supabase project directprojectref0003 \(TLS/);

  const unnamed = describeDatabaseTarget(resolve({ DATABASE_URL: `postgresql://postgres:${PASSWORD_ENCODED}@aws-0-us-east-1.pooler.supabase.com:5432/postgres` }));
  assert.match(unnamed, /Supabase project unknown \(the user name should be postgres\.<project-ref>\)/);

  const plain = describeDatabaseTarget(resolve({ DATABASE_URL: `postgresql://app:${PASSWORD_ENCODED}@db.example.com:5432/app` }));
  assert.equal(plain, "PostgreSQL at db.example.com:5432/app (TLS verify-full, system CA store)");
  for (const text of [staging, production, direct, unnamed, plain]) {
    for (const secret of [PASSWORD, PASSWORD_ENCODED, "postgres.stagingprojectref0001", "postgres:"]) {
      assert.ok(!text.includes(secret), "the description contains the user name or password");
    }
  }
});

await test("Supabase project identification: pooler user names, direct hosts, and other hosts", () => {
  assert.deepEqual(identifySupabaseProject("aws-0-eu-west-2.pooler.supabase.com", "postgres.abcdefghijklmnopqrst"), {
    projectRef: "abcdefghijklmnopqrst",
    connection: "pooler",
  });
  assert.deepEqual(identifySupabaseProject("AWS-1-us-east-1.Pooler.Supabase.com", "app_role.ABCDEFGHIJKLMNOPQRST"), {
    projectRef: "abcdefghijklmnopqrst",
    connection: "pooler",
  });
  assert.deepEqual(identifySupabaseProject("aws-0-eu-west-2.pooler.supabase.com", "postgres"), { projectRef: null, connection: "pooler" });
  assert.deepEqual(identifySupabaseProject("aws-0-eu-west-2.pooler.supabase.com", "postgres.bad ref!"), {
    projectRef: null,
    connection: "pooler",
  });
  assert.deepEqual(identifySupabaseProject("db.abcdefghijklmnopqrst.supabase.co", "postgres"), {
    projectRef: "abcdefghijklmnopqrst",
    connection: "direct",
  });
  assert.equal(identifySupabaseProject("db.example.com", "postgres.abcdefghijklmnopqrst"), null);
  assert.equal(identifySupabaseProject("abcdefghijklmnopqrst.supabase.co", "postgres"), null, "the API host is not a database host");
  assert.equal(identifySupabaseProject("pooler.supabase.com.attacker.example", "postgres.abc"), null);
  // Percent-encoded user names are decoded before the ref is read.
  assert.equal(sanitizeConnectionString(`postgresql://postgres%2Eabcdefghijklmnopqrst:x@aws-0-us-east-1.pooler.supabase.com/postgres`).target.supabase.projectRef, "abcdefghijklmnopqrst");
});

await test("pool size and connection timeout: defaults, Vercel default, overrides, validation", () => {
  assert.equal(resolve({ DATABASE_URL: POOLER }).poolMax, 5);
  assert.equal(resolve({ DATABASE_URL: POOLER, VERCEL: "1" }).poolMax, 3);
  assert.equal(resolve({ DATABASE_URL: POOLER, DATABASE_POOL_MAX: "8" }).poolMax, 8);
  assert.equal(resolve({ DATABASE_URL: POOLER }).connectionTimeoutMillis, 10_000);
  expectConfigError(() => resolve({ DATABASE_URL: POOLER, DATABASE_POOL_MAX: "0" }), /DATABASE_POOL_MAX/);
  expectConfigError(() => resolve({ DATABASE_URL: POOLER, DATABASE_CONNECT_TIMEOUT_MS: "fast" }), /DATABASE_CONNECT_TIMEOUT_MS/);
});

/* ------------------------------- Error explanations ------------------------------- */

const supabaseConfig = resolve({ DATABASE_URL: POOLER });
const fakeError = (code, message = "driver error") => Object.assign(new Error(message), { code });

await test("untrusted certificates from Supabase explain how to provide its CA", () => {
  const explained = explainDatabaseError(fakeError("SELF_SIGNED_CERT_IN_CHAIN"), supabaseConfig);
  assert.equal(explained.name, "DatabaseConnectionError");
  assert.match(explained.message, /Supabase.*DATABASE_CA_CERT/s);
  assert.ok(explained.cause, "original error kept as cause");
  for (const secret of [PASSWORD, PASSWORD_ENCODED, USER]) assert.ok(!explained.message.includes(secret));
});

await test("host-name mismatches, IPv6-only hosts, and bad passwords get specific hints", () => {
  assert.match(explainDatabaseError(fakeError("ERR_TLS_CERT_ALTNAME_INVALID"), supabaseConfig).message, /verify-ca/);
  const direct = resolve({ DATABASE_URL: "postgresql://postgres:x@db.abcdefghijklmnop.supabase.co:5432/postgres" });
  assert.match(explainDatabaseError(fakeError("ENETUNREACH"), direct).message, /IPv6.*pooler/s);
  assert.match(explainDatabaseError(fakeError("28P01"), supabaseConfig).message, /password authentication failed/);
  assert.match(explainDatabaseError(new Error("Tenant or user not found"), supabaseConfig).message, /postgres\.<project-ref>/);
});

await test("a lock timeout from a working connection is not mistaken for a connection timeout", () => {
  const lockTimeout = fakeError("55P03", "canceling statement due to lock timeout");
  assert.equal(explainDatabaseError(lockTimeout, supabaseConfig), lockTimeout);
  const statementTimeout = fakeError("57014", "canceling statement due to statement timeout");
  assert.equal(explainDatabaseError(statementTimeout, supabaseConfig), statementTimeout);
  // Driver-side connection timeouts (no SQLSTATE) still get the connection hint.
  assert.match(explainDatabaseError(new Error("Connection terminated due to connection timeout"), supabaseConfig).message, /did not accept the connection in time/);
});

await test("errors without a known explanation are returned unchanged", () => {
  const original = fakeError("XX000", "something else");
  assert.equal(explainDatabaseError(original, supabaseConfig), original);
});

/* --------------------------------- Vercel helper --------------------------------- */

await test("attachDatabasePool accepts the app's pg pool without connecting (and is idempotent)", async () => {
  const pool = new pg.Pool({ connectionString: "postgresql://user:pass@127.0.0.1:1/db", idleTimeoutMillis: 10_000 });
  pool.on("error", () => undefined);
  attachDatabasePool(pool);
  attachDatabasePool(pool);
  assert.equal(pool.totalCount, 0, "no connection should be opened");
  await pool.end();
});

/* ------------------------- TLS handshakes (real pg driver) ------------------------- */

function findOpenssl() {
  const candidates = [
    process.env.OPENSSL_BIN,
    "openssl",
    ...(process.platform === "win32"
      ? ["C:\\Program Files\\Git\\usr\\bin\\openssl.exe", "C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe"]
      : []),
  ].filter(Boolean);
  for (const candidate of candidates) {
    const result = spawnSync(candidate, ["version"], { encoding: "utf8" });
    if (result.status === 0) return candidate;
  }
  return null;
}

function createTestCertificates(openssl) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "cps-tls-"));
  const run = (args) => {
    const result = spawnSync(openssl, args, { cwd: folder, encoding: "utf8" });
    if (result.status !== 0) throw new Error(`openssl ${args[0]} failed: ${result.stderr}`);
  };
  try {
    fs.writeFileSync(
      path.join(folder, "ca.cnf"),
      "[req]\nprompt = no\ndistinguished_name = dn\nx509_extensions = v3_ca\n[dn]\nCN = Code Patch Test CA\n" +
        "[v3_ca]\nbasicConstraints = critical, CA:TRUE\nkeyUsage = critical, keyCertSign, cRLSign\nsubjectKeyIdentifier = hash\n",
    );
    fs.writeFileSync(path.join(folder, "server.cnf"), "[req]\nprompt = no\ndistinguished_name = dn\n[dn]\nCN = db-test\n");
    const extensions = "basicConstraints = CA:FALSE\nkeyUsage = digitalSignature, keyEncipherment\nextendedKeyUsage = serverAuth\n";
    fs.writeFileSync(path.join(folder, "ip.ext"), `subjectAltName = IP:127.0.0.1\n${extensions}`);
    fs.writeFileSync(path.join(folder, "dns.ext"), `subjectAltName = DNS:db.example.test\n${extensions}`);
    run(["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", "ca.key", "-out", "ca.crt", "-days", "2", "-config", "ca.cnf"]);
    for (const name of ["ip", "dns"]) {
      run(["req", "-new", "-newkey", "rsa:2048", "-nodes", "-keyout", `${name}.key`, "-out", `${name}.csr`, "-config", "server.cnf"]);
      run(["x509", "-req", "-in", `${name}.csr`, "-CA", "ca.crt", "-CAkey", "ca.key", "-CAcreateserial", "-out", `${name}.crt`, "-days", "2", "-extfile", `${name}.ext`]);
    }
    const read = (file) => fs.readFileSync(path.join(folder, file), "utf8");
    return { ca: read("ca.crt"), ip: { key: read("ip.key"), cert: read("ip.crt") }, dns: { key: read("dns.key"), cert: read("dns.crt") } };
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
}

/** Speaks just enough of the PostgreSQL protocol to negotiate TLS, then hangs up. */
function startTlsServer({ key, cert }) {
  const context = tls.createSecureContext({ key, cert });
  const state = { handshakes: 0 };
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => undefined);
    socket.once("data", (chunk) => {
      if (chunk.length < 8 || chunk.readInt32BE(4) !== 80877103) {
        socket.destroy();
        return;
      }
      socket.write("S");
      const secure = new tls.TLSSocket(socket, { isServer: true, secureContext: context });
      secure.on("secure", () => {
        state.handshakes++;
        secure.end();
      });
      secure.on("error", () => socket.destroy());
    });
  });
  const close = () =>
    new Promise((done) => {
      for (const socket of sockets) socket.destroy();
      server.close(() => done());
    });
  return new Promise((resolveServer) =>
    server.listen(0, "127.0.0.1", () => resolveServer({ port: server.address().port, state, close })),
  );
}

async function connect(config) {
  const client = new pg.Client({ connectionString: config.connectionString, ssl: config.ssl, connectionTimeoutMillis: 5_000 });
  client.on("error", () => undefined);
  try {
    await client.connect();
    await client.end();
    return { verified: true, error: null };
  } catch (error) {
    return { verified: !isTlsVerificationError(error), error };
  }
}

async function expectHandshake(server, env, shouldSucceed, expectedCode) {
  const before = server.state.handshakes;
  const config = resolve({ DATABASE_URL: `postgresql://app:pw@127.0.0.1:${server.port}/app`, ...env });
  const result = await connect(config);
  if (shouldSucceed) {
    assert.ok(result.verified, `TLS was rejected: ${result.error?.code}`);
    assert.equal(server.state.handshakes, before + 1, "server did not complete a TLS handshake");
  } else {
    assert.ok(!result.verified, "connection should have been rejected");
    if (expectedCode) assert.equal(result.error.code, expectedCode);
    assert.equal(server.state.handshakes, before, "server should not complete a handshake");
  }
  return { config, result };
}

const openssl = findOpenssl();
if (!openssl) {
  skip("TLS handshake tests", "openssl not found; set OPENSSL_BIN to run them");
} else {
  const certificates = createTestCertificates(openssl);
  const matching = await startTlsServer(certificates.ip); // certificate for 127.0.0.1
  const mismatched = await startTlsServer(certificates.dns); // certificate for db.example.test
  try {
    await test("TLS verify-full + CA certificate: connects", () =>
      expectHandshake(matching, { DATABASE_SSL: "verify-full", DATABASE_CA_CERT: certificates.ca }, true));

    await test("TLS verify-full without the CA certificate: rejected, with an actionable explanation", async () => {
      const { config, result } = await expectHandshake(matching, { DATABASE_SSL: "verify-full" }, false);
      assert.match(explainDatabaseError(result.error, config).message, /DATABASE_CA_CERT/);
    });

    await test("TLS with sslmode=require in DATABASE_URL still uses DATABASE_CA_CERT and verifies", async () => {
      const before = matching.state.handshakes;
      const config = resolve({
        DATABASE_URL: `postgresql://app:pw@127.0.0.1:${matching.port}/app?sslmode=require`,
        DATABASE_CA_CERT: certificates.ca,
      });
      assert.equal(config.sslMode, "verify-full");
      const result = await connect(config);
      assert.ok(result.verified, `TLS was rejected: ${result.error?.code}`);
      assert.equal(matching.state.handshakes, before + 1);
    });

    await test("TLS host-name mismatch: rejected by verify-full, accepted by verify-ca", async () => {
      await expectHandshake(mismatched, { DATABASE_SSL: "verify-full", DATABASE_CA_CERT: certificates.ca }, false, "ERR_TLS_CERT_ALTNAME_INVALID");
      await expectHandshake(mismatched, { DATABASE_SSL: "verify-ca", DATABASE_CA_CERT: certificates.ca }, true);
    });

    await test("TLS require (legacy, unverified) still connects to an untrusted server", () =>
      expectHandshake(matching, { DATABASE_SSL: "require" }, true));
  } finally {
    await matching.close();
    await mismatched.close();
  }
}

console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped.`);
process.exit(failed === 0 ? 0 : 1);
