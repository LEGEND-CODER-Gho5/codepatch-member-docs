/**
 * Database configuration shared by the application (db.ts) and the command-line
 * scripts (scripts/*.mjs).
 *
 * It decides which database engine to use, enforces the production guard, and
 * builds the TLS options for PostgreSQL. It has no side effects and performs no
 * I/O of its own (file reads are injected), so it can be unit-tested.
 *
 * Rules for this file:
 * - It must stay importable by plain Node.js scripts: no "server-only" import,
 *   no relative imports, and only erasable TypeScript syntax.
 * - Error and warning messages must never contain connection strings,
 *   passwords, or certificate contents.
 */
import { X509Certificate } from "node:crypto";
import path from "node:path";
import type { ConnectionOptions } from "node:tls";

export type DatabaseEnvironment = Readonly<Record<string, string | undefined>>;

/**
 * TLS behaviour for PostgreSQL connections (libpq names):
 * - verify-full: encrypt, verify the certificate chain and the host name (default for remote hosts)
 * - verify-ca:   encrypt, verify the certificate chain only (requires a CA certificate)
 * - require:     encrypt without verifying the certificate (not recommended)
 * - disable:     no TLS (default for localhost)
 */
export type SslMode = "disable" | "require" | "verify-ca" | "verify-full";
export type CertificateSource = "DATABASE_CA_CERT" | "DATABASE_CA_CERT_FILE" | "system";

export type EmbeddedDatabaseConfig = {
  kind: "pglite";
  dataDir: string;
  autoMigrate: boolean;
  warnings: string[];
};

/** The Supabase project a connection URL points at. Never holds the user name or password. */
export type SupabaseProject = {
  /** The project ref, or null when a pooler URL's user name names no project (expected postgres.<project-ref>). */
  projectRef: string | null;
  connection: "pooler" | "direct";
};

export type DatabaseTarget = {
  host: string;
  port: string;
  database: string;
  /** Set only for Supabase hosts. */
  supabase: SupabaseProject | null;
};

export type PostgresDatabaseConfig = {
  kind: "postgres";
  /** DATABASE_URL with any TLS parameters removed (TLS comes only from `ssl`). */
  connectionString: string;
  ssl: false | ConnectionOptions;
  sslMode: SslMode;
  certificateSource: CertificateSource | null;
  poolMax: number;
  connectionTimeoutMillis: number;
  autoMigrate: boolean;
  target: DatabaseTarget;
  warnings: string[];
};

export type DatabaseConfig = EmbeddedDatabaseConfig | PostgresDatabaseConfig;

export type ResolveOptions = {
  /** Base directory for relative paths (normally process.cwd()). */
  cwd: string;
  /** Reads DATABASE_CA_CERT_FILE. Omit where file access is not wanted. */
  readFile?: (file: string) => string;
  /**
   * Skip the production guard for the embedded database. Only the command-line
   * scripts set this, after the operator explicitly passed --embedded.
   */
  allowEmbedded?: boolean;
};

export class DatabaseConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatabaseConfigError";
  }
}

/**
 * Connection-string parameters that control TLS in node-postgres. They are
 * removed because node-postgres lets them override the `ssl` option (for
 * example, `sslmode=require` would silently discard a custom CA certificate).
 */
const TLS_URL_PARAMETERS = [
  "sslmode",
  "ssl",
  "sslcert",
  "sslkey",
  "sslrootcert",
  "sslpassword",
  "sslcrl",
  "sslnegotiation",
  "sslcompression",
  "uselibpqcompat",
];

const PEM_BEGIN = "-----BEGIN CERTIFICATE-----";
const PEM_END = "-----END CERTIFICATE-----";

function readFlag(value: string | undefined, name: string, fallback: boolean): boolean {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return fallback;
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  throw new DatabaseConfigError(`${name} must be "true" or "false".`);
}

function readInteger(value: string | undefined, name: string, fallback: number, min: number, max: number): number {
  const normalized = value?.trim();
  if (!normalized) return fallback;
  const amount = Number(normalized);
  if (!Number.isInteger(amount) || amount < min || amount > max) {
    throw new DatabaseConfigError(`${name} must be a whole number between ${min} and ${max}.`);
  }
  return amount;
}

