import type { ReactNode } from "react";
import { AdminShell } from "@/components/admin/admin-shell";
import { requireAdminPage } from "@/lib/server/auth";
import { listDepartments, listNotifications, listPositions } from "@/lib/server/queries";
import { getOrgInfo } from "@/lib/server/settings";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireAdminPage();
  const [org, notifications, departments, positions] = await Promise.all([
    getOrgInfo(),
    listNotifications({ limit: 8 }),
    listDepartments(),
    listPositions(),
  ]);

  return (
    <AdminShell
      org={org}
      unread={notifications.unread}
      notifications={notifications.items}
      departments={departments.map((department) => ({ id: department.id, name: department.name }))}
      positions={positions.map((position) => ({ id: position.id, name: position.name }))}
    >
      {children}
    </AdminShell>
  );
}
