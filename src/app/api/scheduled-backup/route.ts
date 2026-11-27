import { handleSchedule } from "@vercel/schedules";
import { runSavedBackup } from "@/lib/server/backup-jobs";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The nightly "daily-backup" schedule (vercel.json). This function has the
 * schedule/v1beta trigger, so it is private: only Vercel's scheduler can call
 * it. It saves a full backup to the private Blob store and, by reading and
 * writing the database every night, keeps a free Supabase project from pausing.
 * A repeated delivery on the same night makes no second copy (see runSavedBackup).
 */
export const POST = handleSchedule(async (metadata) => {
  const result = await runSavedBackup("scheduled");
  console.log(
    result.status === "saved"
      ? `[backup] ${metadata.name} ${metadata.executionId}: saved ${result.pathname} (${result.bytes} bytes), removed ${result.removed} old copies`
      : `[backup] ${metadata.name} ${metadata.executionId}: skipped, last backup ${result.lastSuccessAt}`,
  );
});
