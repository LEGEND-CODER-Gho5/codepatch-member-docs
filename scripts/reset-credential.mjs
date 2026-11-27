// Emergency recovery for the shared website password or administrator password.
//   npm run credentials:reset -- site
//   npm run credentials:reset -- admin
//   npm run credentials:reset -- admin --env-file .env.supabase.local --confirm-target <project-ref>
// Generates a new random password, stores only its scrypt hash, signs out the
// affected sessions, and writes an audit record.
// With DATABASE_URL set (shell environment or --env-file) it connects with the
// same TLS verification as the application. Without it, it uses the embedded
// database — stop `npm run dev` first (it allows one process at a time).
// Target safety, checked before connecting (see scripts/lib/cli.mjs): with
// --env-file no DATABASE_* setting may also be set in the shell, and a database
// that is not on this machine needs --confirm-target (the Supabase project ref,
// or the host name for other servers).
import { randomBytes, randomInt, scrypt } from "node:crypto";
import fs from "node:fs";
import { describeDatabaseTarget, explainDatabaseError, resolveDatabaseConfig } from "../src/lib/server/db-config.ts";
import { UsageError, checkTargetConfirmation, loadEnvironment, parseArguments } from "./lib/cli.mjs";

const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
function generate(groups) {
  for (;;) {
    const chars = Array.from({ length: groups * 4 }, () => alphabet[randomInt(alphabet.length)]);
    const value = chars.join("");
    if (/[A-Z]/.test(value) && /[a-z]/.test(value) && /[2-9]/.test(value)) return value.match(/.{4}/g).join("-");
  }
}

function hash(password) {
  const salt = randomBytes(16);
  return new Promise((resolve, reject) =>
    scrypt(password.normalize("NFKC"), salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) =>
      error ? reject(error) : resolve(["scrypt", 16384, 8, 1, salt.toString("base64"), key.toString("base64")].join("$")),
    ),
  );
}

async function main() {
  const { options, positionals } = parseArguments(process.argv.slice(2), { options: ["env-file", "confirm-target"] });
  const kind = positionals[0];
  if (kind !== "site" && kind !== "admin") {
    throw new UsageError("Usage: npm run credentials:reset -- site|admin [--env-file <file>] [--confirm-target <project-ref | host>]");
  }

  const { env } = loadEnvironment(process.cwd(), options["env-file"]);
  // An explicit recovery command, so the embedded database is allowed here
  // (as before); the production guard applies to the running application.
  const config = resolveDatabaseConfig(env, {
    cwd: process.cwd(),
    readFile: (file) => fs.readFileSync(file, "utf8"),
    allowEmbedded: true,
  });
  console.log(`Target: ${describeDatabaseTarget(config)}`);
  for (const warning of config.warnings) console.warn(`Warning: ${warning}`);
  const confirmation = checkTargetConfirmation(config, options["confirm-target"], { required: true, command: "credentials:reset" });
  if (confirmation.confirmed) console.log(`Target confirmed: ${confirmation.label} ${confirmation.name}`);

  let run;
  let close;
  if (config.kind === "postgres") {
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
    run = (text, params) => client.query(text, params);
    close = () => client.end();
  } else {
    const { PGlite } = await import("@electric-sql/pglite");
    if (!fs.existsSync(config.dataDir)) {
      throw new UsageError(`No database found at ${config.dataDir}. Start the app once first.`);
    }
    const db = await PGlite.create(config.dataDir);
    run = (text, params) => db.query(text, params);
    close = () => db.close();
  }

  const password = generate(kind === "site" ? 3 : 4);
  const passwordHash = await hash(password);
  const column = kind === "site" ? "site_password" : "admin_password";

  try {
    const result = await run(
      `UPDATE application_settings SET ${column}_hash = $1, ${column}_version = ${column}_version + 1, ${column}_changed_at = now(), updated_at = now() WHERE id = 1`,
      [passwordHash],
    );
    if ((result.affectedRows ?? result.rowCount) !== 1) {
      throw new UsageError("The application has not been initialized yet. Start it once with the INITIAL_* passwords set.");
    }
    await run("DELETE FROM sessions WHERE kind = $1", [kind]);
    await run(
      `INSERT INTO audit_logs (actor_type, actor_id, actor_name, action, entity_type, record_id, summary, new_values)
       VALUES ('system', 'cli', 'Command line', 'password_reset', 'settings', $1, $2, $3::jsonb)`,
      [
        column,
        kind === "site" ? "Reset the shared website password from the command line" : "Reset the administrator password from the command line",
        JSON.stringify({ [column]: "Changed (not stored in readable form)" }),
      ],
    );
  } finally {
    await close();
  }
  console.log(`New ${kind === "site" ? "shared website" : "administrator"} password: ${password}`);
  console.log("Existing sessions of that type were signed out.");
}

main().catch((error) => {
  console.error(`Error: ${error?.message ?? String(error)}`);
  process.exitCode = 1;
});
