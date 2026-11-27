"use client";

import { Bell, CheckCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { markAllNotificationsReadAction, markNotificationReadAction } from "@/actions/organization";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/format";
import type { NotificationItem } from "@/lib/types";

export function NotificationBell({ unread, notifications }: { unread: number; notifications: NotificationItem[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const seen = useRef<{ maxStamp: string; initialized: boolean }>({ maxStamp: "", initialized: false });

  // Announce notifications that arrive while the dashboard is open.
  useEffect(() => {
    const newestUnread = notifications.filter((item) => !item.readAt);
    const stamp = notifications.reduce((max, item) => (item.updatedAt > max ? item.updatedAt : max), "");
    if (!seen.current.initialized) {
      seen.current = { maxStamp: stamp, initialized: true };
      return;
    }
    const fresh = newestUnread.filter((item) => item.updatedAt > seen.current.maxStamp);
    if (fresh.length > 0) {
      toast(fresh[0].description, {
        kind: "info",
        detail: fresh.length > 1 ? `and ${fresh.length - 1} more update${fresh.length > 2 ? "s" : ""}` : formatDateTime(fresh[0].updatedAt),
      });
    }
    if (stamp > seen.current.maxStamp) seen.current.maxStamp = stamp;
  }, [notifications]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!panelRef.current?.contains(target) && !buttonRef.current?.contains(target)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function openItem(item: NotificationItem) {
    setOpen(false);
    if (!item.readAt) await markNotificationReadAction(item.id);
    router.push(item.link ?? (item.auditLogId ? `/admin/history/${item.auditLogId}` : "/admin/notifications"));
    router.refresh();
  }

  async function markAll() {
    await markAllNotificationsReadAction();
    router.refresh();
  }

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        aria-expanded={open}
        className="relative inline-flex size-9 items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-600 transition-colors hover:border-zinc-300 hover:text-zinc-900 aria-expanded:bg-zinc-50"
      >
        <Bell className="size-[18px]" />
        {unread > 0 && (
          <span className="tabular absolute -top-1.5 -right-1.5 min-w-[18px] rounded-full bg-brand-700 px-1 text-center text-[10.5px] leading-[18px] font-semibold text-white ring-2 ring-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div
          ref={panelRef}
          className="absolute top-11 right-0 z-50 w-[min(400px,calc(100vw-2rem))] overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-raised"
        >
          <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-2.5">
            <p className="text-[13px] font-semibold text-zinc-900">
              Notifications{unread > 0 && <span className="ml-1.5 font-normal text-zinc-500">{unread} unread</span>}
            </p>
            {unread > 0 && (
              <button
                type="button"
                onClick={markAll}
                className="flex items-center gap-1 text-[12px] font-medium text-brand-700 hover:text-brand-900"
              >
                <CheckCheck className="size-3.5" />
                Mark all as read
              </button>
            )}
          </div>
          {notifications.length === 0 ? (
            <p className="px-4 py-8 text-center text-[13px] text-zinc-500">No notifications yet.</p>
          ) : (
            <ul className="max-h-[420px] divide-y divide-zinc-100 overflow-y-auto">
              {notifications.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => openItem(item)}
                    className={cn("flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-zinc-50", !item.readAt && "bg-brand-50/40")}
                  >
                    <span
                      aria-hidden
                      className={cn("mt-1.5 size-2 shrink-0 rounded-full", item.readAt ? "bg-transparent" : "bg-brand-600")}
                    />
                    <span className="min-w-0 flex-1">
                      <span className={cn("block text-[13px] leading-snug", item.readAt ? "text-zinc-600" : "font-medium text-zinc-900")}>
                        {item.description}
                      </span>
                      <span className="mt-1 block text-[11.5px] text-zinc-500">
                        {item.departmentName && <>{item.departmentName} · </>}
                        {formatDateTime(item.updatedAt)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Link
            href="/admin/notifications"
            onClick={() => setOpen(false)}
            className="block border-t border-zinc-200 bg-zinc-50/70 px-4 py-2.5 text-center text-[12.5px] font-medium text-zinc-700 hover:bg-zinc-100"
          >
            View all notifications
          </Link>
        </div>
      )}
    </div>
  );
}
