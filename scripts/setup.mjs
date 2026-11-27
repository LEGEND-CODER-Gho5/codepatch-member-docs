// Creates .env.local with strong initial passwords for the shared website
// password and the administrator password. Run once: `npm run setup`.
// The values are only used to initialize the database on first start; after
// that, change passwords from Admin → Settings.
import { randomInt } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const envPath = path.join(process.cwd(), ".env.local");
const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";

if (/^INITIAL_ADMIN_PASSWORD=/m.test(existing)) {
  console.log(".env.local already defines the initial passwords — nothing to do.");
  process.exit(0);
}

const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
function generate(groups) {
  for (;;) {
    const chars = Array.from({ length: groups * 4 }, () => alphabet[randomInt(alphabet.length)]);
    const value = chars.join("");
    if (/[A-Z]/.test(value) && /[a-z]/.test(value) && /[2-9]/.test(value)) {
      return chars.join("").match(/.{4}/g).join("-");
    }
  }
}

const site = generate(3);
const admin = generate(4);

const block = `
# --- Code Patch STEM member documentation ---------------------------------
# Initial credentials. Used ONCE to initialize the database (stored only as
# scrypt hashes). Change them afterwards in Admin -> Settings.
INITIAL_SITE_PASSWORD=${site}
INITIAL_ADMIN_PASSWORD=${admin}

# Leave DATABASE_URL unset to use the embedded PostgreSQL database stored in
# ./.data/pglite. For Supabase/hosted PostgreSQL, set the connection string:
# DATABASE_URL=postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
`;

fs.appendFileSync(envPath, block, { mode: 0o600 });
console.log("Wrote initial credentials to .env.local");
console.log("  Shared website password:", site);
console.log("  Administrator password:  ", admin);
console.log("Start the app with `npm run dev`, then sign in at http://localhost:3000.");
