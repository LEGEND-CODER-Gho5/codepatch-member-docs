import "server-only";
import { del, get, list, put } from "@vercel/blob";
import { recordAudit, type Actor } from "./audit";
import { createBackup, savedBackupDate, savedBackupName, selectBackupsToDelete, SAVED_BACKUP_PATTERN, type BackupFile } from "./backup-data";
import { getDb, sql, sqlOne, withTransaction } from "./db";

/**
 * Saved backups (Admin → Backups): a full backup is written every night by the
 * "daily-backup" schedule (vercel.json → src/app/api/scheduled-backup) and on
 * "Back up now", into a private Vercel Blob store that only this application
 * can read. Older copies are removed by the retention rule in backup-data.ts.
 *
 * The nightly run also keeps the database awake: it reads every table and
 * writes to maintenance_status, so a free Supabase project never sees a week
 * without activity.
 */

const PREFIX = "backups/";
/** A scheduled run makes no new copy within this many hours of a successful one (repeated deliveries become no-ops). */
const SCHEDULED_MIN_GAP_HOURS = 20;
/** The status page warns when the last successful backup is older than this. */
export const BACKUP_STALE_HOURS = 48;

const SYSTEM_ACTOR: Actor = { type: "system", id: "backup", name: "Automatic backup" };

/** True when this server has a Blob store connected (BLOB_STORE_ID with OIDC, or a read-write token). */
export function backupStorageConfigured(): boolean {
  return Boolean(process.env.BLOB_STORE_ID?.trim() || process.env.BLOB_READ_WRITE_TOKEN?.trim());
}

export async function makeFullBackup(source: string): Promise<{ backup: BackupFile; json: string }> {
  const backup = await createBackup(await getDb(), source);
  return { backup, json: JSON.stringify(backup) };
}

export type SavedBackup = {
  pathname: string;
  size: number;
  createdAt: string;
  source: "scheduled" | "manual";
};

export async function listSavedBackups(): Promise<SavedBackup[]> {
  const saved: SavedBackup[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: PREFIX, cursor, limit: 1000 });
    for (const blob of page.blobs) {
      const match = SAVED_BACKUP_PATTERN.exec(blob.pathname);
      const date = savedBackupDate(blob.pathname);
      if (!match || !date) continue;
      saved.push({
        pathname: blob.pathname,
        size: blob.size,
        createdAt: date.toISOString(),
        source: match[7] as SavedBackup["source"],
      });
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return saved.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Opens a saved backup for download, or null if the name is not a saved backup. */
export async function openSavedBackup(pathname: string): Promise<ReadableStream<Uint8Array> | null> {
  if (!SAVED_BACKUP_PATTERN.test(pathname)) return null;
  const result = await get(pathname, { access: "private" });
  if (!result || result.statusCode !== 200) return null;
  return result.stream;
}

export type BackupStatus = {
  lastRunAt: string;
  lastSuccessAt: string | null;
  lastError: string | null;
  lastBackupName: string | null;
  lastBackupBytes: number | null;
};

export async function getBackupStatus(): Promise<BackupStatus | null> {
  const row = await sqlOne<{
    last_run_at: Date;
    last_success_at: Date | null;
    last_error: string | null;
    last_backup_name: string | null;
    last_backup_bytes: number | null;
  }>("SELECT last_run_at, last_success_at, last_error, last_backup_name, last_backup_bytes FROM maintenance_status WHERE job = 'daily_backup'");
  if (!row) return null;
  return {
    lastRunAt: new Date(row.last_run_at).toISOString(),
    lastSuccessAt: row.last_success_at ? new Date(row.last_success_at).toISOString() : null,
    lastError: row.last_error,
    lastBackupName: row.last_backup_name,
    lastBackupBytes: row.last_backup_bytes === null ? null : Number(row.last_backup_bytes),
  };
}

/** True when automatic backups are set up but none has succeeded recently. */
export function isBackupStale(status: BackupStatus | null, now = Date.now()): boolean {
  if (!status?.lastSuccessAt) return status !== null;
  return now - new Date(status.lastSuccessAt).getTime() > BACKUP_STALE_HOURS * 3_600_000;
}

/** A short, credential-free reason for the status page. */
function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/postgres(ql)?:\/\/\S+/gi, "[connection string]").slice(0, 300) || "Unknown error";
}

