"use client";

import { Bell, CheckCheck, FileClock, FileText, KeyRound, ShieldAlert, UserPlus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { markAllNotificationsReadAction, markNotificationReadAction, markNotificationUnreadAction } from "@/actions/organization";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/format";
import type { NotificationItem } from "@/lib/types";

function iconFor(type: string) {
  if (type.startsWith("security")) return <ShieldAlert className="size-4 text-red-600" />;
  if (type === "member.created") return <UserPlus className="size-4 text-emerald-600" />;
  if (type.includes("password")) return <KeyRound className="size-4 text-amber-600" />;
  if (type.startsWith("member") || type.startsWith("settings")) return <Bell className="size-4 text-zinc-500" />;
  return <FileText className="size-4 text-brand-600" />;
}

export function NotificationsList({ items, unread, filter }: { items: NotificationItem[]; unread: number; filter: "all" | "unread" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function toggle(item: NotificationItem) {
    if (item.readAt) await markNotificationUnreadAction(item.id);
    else await markNotificationReadAction(item.id);
    router.refresh();
  }

  async function open(item: NotificationItem) {
    if (!item.readAt) await markNotificationReadAction(item.id);
    router.push(item.link ?? `/admin/history/${item.auditLogId}`);
  }

  return (
    <div className="rounded-lg border border-zinc-200 bg-white shadow-panel">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-4 py-2.5">
        <nav className="flex gap-1" aria-label="Filter notifications">
          {(["all", "unread"] as const).map((key) => (
            <Link
              key={key}
              href={key === "all" ? "/admin/notifications" : "/admin/notifications?filter=unread"}
              aria-current={filter === key ? "page" : undefined}
              className={cn(
                "rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors",
                filter === key ? "bg-zinc-100 text-zinc-950" : "text-zinc-500 hover:text-zinc-900",
              )}
            >
              {key === "all" ? "All" : `Unread (${unread})`}
            </Link>
          ))}
        </nav>
        <Button
          size="sm"
          disabled={unread === 0 || busy}
          onClick={async () => {
            setBusy(true);
            await markAllNotificationsReadAction();
            setBusy(false);
            router.refresh();
          }}
        >
          <CheckCheck />
          Mark all as read
        </Button>
      </div>
      {items.length === 0 ? (
        <EmptyState
          icon={<Bell />}
          title={filter === "unread" ? "You're all caught up" : "No notifications yet"}
          description="Member documentation changes and account events appear here as they happen."
        />
      ) : (
        <ul className="divide-y divide-zinc-100">
          {items.map((item) => (
            <li key={item.id} className={cn("flex gap-3 px-4 py-3.5", !item.readAt && "bg-brand-50/35")}>
              <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-white ring-1 ring-zinc-200">
                {iconFor(item.type)}
              </span>
              <div className="min-w-0 flex-1">
                <button type="button" onClick={() => open(item)} className="text-left">
                  <span className={cn("text-[13.5px] leading-snug hover:underline", item.readAt ? "text-zinc-700" : "font-medium text-zinc-950")}>
                    {item.description}
                  </span>
                </button>
                <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-zinc-500">
                  <span>{formatDateTime(item.updatedAt)}</span>
                  {item.memberName && (
                    <>
                      <span className="text-zinc-300">·</span>
                      <span>{item.memberName}</span>
                    </>
                  )}
                  {item.departmentName && (
                    <>
                      <span className="text-zinc-300">·</span>
                      <span>{item.departmentName}</span>
                    </>
                  )}
                  {item.auditLogId && (
                    <>
                      <span className="text-zinc-300">·</span>
                      <Link href={`/admin/history/${item.auditLogId}`} className="inline-flex items-center gap-1 font-medium text-brand-700 hover:text-brand-900">
                        <FileClock className="size-3" />
                        View change
                      </Link>
                    </>
                  )}
                </p>
              </div>
              <div className="flex shrink-0 items-start gap-2">
                {!item.readAt && <span className="mt-2 size-2 rounded-full bg-brand-600" aria-label="Unread" />}
                <button
                  type="button"
                  onClick={() => toggle(item)}
                  className="rounded px-1.5 py-1 text-[12px] font-medium text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
                >
                  {item.readAt ? "Mark unread" : "Mark read"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
