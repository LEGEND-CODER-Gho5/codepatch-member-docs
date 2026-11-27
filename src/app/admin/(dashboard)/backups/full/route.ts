import { makeFullBackup, recordBackupDownload } from "@/lib/server/backup-jobs";
import { downloadHeaders, requireAdminDownload } from "@/lib/server/download-guard";
import { todayInAppTimeZone } from "@/lib/format";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Admin → Backups → Download full backup: a fresh copy of everything needed to rebuild the portal. */
export async function GET(request: Request) {
  const guard = await requireAdminDownload(request);
  if ("response" in guard) return guard.response;

  const { backup, json } = await makeFullBackup("download");
  const body = Buffer.from(json, "utf8");
  const filename = `code-patch-stem-backup-${todayInAppTimeZone()}.json`;
  await recordBackupDownload(guard.actor, "Downloaded a full backup", {
    file: filename,
    size: body.length,
    members: backup.counts.members,
  });
  return new Response(new Uint8Array(body), { headers: downloadHeaders(filename, "application/json", body.length) });
}
