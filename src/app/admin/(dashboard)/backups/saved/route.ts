import { backupStorageConfigured, openSavedBackup, recordBackupDownload } from "@/lib/server/backup-jobs";
import { savedBackupDate } from "@/lib/server/backup-data";
import { downloadHeaders, requireAdminDownload } from "@/lib/server/download-guard";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ISO_DAY_IN_NEW_YORK = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Admin → Backups → a saved (automatic or "Back up now") backup: /admin/backups/saved?name=backups/… */
export async function GET(request: Request) {
  const guard = await requireAdminDownload(request);
  if ("response" in guard) return guard.response;

  const pathname = new URL(request.url).searchParams.get("name") ?? "";
  const date = savedBackupDate(pathname);
  if (!backupStorageConfigured() || !date) return new Response("Backup not found.", { status: 404, headers: { "Cache-Control": "no-store" } });

  const stream = await openSavedBackup(pathname);
  if (!stream) return new Response("Backup not found.", { status: 404, headers: { "Cache-Control": "no-store" } });

  // e.g. code-patch-stem-backup-2026-11-27-080012Z.json (calendar day in New York, time in UTC as in the stored name)
  const filename = `code-patch-stem-backup-${ISO_DAY_IN_NEW_YORK.format(date)}-${pathname.slice(17, 24)}.json`;
  await recordBackupDownload(guard.actor, "Downloaded a saved backup", { backup: pathname });
  return new Response(stream, { headers: downloadHeaders(filename, "application/json") });
}
