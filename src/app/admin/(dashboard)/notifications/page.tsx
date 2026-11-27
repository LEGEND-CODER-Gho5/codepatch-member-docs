import type { Metadata } from "next";
import { NotificationsList } from "@/components/admin/notifications-list";
import { PageHeader } from "@/components/ui/primitives";
import { requireAdminPage } from "@/lib/server/auth";
import { listNotifications } from "@/lib/server/queries";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminPage();
  const query = await searchParams;
  const filter = query.filter === "unread" ? "unread" : "all";
  const result = await listNotifications({ unreadOnly: filter === "unread", limit: 200 });

  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="Notifications"
        description="Generated automatically when members create, edit, or delete documentation and volunteer hours, and for important account and security events."
      />
      <NotificationsList items={result.items} unread={result.unread} filter={filter} />
      {result.total > 200 && filter === "all" && (
        <p className="mt-3 text-[12.5px] text-zinc-500">Showing the 200 most recent of {result.total.toLocaleString()} notifications.</p>
      )}
    </>
  );
}