export function isLocalHost(host: string): boolean {
  const name = host.replace(/^\[|\]$/g, "").toLowerCase();
  return name === "localhost" || name.endsWith(".localhost") || name === "127.0.0.1" || name === "::1";
}

/**
 * Identifies the Supabase project behind a connection URL.
 * - Direct and dedicated-pooler hosts are db.<project-ref>.supabase.co.
 * - Supavisor pooler hosts (*.pooler.supabase.com) are shared by every project
 *   in a region; the project is named only by the user name, postgres.<project-ref>.
 * Returns null for hosts that are not Supabase's. Only the project ref is
 * returned, never the user name.
 */
export function identifySupabaseProject(host: string, user: string): SupabaseProject | null {
  const name = host.toLowerCase();
  const direct = /^db\.([a-z0-9]+)\.supabase\.co$/.exec(name);
  if (direct) return { projectRef: direct[1], connection: "direct" };
  if (name.endsWith(".pooler.supabase.com")) {
    const separator = user.lastIndexOf(".");
    const ref = separator === -1 ? "" : user.slice(separator + 1).toLowerCase();
    return { projectRef: /^[a-z0-9]+$/.test(ref) ? ref : null, connection: "pooler" };
  }
  return null;
}

/**
 * Validates DATABASE_URL and removes TLS parameters from it. The original value
 * is returned unchanged when there is nothing to remove.
 */
export function sanitizeConnectionString(value: string): {
  connectionString: string;
  urlSslMode: string | null;
  target: DatabaseTarget;
} {
  const trimmed = value.trim();
  if (trimmed.includes("#")) {
    // PostgreSQL URLs never contain a fragment: an unencoded "#" in a password
    // would silently cut the URL short and connect to the wrong host.
    throw new DatabaseConfigError(
      'DATABASE_URL is not a valid connection URL: it contains "#". Percent-encode special characters in the ' +
        "user name or password (for example # as %23, @ as %40).",
    );
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    // Deliberately do not include the input or the original error: both would
    // contain the password.
    throw new DatabaseConfigError(
      "DATABASE_URL is not a valid connection URL. Expected postgresql://user:password@host:port/database, " +
        "with special characters in the user name or password percent-encoded.",
    );
  }
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    throw new DatabaseConfigError("DATABASE_URL must start with postgresql:// or postgres://.");
  }
  if (!url.hostname) throw new DatabaseConfigError("DATABASE_URL must include a host name.");

  const urlSslMode = url.searchParams.get("sslmode")?.trim().toLowerCase() || null;
  let removed = false;
  for (const parameter of TLS_URL_PARAMETERS) {
    if (url.searchParams.has(parameter)) {
      url.searchParams.delete(parameter);
      removed = true;
    }
  }

  let database = url.pathname.replace(/^\//, "");
  try {
    database = decodeURIComponent(database);
  } catch {
    // Leave the raw value; node-postgres reports malformed names on connect.
  }
  let user = url.username;
  try {
    user = decodeURIComponent(user);
  } catch {
    // Leave the raw value; it is only used to find a Supabase project ref.
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");

  return {
    connectionString: removed ? url.toString() : trimmed,
    urlSslMode,
    target: { host, port: url.port || "5432", database: database || "postgres", supabase: identifySupabaseProject(host, user) },
  };
}

/**
 * Accepts a PEM certificate (or bundle) in the forms environment variables tend
 * to mangle it into — real newlines, literal "\n", collapsed spaces, wrapping
 * quotes, or base64 — and returns canonical PEM. Every certificate is parsed so
 * mistakes are reported at startup instead of as an obscure TLS error.
 */
export function normalizeCertificate(raw: string, sourceName: string): string {
  let text = raw.trim().replace(/\\r\\n|\\n/g, "\n").replace(/\r\n?/g, "\n");
  if (text.length >= 2 && ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'")))) {
    text = text.slice(1, -1).trim();
  }
  if (!text.includes(PEM_BEGIN)) {
    const decoded = Buffer.from(text.replace(/\s+/g, ""), "base64").toString("utf8");
    if (!decoded.includes(PEM_BEGIN)) {
      throw new DatabaseConfigError(`${sourceName} must contain a PEM certificate ("${PEM_BEGIN}"), optionally base64-encoded.`);
    }
    text = decoded;
  }

  const blocks = text.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) ?? [];
  if (blocks.length === 0) {
    throw new DatabaseConfigError(`${sourceName} must contain a complete PEM certificate ("${PEM_BEGIN}" … "${PEM_END}").`);
  }
  const canonical = blocks.map((block) => {
    const body = block.slice(PEM_BEGIN.length, block.length - PEM_END.length).replace(/\s+/g, "");
    const pem = `${PEM_BEGIN}\n${(body.match(/.{1,64}/g) ?? []).join("\n")}\n${PEM_END}`;
    try {
      new X509Certificate(pem);
    } catch {
      throw new DatabaseConfigError(`${sourceName} contains a certificate that could not be parsed.`);
    }
    return pem;
  });
  return `${canonical.join("\n")}\n`;
}

