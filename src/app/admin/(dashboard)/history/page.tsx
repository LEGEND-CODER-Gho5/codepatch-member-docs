import { ChevronLeft, ChevronRight, FileClock } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { HistoryFilters } from "@/components/admin/history-filters";
import { ButtonLink } from "@/components/ui/button";
import { ActorBadge, Badge, EmptyState, PageHeader, tableStyles } from "@/components/ui/primitives";
import { actionLabel, documentLabel } from "@/lib/audit-display";
import { cn } from "@/lib/cn";
import { formatDateLong, formatTimeWithSeconds } from "@/lib/format";
import { requireAdminPage } from "@/lib/server/auth";
import { listDepartments, queryAuditLogs } from "@/lib/server/queries";

export const metadata: Metadata = { title: "Edit History" };

function text(value: string | string[] | undefined) {
  return typeof value === "string" ? value : undefined;
}

const ACTION_TONES: Record<string, "success" | "warning" | "danger" | "brand" | "neutral" | "info"> = {
  created: "success",
  edited: "info",
  deleted: "danger",
  restored: "brand",
  deactivated: "warning",
  reactivated: "success",
  password_reset: "warning",
  locked_out: "danger",
};

export default async function HistoryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminPage();
  const query = await searchParams;
  const filters = {
    q: text(query.q),
    department: text(query.department),
    action: text(query.action),
    document: text(query.document),
    actor: text(query.actor),
    from: text(query.from),
    to: text(query.to),
    sort: text(query.sort),
    page: Number(text(query.page) ?? 1) || 1,
  };
  const [result, departments] = await Promise.all([queryAuditLogs(filters), listDepartments()]);
  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));

  const pageHref = (page: number) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) if (typeof value === "string" && key !== "page") next.set(key, value);
    if (page > 1) next.set("page", String(page));
    return `/admin/history${next.size ? `?${next}` : ""}`;
  };

  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="Edit History"
        description="An append-only record of every change: who made it, when, and exactly what changed. Records cannot be edited or deleted, and remain after a member is removed."
      />
      <div className="rounded-lg border border-zinc-200 bg-white shadow-panel">
        <HistoryFilters departments={departments.map((department) => ({ id: department.id, name: department.name }))} total={result.total} />
        {result.items.length === 0 ? (
          <EmptyState icon={<FileClock />} title="No history records match" description="Try widening the filters or clearing the date range." />
        ) : (
          <div className={tableStyles.wrapper}>
            <table className={tableStyles.table}>
              <thead>
                <tr>
                  <th className={tableStyles.th}>Date</th>
                  <th className={tableStyles.th}>Time</th>
                  <th className={tableStyles.th}>Actor</th>
                  <th className={tableStyles.th}>Member</th>
                  <th className={tableStyles.th}>Action</th>
                  <th className={tableStyles.th}>Document</th>
                  <th className={tableStyles.th}>Change</th>
                  <th className={cn(tableStyles.th, "w-8")}>
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {result.items.map((item) => (
                  <tr key={item.id} className={cn(tableStyles.row, "group relative")}>
                    <td className={cn(tableStyles.td, "whitespace-nowrap text-zinc-900")}>
                      <Link href={`/admin/history/${item.id}`} className="after:absolute after:inset-0">
                        {formatDateLong(item.lastOccurredAt)}
                      </Link>
                    </td>
                    <td className={cn(tableStyles.td, "tabular whitespace-nowrap text-zinc-600")}>{formatTimeWithSeconds(item.lastOccurredAt)}</td>
                    <td className={tableStyles.td}>
                      <div className="flex items-center gap-2 whitespace-nowrap">
                        <span className="font-medium text-zinc-900">{item.actorName}</span>
                        <ActorBadge type={item.actorType} />
                      </div>
                    </td>
                    <td className={tableStyles.td}>
                      {item.memberName ? (
                        <div className="whitespace-nowrap">
                          <span className="text-zinc-900">{item.memberName}</span>
                          {item.departmentName && <p className="text-[12px] text-zinc-500">{item.departmentName}</p>}
                        </div>
                      ) : (
                        <span className="text-zinc-400">—</span>
                      )}
                    </td>
                    <td className={tableStyles.td}>
                      <Badge tone={ACTION_TONES[item.action] ?? "neutral"}>{actionLabel(item.action)}</Badge>
                    </td>
                    <td className={cn(tableStyles.td, "whitespace-nowrap text-zinc-700")}>{documentLabel(item)}</td>
                    <td className={cn(tableStyles.td, "max-w-[340px] text-zinc-700")}>
                      <p className="truncate">{item.summary}</p>
                      {item.revisionCount > 1 && (
                        <p className="text-[12px] text-zinc-500">{item.revisionCount} saves in one editing session</p>
                      )}
                    </td>
                    <td className={cn(tableStyles.td, "text-zinc-300 group-hover:text-zinc-500")}>
                      <ChevronRight className="size-4" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {pages > 1 && (
          <div className="flex items-center justify-between gap-3 px-4 py-3 text-[12.5px] text-zinc-600">
            <span>
              Page {result.page} of {pages}
            </span>
            <div className="flex gap-2">
              {result.page > 1 && (
                <ButtonLink href={pageHref(result.page - 1)} size="sm">
                  <ChevronLeft />
                  Previous
                </ButtonLink>
              )}
              {result.page < pages && (
                <ButtonLink href={pageHref(result.page + 1)} size="sm">
                  Next
                  <ChevronRight />
                </ButtonLink>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
