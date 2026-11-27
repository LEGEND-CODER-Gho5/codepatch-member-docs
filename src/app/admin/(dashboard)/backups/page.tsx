import { CircleAlert, CircleCheck, Download, FileSpreadsheet, FileJson, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import { BackUpNowButton } from "@/components/admin/backup-actions";
import { buttonStyles } from "@/components/ui/button";
import { Badge, EmptyState, PageHeader, Panel, tableStyles } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { formatCount, formatDateTime, formatDateTimeShort } from "@/lib/format";
import { requireAdminPage } from "@/lib/server/auth";
import { KEEP_DAILY_DAYS, KEEP_MONTHLY_MONTHS } from "@/lib/server/backup-data";
import {
  BACKUP_STALE_HOURS,
  backupStorageConfigured,
  countBackedUpRecords,
  getBackupStatus,
  isBackupStale,
  listSavedBackups,
  type SavedBackup,
} from "@/lib/server/backup-jobs";

export const metadata: Metadata = { title: "Backups" };

function formatSize(bytes: number | null | undefined): string {
  const value = Number(bytes ?? 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(value < 10 * 1024 ? 1 : 0)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export default async function BackupsPage() {
  await requireAdminPage();
  const configured = backupStorageConfigured();
  const [status, counts, saved] = await Promise.all([
    getBackupStatus(),
    countBackedUpRecords(),
    configured
      ? listSavedBackups().then(
          (list): SavedBackup[] | null => list,
          (error) => {
            console.error("[backups] could not list saved backups:", error instanceof Error ? error.message : error);
            return null;
          },
        )
      : Promise.resolve([] as SavedBackup[]),
  ]);
  const stale = configured && isBackupStale(status);

  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="Backups"
        description="Copies of everything in the portal, kept apart from the database, so no member's records or hours can be lost."
      />

      <div className="space-y-6">
        {configured && (
          <div
            className={cn(
              "flex items-start gap-3 rounded-lg border px-4 py-3 text-[13.5px]",
              stale || status?.lastError ? "border-amber-300 bg-amber-50 text-amber-900" : "border-emerald-200 bg-emerald-50 text-emerald-900",
            )}
            role="status"
          >
            {stale || status?.lastError ? (
              <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            ) : (
              <CircleCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
            )}
            <div className="min-w-0">
              {status?.lastSuccessAt ? (
                <p className="font-medium">
                  Last backup: {formatDateTime(status.lastSuccessAt)}
                  {status.lastBackupBytes ? ` (${formatSize(status.lastBackupBytes)})` : ""}
                </p>
              ) : (
                <p className="font-medium">No backup has been saved yet. The first automatic backup runs tonight at about 3 AM.</p>
              )}
              {stale && status?.lastSuccessAt && (
                <p className="mt-0.5">
                  That is more than {BACKUP_STALE_HOURS} hours ago. Press <strong>Back up now</strong>, and download a full backup to keep a copy yourself.
                </p>
              )}
              {status?.lastError && (
                <p className="mt-0.5">
                  The last attempt ({formatDateTimeShort(status.lastRunAt)}) failed: {status.lastError}
                </p>
              )}
              {!stale && !status?.lastError && (
                <p className="mt-0.5 text-emerald-800">A new backup is saved automatically every night at about 3 AM.</p>
              )}
            </div>
          </div>
        )}

        <Panel title="Download a copy" description="Made fresh from the live data when you press the button. Downloads are recorded in Edit History.">
          <div className="grid gap-px bg-zinc-200 md:grid-cols-2">
            <div className="flex flex-col gap-3 bg-white p-4">
              <div className="flex items-center gap-2 text-[14px] font-semibold text-zinc-900">
                <FileSpreadsheet className="size-4 text-emerald-700" aria-hidden />
                Spreadsheet
              </div>
              <p className="flex-1 text-[13px] text-zinc-600">
                Members, records, volunteer hours, contributions, meetings, attendance, and departments, one tab each. Opens in Excel or
                Google Sheets. Contains no passwords.
              </p>
              <div>
                <a href="/admin/backups/spreadsheet" className={buttonStyles({ variant: "secondary", size: "sm" })}>
                  <Download />
                  Download spreadsheet (.xlsx)
                </a>
              </div>
            </div>
            <div className="flex flex-col gap-3 bg-white p-4">
              <div className="flex items-center gap-2 text-[14px] font-semibold text-zinc-900">
                <FileJson className="size-4 text-brand-700" aria-hidden />
                Full backup
              </div>
              <p className="flex-1 text-[13px] text-zinc-600">
                Everything needed to rebuild the portal: {formatCount(counts.members)} member{counts.members === 1 ? "" : "s"},{" "}
                {formatCount(counts.hoursEntries)} hours entr{counts.hoursEntries === 1 ? "y" : "ies"}, and{" "}
                {formatCount(counts.historyEntries)} Edit History entr{counts.historyEntries === 1 ? "y" : "ies"}. Passwords are included
                only in scrambled (hashed) form, but keep this file private.
              </p>
              <div>
                <a href="/admin/backups/full" className={buttonStyles({ variant: "secondary", size: "sm" })}>
                  <Download />
                  Download full backup (.json)
                </a>
              </div>
            </div>
          </div>
        </Panel>

        <Panel
          title="Saved backups"
          description={`Stored privately in Vercel, separate from the database. Every backup from the last ${KEEP_DAILY_DAYS} days is kept, plus the first one of each month for ${KEEP_MONTHLY_MONTHS} months.`}
          actions={configured ? <BackUpNowButton /> : undefined}
          bodyClassName={tableStyles.wrapper}
        >
          {!configured ? (
            <EmptyState
              icon={<ShieldCheck />}
              title="Saved backups run on the live site"
              description="This copy of the portal has no backup storage connected. You can still download the spreadsheet and a full backup above."
            />
          ) : saved === null ? (
            <EmptyState icon={<CircleAlert />} title="The saved backups could not be listed" description="Reload the page in a minute." />
          ) : saved.length === 0 ? (
            <EmptyState icon={<ShieldCheck />} title="No saved backups yet" description="Press Back up now, or wait for tonight's automatic backup." />
          ) : (
            <table className={tableStyles.table}>
              <thead>
                <tr>
                  <th className={tableStyles.th}>Saved</th>
                  <th className={tableStyles.th}>Made by</th>
                  <th className={cn(tableStyles.th, "text-right")}>Size</th>
                  <th className={cn(tableStyles.th, "text-right")}>
                    <span className="sr-only">Download</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {saved.map((backup) => (
                  <tr key={backup.pathname} className={tableStyles.row}>
                    <td className={cn(tableStyles.td, "whitespace-nowrap")}>{formatDateTime(backup.createdAt)}</td>
                    <td className={tableStyles.td}>
                      {backup.source === "scheduled" ? <Badge>Automatic</Badge> : <Badge tone="brand">Back up now</Badge>}
                    </td>
                    <td className={cn(tableStyles.td, "tabular text-right whitespace-nowrap")}>{formatSize(backup.size)}</td>
                    <td className={cn(tableStyles.td, "text-right")}>
                      <a
                        href={`/admin/backups/saved?name=${encodeURIComponent(backup.pathname)}`}
                        className={buttonStyles({ variant: "ghost", size: "xs" })}
                      >
                        <Download />
                        Download
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel title="How backups protect the portal">
          <ul className="list-disc space-y-1.5 py-3 pr-4 pl-8 text-[13px] text-zinc-700">
            <li>Every night at about 3 AM, a full copy of the database is saved to private storage that only this site can read.</li>
            <li>
              The nightly backup also keeps the database awake. Supabase&apos;s free plan pauses a database after a quiet week, so school
              breaks no longer put the site to sleep.
            </li>
            <li>
              If the database is ever lost, a full backup rebuilds it in a new, empty database, including every member&apos;s password,
              hours, and Edit History. The steps are in the project README under &quot;Backups and restore&quot;.
            </li>
            <li>For a copy outside Vercel too, download a full backup now and then and keep it somewhere private, such as your own Google Drive.</li>
          </ul>
        </Panel>
      </div>
    </>
  );
}