function parseSslSetting(value: string): SslMode {
  switch (value.trim().toLowerCase()) {
    case "disable":
      return "disable";
    case "require":
    case "no-verify":
      return "require";
    case "verify-ca":
      return "verify-ca";
    case "verify-full":
    case "verify": // accepted for backward compatibility
      return "verify-full";
    default:
      throw new DatabaseConfigError("DATABASE_SSL must be one of: verify-full, verify-ca, require, disable.");
  }
}

/**
 * Interprets an sslmode found in DATABASE_URL. "prefer" and "require" are
 * treated as verify-full, which matches node-postgres 8 and keeps the
 * connection verified; an explicit DATABASE_SSL always takes precedence.
 */
function parseUrlSslMode(value: string): SslMode {
  switch (value) {
    case "disable":
      return "disable";
    case "no-verify":
      return "require";
    case "allow":
    case "prefer":
    case "require":
    case "verify-full":
      return "verify-full";
    case "verify-ca":
      return "verify-ca";
    default:
      throw new DatabaseConfigError(
        "DATABASE_URL contains an unsupported sslmode. Remove it and use DATABASE_SSL (verify-full, verify-ca, require, or disable).",
      );
  }
}

function loadCertificate(
  env: DatabaseEnvironment,
  options: ResolveOptions,
): { ca: string | undefined; source: CertificateSource | null } {
  const inline = env.DATABASE_CA_CERT?.trim();
  const file = env.DATABASE_CA_CERT_FILE?.trim();
  if (inline && file) {
    throw new DatabaseConfigError("Set only one of DATABASE_CA_CERT or DATABASE_CA_CERT_FILE.");
  }
  if (inline) return { ca: normalizeCertificate(inline, "DATABASE_CA_CERT"), source: "DATABASE_CA_CERT" };
  if (file) {
    if (!options.readFile) throw new DatabaseConfigError("DATABASE_CA_CERT_FILE is not supported here; use DATABASE_CA_CERT.");
    let content: string;
    try {
      content = options.readFile(path.resolve(/*turbopackIgnore: true*/ options.cwd, file));
    } catch {
      throw new DatabaseConfigError(`DATABASE_CA_CERT_FILE (${file}) could not be read. Check that the file exists.`);
    }
    return { ca: normalizeCertificate(content, "DATABASE_CA_CERT_FILE"), source: "DATABASE_CA_CERT_FILE" };
  }
  return { ca: undefined, source: null };
}

/**
 * Resolves the database configuration from environment variables.
 * Throws DatabaseConfigError with an actionable, secret-free message.
 */