async function pruneSavedBackups(): Promise<number> {
  const saved = await listSavedBackups();
  const doomed = selectBackupsToDelete(
    saved.map((backup) => backup.pathname),
    new Date(),
  );
  if (doomed.length > 0) await del(doomed);
  return doomed.length;
}

export type SavedBackupResult =
  | { status: "saved"; pathname: string; bytes: number; removed: number }
  | { status: "skipped"; lastSuccessAt: string };

/**
 * Makes a full backup and saves it to the Blob store, then removes copies the
 * retention rule no longer keeps. Records the outcome in maintenance_status.
 * A scheduled run within SCHEDULED_MIN_GAP_HOURS of a successful backup only
 * records that it ran.
 */
export async function runSavedBackup(source: "scheduled" | "manual", actor: Actor = SYSTEM_ACTOR): Promise<SavedBackupResult> {
  if (!backupStorageConfigured()) {
    throw new Error("Backup storage is not set up on this server (no Vercel Blob store is connected).");
  }

  if (source === "scheduled") {
    const recent = await sqlOne<{ last_success_at: Date }>(
      `UPDATE maintenance_status SET last_run_at = now()
        WHERE job = 'daily_backup' AND last_success_at > now() - make_interval(hours => $1)
        RETURNING last_success_at`,
      [SCHEDULED_MIN_GAP_HOURS],
    );
    if (recent) return { status: "skipped", lastSuccessAt: new Date(recent.last_success_at).toISOString() };
  }

  try {
    const { json } = await makeFullBackup(source);
    const pathname = savedBackupName(new Date(), source);
    const bytes = Buffer.byteLength(json, "utf8");
    await put(pathname, json, { access: "private", contentType: "application/json", addRandomSuffix: false });
    const removed = await pruneSavedBackups();

    await withTransaction(async (tx) => {
      await tx.query(
        `INSERT INTO maintenance_status (job, last_run_at, last_success_at, last_error, last_backup_name, last_backup_bytes)
         VALUES ('daily_backup', now(), now(), NULL, $1, $2)
         ON CONFLICT (job) DO UPDATE
           SET last_run_at = now(), last_success_at = now(), last_error = NULL, last_backup_name = $1, last_backup_bytes = $2`,
        [pathname, bytes],
      );
      if (source === "manual") {
        await recordAudit(tx, {
          actor,
          action: "created",
          entityType: "backup",
          recordId: pathname,
          summary: "Saved a backup now",
          next: { backup: pathname, size: bytes },
        });
      }
    });
    return { status: "saved", pathname, bytes, removed };
  } catch (error) {
    const reason = describeError(error);
    console.error(`[backup] ${source} backup failed: ${reason}`);
    await withTransaction(async (tx) => {
      await tx.query(
        `INSERT INTO maintenance_status (job, last_run_at, last_error) VALUES ('daily_backup', now(), $1)
         ON CONFLICT (job) DO UPDATE SET last_run_at = now(), last_error = $1`,
        [reason],
      );
      if (source === "scheduled") {
        await recordAudit(tx, {
          actor: SYSTEM_ACTOR,
          action: "failed",
          entityType: "backup",
          summary: "The automatic backup failed",
          next: { error: reason },
          notification: {
            type: "backup.failed",
            description: "Tonight's automatic backup failed. Open Backups to see why and to back up now.",
            link: "/admin/backups",
          },
          realtime: ["admin"],
        });
      }
    }).catch((statusError) => console.error(`[backup] could not record the failure: ${describeError(statusError)}`));
    throw error;
  }
}

/** Records an administrator's download of a backup or export in Edit History. */
export async function recordBackupDownload(actor: Actor, summary: string, details: Record<string, unknown>): Promise<void> {
  await withTransaction((tx) =>
    recordAudit(tx, { actor, action: "downloaded", entityType: "backup", summary, next: details }),
  );
}

/** Row counts for the status page (what a backup currently holds). */
export async function countBackedUpRecords(): Promise<{ members: number; hoursEntries: number; historyEntries: number }> {
  const [row] = await sql<{ members: number; hours: number; history: number }>(
    `SELECT (SELECT count(*) FROM members) AS members,
            (SELECT count(*) FROM volunteer_hours) AS hours,
            (SELECT count(*) FROM audit_logs) AS history`,
  );
  return { members: Number(row?.members ?? 0), hoursEntries: Number(row?.hours ?? 0), historyEntries: Number(row?.history ?? 0) };
}
