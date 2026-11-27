"use server";

import { getAdminActor } from "@/lib/server/auth";
import { backupStorageConfigured, runSavedBackup } from "@/lib/server/backup-jobs";
import type { ActionResult } from "@/lib/types";
import { fail, UNAUTHORIZED } from "./shared";

/** Admin → Backups → Back up now: saves a full backup to the private store immediately. */
export async function backUpNowAction(): Promise<ActionResult<{ pathname: string; bytes: number }>> {
  const actor = await getAdminActor();
  if (!actor) return UNAUTHORIZED;
  if (!backupStorageConfigured()) {
    return fail("Saved backups work only on the live site. You can still download a full backup or the spreadsheet here.", "invalid");
  }
  try {
    const result = await runSavedBackup("manual", actor);
    if (result.status !== "saved") return fail("The backup was not saved. Please try again.");
    return { ok: true, data: { pathname: result.pathname, bytes: result.bytes } };
  } catch (error) {
    console.error("[action:backUpNow]", error instanceof Error ? error.message : error);
    return fail("The backup could not be saved. Please try again in a minute; if it keeps failing, download a full backup instead.");
  }
}
