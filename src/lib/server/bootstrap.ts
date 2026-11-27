import "server-only";
import { withTransaction } from "./db";
import { hashPassword } from "./security";
import { recordAudit } from "./audit";
import { DEFAULT_CHAPTER_NAME } from "@/lib/document-text";

// Initial configuration only — the administrator can rename, add, or remove
// departments and positions afterwards. No member records are ever seeded.
const DEFAULT_DEPARTMENTS = ["Coding Department", "Marketing Department", "Math Department"];
const DEFAULT_POSITIONS = ["President", "Vice President", "Secretary", "Treasurer", "Department Lead", "Member"];

let pending: Promise<boolean> | null = null;

/**
 * Creates the settings row from INITIAL_SITE_PASSWORD / INITIAL_ADMIN_PASSWORD
 * the first time the app starts. Afterwards the hashed values in the database
 * are authoritative and the environment variables are ignored.
 */
export function bootstrapIfPossible(): Promise<boolean> {
  if (!pending) {
    pending = run().finally(() => {
      pending = null;
    });
  }
  return pending;
}

async function run(): Promise<boolean> {
  const sitePassword = process.env.INITIAL_SITE_PASSWORD ?? "";
  const adminPassword = process.env.INITIAL_ADMIN_PASSWORD ?? "";
  if (sitePassword.length < 8 || adminPassword.length < 10 || sitePassword === adminPassword) {
    return false;
  }
  const [siteHash, adminHash] = await Promise.all([hashPassword(sitePassword), hashPassword(adminPassword)]);

  return withTransaction(async (tx) => {
    const inserted = await tx.query(
      // The chapter name is set here rather than taken from the column default in migration 1,
      // which still holds the original name (applied migrations are never edited).
      `INSERT INTO application_settings (id, site_password_hash, admin_password_hash, chapter_name)
       VALUES (1, $1, $2, $3) ON CONFLICT (id) DO NOTHING RETURNING id`,
      [siteHash, adminHash, DEFAULT_CHAPTER_NAME],
    );
    if (inserted.length === 0) return true;

    const [{ count: departmentCount }] = await tx.query<{ count: number }>("SELECT count(*)::int AS count FROM departments");
    if (departmentCount === 0) {
      for (const [index, name] of DEFAULT_DEPARTMENTS.entries()) {
        await tx.query("INSERT INTO departments (name, sort_order) VALUES ($1, $2)", [name, index + 1]);
      }
    }
    const [{ count: positionCount }] = await tx.query<{ count: number }>("SELECT count(*)::int AS count FROM positions");
    if (positionCount === 0) {
      for (const [index, name] of DEFAULT_POSITIONS.entries()) {
        await tx.query("INSERT INTO positions (name, sort_order) VALUES ($1, $2)", [name, index + 1]);
      }
    }

    await recordAudit(tx, {
      actor: { type: "system", id: null, name: "System" },
      action: "initialized",
      entityType: "settings",
      summary: "Initialized application settings, default departments, and positions",
      next: { departments: DEFAULT_DEPARTMENTS, positions: DEFAULT_POSITIONS },
      realtime: ["directory"],
    });
    return true;
  });
}
