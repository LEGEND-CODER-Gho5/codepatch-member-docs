import { BadgeCheck, CircleAlert, FileClock } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ActivityList } from "@/components/admin/activity-list";
import { HoursChart } from "@/components/admin/hours-chart";
import { SeasonBanner } from "@/components/season/season-banner";
import { CountUp } from "@/components/ui/count-up";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader, Panel, tableStyles } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { formatCount, formatDateTime, formatHours, formatWeekdayDate, greeting } from "@/lib/format";
import { requireAdminPage } from "@/lib/server/auth";
import { backupStorageConfigured, getBackupStatus, isBackupStale } from "@/lib/server/backup-jobs";
import { getMonthlyHours, getOverviewStats, listDepartments, listNotifications, listRecentActivity } from "@/lib/server/queries";
import { getOrgInfo } from "@/lib/server/settings";

export const metadata: Metadata = { title: "Overview" };

export default async function AdminOverviewPage() {
  await requireAdminPage();
  const backupsConfigured = backupStorageConfigured();
  const [stats, activity, notifications, departments, backupStatus, monthly, org] = await Promise.all([
    getOverviewStats(),
    listRecentActivity(10, { actorType: "member" }),
    listNotifications({ limit: 6 }),
    listDepartments(),
    backupsConfigured ? getBackupStatus() : Promise.resolve(null),
    getMonthlyHours(12),
    getOrgInfo(),
  ]);
  // Only once the first backup has run (or failed): a brand-new setup is not a problem yet.
  const backupWarning = backupsConfigured && backupStatus !== null && isBackupStale(backupStatus);

  // One plain sentence on where the chapter stands, under the greeting.
  const summary =
    stats.totalHours === 0
      ? "No volunteer hours have been logged yet. They appear here as members fill in their records."
      : `Members have logged ${formatHours(stats.totalHours)} volunteer hours, ${formatHours(stats.verifiedHours)} of them verified. ` +
        (stats.recordsToVerify > 0
          ? `${formatCount(stats.recordsToVerify)} record${stats.recordsToVerify === 1 ? " is" : "s are"} waiting for your verification.`
          : "Every record with entries is verified.");

  const largest = [...departments].sort((a, b) => b.activeMembers - a.activeMembers)[0];
  const tiles = [
    {
      label: "Active members",
      value: stats.activeMembers,
      kind: "count" as const,
      detail: `${formatCount(stats.inactiveMembers)} inactive`,
      href: "/admin/members",
    },
    {
      label: "Departments",
      value: stats.departments,
      kind: "count" as const,
      detail: largest && largest.activeMembers > 0 ? `Largest: ${largest.name} (${largest.activeMembers})` : "No members assigned yet",
      href: "/admin/departments",
    },
    {
      label: "Documentation entries",
      value: stats.contributionEntries + stats.hoursEntries,
      kind: "count" as const,
      detail: `${formatCount(stats.contributionEntries)} contribution${stats.contributionEntries === 1 ? "" : "s"} · ${formatCount(stats.hoursEntries)} hour log${stats.hoursEntries === 1 ? "" : "s"}`,
      href: "/admin/documentation?view=entries",
    },
    {
      label: "Volunteer hours",
      value: stats.totalHours,
      kind: "hours" as const,
      detail:
        stats.recordsToVerify > 0
          ? `${formatHours(stats.verifiedHours)} verified · ${formatCount(stats.recordsToVerify)} record${stats.recordsToVerify === 1 ? "" : "s"} to verify`
          : `${formatHours(stats.verifiedHours)} verified · across ${formatCount(stats.documentRecords)} records`,
      href: "/admin/documentation",
    },
  ];

  return (
    <>
      <SeasonBanner
        message={
          stats.totalHours > 0
            ? `Together, members have given ${formatHours(stats.totalHours)} hours of service. Thank you for leading the chapter.`
            : "Thank you for leading the chapter, and to every member for their service."
        }
      />
      <p className="mb-1.5 text-[13px] text-zinc-500">{formatWeekdayDate()}</p>
      <PageHeader
        display
        title={`${greeting()}, ${org.adminDisplayName}`}
        compactTitle="Overview"
        description={summary}
        actions={
          <>
            <ButtonLink href="/admin/history">
              <FileClock />
              Edit history
            </ButtonLink>
            {stats.recordsToVerify > 0 && (
              <ButtonLink href="/admin/documentation?verify=needed" variant="primary">
                <BadgeCheck />
                Review {stats.recordsToVerify} record{stats.recordsToVerify === 1 ? "" : "s"}
              </ButtonLink>
            )}
          </>
        }
      />

      {backupWarning && (
        <Link
          href="/admin/backups"
          className="mb-6 flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-[13.5px] text-amber-900 transition-colors hover:bg-amber-100"
        >
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            <strong className="font-semibold">Backups need attention.</strong>{" "}
            {backupStatus?.lastSuccessAt
              ? `The last successful backup was ${formatDateTime(backupStatus.lastSuccessAt)}.`
              : "No backup has succeeded yet."}{" "}
            Open Backups to back up now.
          </span>
        </Link>
      )}

      <section aria-label="Statistics" className="grid grid-cols-2 overflow-hidden rounded-lg border border-zinc-200 bg-surface shadow-panel xl:grid-cols-4">
        {tiles.map((tile, index) => (
          <Link
            key={tile.label}
            href={tile.href}
            className={cn(
              "group block min-w-0 border-zinc-200 px-4 py-4 transition-colors hover:bg-zinc-50/80 sm:px-5",
              index % 2 === 1 && "border-l",
              index >= 2 && "border-t xl:border-t-0",
              index === 2 && "xl:border-l",
            )}
          >
            <p className="truncate text-[12.5px] font-medium text-zinc-500">{tile.label}</p>
            <p className="tabular mt-1.5 text-[28px] leading-none font-semibold tracking-[-0.02em] text-zinc-950">
              <CountUp value={tile.value} kind={tile.kind} />
            </p>
            <p className="mt-2 truncate text-[12.5px] text-zinc-500">{tile.detail}</p>
          </Link>
        ))}
      </section>

      <Panel title="Volunteer hours by month" description="By the month the work was done" className="mt-6">
        <HoursChart data={monthly} />
      </Panel>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <Panel
          title="Recent member activity"
          description="Changes made by members to their own documentation"
          actions={
            <Link href="/admin/history?actor=member" className="text-[12.5px] font-medium text-brand-700 hover:text-brand-900">
              View all
            </Link>
          }
        >
          <ActivityList items={activity} emptyText="Members have not made any changes yet." />
        </Panel>

        <Panel
          title="Recent notifications"
          description={`${formatCount(notifications.unread)} unread`}
          actions={
            <Link href="/admin/notifications" className="text-[12.5px] font-medium text-brand-700 hover:text-brand-900">
              View all
            </Link>
          }
        >
          {notifications.items.length === 0 ? (
            <p className="px-4 py-8 text-center text-[13px] text-zinc-500">No notifications yet.</p>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {notifications.items.map((item) => (
                <li key={item.id} className="flex gap-3 px-4 py-3">
                  <span aria-hidden className={cn("mt-1.5 size-2 shrink-0 rounded-full", item.readAt ? "bg-zinc-200" : "bg-brand-600")} />
                  <div className="min-w-0">
                    <Link
                      href={item.link ?? `/admin/history/${item.auditLogId}`}
                      className={cn("text-[13px] leading-snug hover:underline", item.readAt ? "text-zinc-600" : "font-medium text-zinc-900")}
                    >
                      {item.description}
                    </Link>
                    <p className="mt-1 text-[12px] text-zinc-500">{formatDateTime(item.updatedAt)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel
        className="mt-6"
        title="Departments"
        description="Members include those with it as an other department; volunteer hours count each member's main department only"
        actions={
          <Link href="/admin/departments" className="text-[12.5px] font-medium text-brand-700 hover:text-brand-900">
            Manage
          </Link>
        }
      >
        <div className={tableStyles.wrapper}>
          <table className={tableStyles.table}>
            <thead>
              <tr>
                <th className={tableStyles.th}>Department</th>
                <th className={cn(tableStyles.th, "text-right")}>Active members</th>
                <th className={cn(tableStyles.th, "text-right")}>All members</th>
                <th className={cn(tableStyles.th, "text-right")}>Volunteer hours</th>
              </tr>
            </thead>
            <tbody>
              {departments.map((department) => (
                <tr key={department.id} className={tableStyles.row}>
                  <td className={cn(tableStyles.td, "font-medium text-zinc-900")}>{department.name}</td>
                  <td className={cn(tableStyles.td, "tabular text-right")}>{department.activeMembers}</td>
                  <td className={cn(tableStyles.td, "tabular text-right text-zinc-500")}>{department.totalMembers}</td>
                  <td className={cn(tableStyles.td, "tabular text-right")}>{formatHours(department.hoursTotal)}</td>
                </tr>
              ))}
              {departments.length === 0 && (
                <tr>
                  <td colSpan={4} className={cn(tableStyles.td, "py-8 text-center text-zinc-500")}>
                    No departments yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}