export function resolveDatabaseConfig(env: DatabaseEnvironment, options: ResolveOptions): DatabaseConfig {
  const production = env.NODE_ENV === "production";
  const url = env.DATABASE_URL?.trim();
  // Automatic migration is a convenience for the embedded development database
  // only. Any PostgreSQL database (Supabase, staging, production, or local) is
  // migrated deliberately with `npm run db:migrate`, in every environment,
  // unless DATABASE_AUTO_MIGRATE=true is set explicitly.
  const autoMigrate = readFlag(env.DATABASE_AUTO_MIGRATE, "DATABASE_AUTO_MIGRATE", !url && !production);

  if (!url) {
    if (!options.allowEmbedded) {
      if (env.VERCEL) {
        throw new DatabaseConfigError(
          "DATABASE_URL is not set. Vercel deployments cannot use the embedded development database: the file system is " +
            "read-only and every instance would get its own copy. Set DATABASE_URL to your PostgreSQL (for example Supabase) connection string.",
        );
      }
      if (production && !readFlag(env.ALLOW_EMBEDDED_DATABASE, "ALLOW_EMBEDDED_DATABASE", false)) {
        throw new DatabaseConfigError(
          "DATABASE_URL is not set. Refusing to fall back to the embedded development database in production. " +
            "Set DATABASE_URL, or set ALLOW_EMBEDDED_DATABASE=true only for a single-server deployment that intentionally uses the embedded database.",
        );
      }
    }
    const dataDir = path.resolve(
      /*turbopackIgnore: true*/ options.cwd,
      env.PGLITE_DATA_DIR?.trim() || path.join(".data", "pglite"),
    );
    return { kind: "pglite", dataDir, autoMigrate, warnings: [] };
  }

  const { connectionString, urlSslMode, target } = sanitizeConnectionString(url);
  const warnings: string[] = [];

  const explicitSsl = env.DATABASE_SSL?.trim();
  const sslMode: SslMode = explicitSsl
    ? parseSslSetting(explicitSsl)
    : urlSslMode
      ? parseUrlSslMode(urlSslMode)
      : isLocalHost(target.host)
        ? "disable"
        : "verify-full";

  const { ca, source } = loadCertificate(env, options);
  let ssl: false | ConnectionOptions;
  let certificateSource: CertificateSource | null = null;

  switch (sslMode) {
    case "disable":
      ssl = false;
      if (ca) warnings.push("A CA certificate is configured but TLS is disabled (DATABASE_SSL=disable); the certificate is ignored.");
      if (!isLocalHost(target.host)) warnings.push("TLS is disabled for a remote database host. Database traffic is not encrypted.");
      break;
    case "require":
      ssl = { rejectUnauthorized: false };
      warnings.push("DATABASE_SSL=require encrypts the connection but does not verify the server certificate.");
      if (ca) warnings.push("A CA certificate is configured but is not used because certificate verification is off.");
      break;
    case "verify-ca":
      if (!ca) {
        throw new DatabaseConfigError(
          "DATABASE_SSL=verify-ca requires the server's CA certificate in DATABASE_CA_CERT or DATABASE_CA_CERT_FILE.",
        );
      }
      // Verify the chain against the configured CA but skip the host-name check.
      ssl = { rejectUnauthorized: true, ca, checkServerIdentity: () => undefined };
      certificateSource = source;
      break;
    case "verify-full":
      ssl = ca ? { rejectUnauthorized: true, ca } : { rejectUnauthorized: true };
      certificateSource = source ?? "system";
      break;
  }

  return {
    kind: "postgres",
    connectionString,
    ssl,
    sslMode,
    certificateSource,
    poolMax: readInteger(env.DATABASE_POOL_MAX, "DATABASE_POOL_MAX", env.VERCEL ? 3 : 5, 1, 50),
    connectionTimeoutMillis: readInteger(env.DATABASE_CONNECT_TIMEOUT_MS, "DATABASE_CONNECT_TIMEOUT_MS", 10_000, 1_000, 120_000),
    autoMigrate,
    target,
    warnings,
  };
}

/**
 * Human-readable description of the target with no credentials. For Supabase it
 * names the project, because pooler host names are shared by every project in
 * a region and would otherwise look identical for staging and production.
 */
export function describeDatabaseTarget(config: DatabaseConfig): string {
  if (config.kind === "pglite") return `embedded PostgreSQL (PGlite) at ${config.dataDir}`;
  const { host, port, database, supabase } = config.target;
  const project = supabase
    ? `, Supabase project ${supabase.projectRef ?? "unknown (the user name should be postgres.<project-ref>)"}`
    : "";
  const certificate =
    config.sslMode === "verify-full" || config.sslMode === "verify-ca"
      ? config.certificateSource === "system"
        ? ", system CA store"
        : `, CA from ${config.certificateSource}`
      : "";
  return `PostgreSQL at ${host}:${port}/${database}${project} (TLS ${config.sslMode}${certificate})`;
}

const TLS_VERIFICATION_CODES = new Set([
  "SELF_SIGNED_CERT_IN_CHAIN",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "CERT_UNTRUSTED",
  "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID",
  "CERT_SIGNATURE_FAILURE",
  "ERR_TLS_CERT_ALTNAME_INVALID",
]);

export function isTlsVerificationError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && TLS_VERIFICATION_CODES.has(code);
}

/**
 * Adds an actionable explanation to common connection failures. The original
 * error is kept as `cause`; the new message never includes credentials.
 * Errors without a known explanation are returned unchanged.
 */
export function explainDatabaseError(error: unknown, config: PostgresDatabaseConfig): Error {
  const code = String((error as { code?: unknown } | null)?.code ?? "");
  const message = error instanceof Error ? error.message : String(error);
  const host = config.target.host.toLowerCase();
  const supabase = host.endsWith(".supabase.co") || host.endsWith(".supabase.com");
  let hint: string | null = null;

  if (code === "ERR_TLS_CERT_ALTNAME_INVALID") {
    hint =
      "the server certificate does not match the host name in DATABASE_URL. Check the host, or use DATABASE_SSL=verify-ca " +
      "(verifies the certificate chain against DATABASE_CA_CERT without the host-name check).";
  } else if (TLS_VERIFICATION_CODES.has(code)) {
    hint =
      config.certificateSource === "system" || !config.certificateSource
        ? "the server's TLS certificate is not signed by a trusted certificate authority. " +
          (supabase
            ? "Supabase uses its own certificate authority: download the CA certificate from your project's Database settings " +
              "(SSL Configuration) and provide it in DATABASE_CA_CERT or DATABASE_CA_CERT_FILE."
            : "Provide the server's CA certificate in DATABASE_CA_CERT or DATABASE_CA_CERT_FILE.")
        : `the server's TLS certificate could not be verified with the CA certificate from ${config.certificateSource}. ` +
          "Check that it is the correct certificate for this database.";
  } else if (/does not support ssl/i.test(message)) {
    hint = "the server does not accept TLS connections. Use DATABASE_SSL=disable only for a local or private network.";
  } else if (code === "ENETUNREACH" || code === "EHOSTUNREACH" || (code === "ENOTFOUND" && supabase && host.startsWith("db."))) {
    hint =
      supabase && host.startsWith("db.")
        ? "Supabase direct connections (db.<project-ref>.supabase.co) use IPv6. From IPv4-only networks such as Vercel, " +
          "use the Supavisor pooler connection string instead."
        : "the database host is unreachable from this network.";
  } else if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    hint = "the database host name could not be resolved. Check the host in DATABASE_URL.";
  } else if (code === "ECONNREFUSED" || code === "ETIMEDOUT" || (!/^[0-9A-Z]{5}$/.test(code) && /timeout/i.test(message))) {
    // Errors with a PostgreSQL SQLSTATE (such as 55P03 "canceling statement due
    // to lock timeout") come from a working connection and keep their own message.
    hint = "the database did not accept the connection in time. Check the host and port in DATABASE_URL and that the database is running.";
  } else if (code === "28P01") {
    hint = "password authentication failed. Check the password in DATABASE_URL and percent-encode special characters.";
  } else if (/tenant or user not found/i.test(message)) {
    hint = "Supabase's pooler did not recognize the user. Pooler connection strings use the user name postgres.<project-ref>.";
  }

  if (!hint) return error instanceof Error ? error : new Error(message);
  const explained = new Error(`Could not connect to the database${code ? ` (${code})` : ""}: ${hint}`, { cause: error });
  explained.name = "DatabaseConnectionError";
  return explained;
}
