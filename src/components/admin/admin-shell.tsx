"use client";

import { Bell, Building, ExternalLink, FileClock, FileText, LayoutDashboard, LogOut, Menu, Settings, UserPlus, Users, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useState, type ReactNode } from "react";
import { adminLogoutAction } from "@/actions/auth";
import { Wordmark } from "@/components/brand";
import { LiveIndicator, LiveRefresh } from "@/components/realtime";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import type { DepartmentOption, NotificationItem, OrgInfo, PositionOption } from "@/lib/types";
import { AddMemberDialog } from "./member-dialogs";
import { NotificationBell } from "./notification-bell";

type AdminUI = { openAddMember: () => void; departments: DepartmentOption[]; positions: PositionOption[] };
const AdminUIContext = createContext<AdminUI | null>(null);

export function useAdminUI(): AdminUI {
  const value = useContext(AdminUIContext);
  if (!value) throw new Error("useAdminUI must be used inside the admin shell");
  return value;
}

const NAV = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/admin/members", label: "Member Management", icon: Users },
  { href: "/admin/documentation", label: "Documentation", icon: FileText },
  { href: "/admin/history", label: "Edit History", icon: FileClock },
  { href: "/admin/notifications", label: "Notifications", icon: Bell },
  { href: "/admin/departments", label: "Departments", icon: Building },
  { href: "/admin/settings", label: "Settings", icon: Settings },
];

function Navigation({ unread, onNavigate }: { unread: number; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Administration" className="space-y-0.5">
      {NAV.map((item) => {
        const active = item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group relative flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[13px] font-medium transition-colors",
              active ? "bg-white/[0.07] text-white" : "text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-100",
            )}
          >
            {active && <span aria-hidden className="absolute top-1.5 bottom-1.5 -left-3 w-[3px] rounded-r bg-brand-400" />}
            <Icon className={cn("size-4 shrink-0", active ? "text-brand-300" : "text-zinc-500 group-hover:text-zinc-300")} />
            <span className="flex-1 truncate">{item.label}</span>
            {item.href === "/admin/notifications" && unread > 0 && (
              <span className="tabular rounded-full bg-brand-500 px-1.5 text-[11px] leading-[18px] font-semibold text-white">
                {unread > 99 ? "99+" : unread}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

function SidebarContent({ org, adminName, unread, onNavigate }: { org: OrgInfo; adminName: string; unread: number; onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col">
      <div className="px-5 pt-5 pb-6">
        <Link href="/admin" onClick={onNavigate} className="block rounded-md">
          <Wordmark organizationName={org.organizationName} subtitle="Administration" tone="light" />
        </Link>
      </div>
      <div className="flex-1 overflow-y-auto px-3">
        <p className="mb-2 px-2.5 text-[10.5px] font-semibold tracking-[0.12em] text-zinc-600 uppercase">Manage</p>
        <Navigation unread={unread} onNavigate={onNavigate} />
      </div>
      <div className="space-y-3 border-t border-white/[0.06] px-5 py-4">
        <Link href="/directory" className="flex items-center gap-2 text-[12.5px] text-zinc-400 transition-colors hover:text-white">
          <ExternalLink className="size-3.5" />
          View member directory
        </Link>
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-[12.5px] font-medium text-zinc-200">{adminName}</p>
            <p className="truncate text-[11.5px] text-zinc-500">{org.chapterName}</p>
          </div>
          <form action={adminLogoutAction}>
            <button
              type="submit"
              title="Sign out of administration"
              aria-label="Sign out of administration"
              className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-white/5 hover:text-white"
            >
              <LogOut className="size-4" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export function AdminShell({
  org,
  unread,
  notifications,
  departments,
  positions,
  children,
}: {
  org: OrgInfo;
  unread: number;
  notifications: NotificationItem[];
  departments: DepartmentOption[];
  positions: PositionOption[];
  children: ReactNode;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  // Each opening of "Add Member" mounts a fresh form.
  const [addSession, setAddSession] = useState(0);
  const pathname = usePathname();
  const [lastPathname, setLastPathname] = useState(pathname);
  if (pathname !== lastPathname) {
    setLastPathname(pathname);
    setDrawerOpen(false);
  }

  const openAddMember = () => {
    setAddSession((value) => value + 1);
    setAddOpen(true);
  };

  return (
    <AdminUIContext.Provider value={{ openAddMember, departments, positions }}>
      <LiveRefresh scopes={["directory", "member", "admin"]} />
      <div className="min-h-dvh lg:pl-[248px] print:pl-0">
        <aside className="fixed inset-y-0 left-0 z-40 hidden w-[248px] border-r border-black/40 bg-charcoal-950 lg:block print:hidden">
          <SidebarContent org={org} adminName={org.adminDisplayName} unread={unread} />
        </aside>

        {drawerOpen && (
          <div className="fixed inset-0 z-50 lg:hidden print:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
            <div className="absolute inset-0 bg-charcoal-950/50" onClick={() => setDrawerOpen(false)} />
            <div className="absolute inset-y-0 left-0 w-[264px] bg-charcoal-950 shadow-raised">
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close navigation"
                className="absolute top-4 right-3 rounded-md p-1.5 text-zinc-400 hover:bg-white/5 hover:text-white"
              >
                <X className="size-4" />
              </button>
              <SidebarContent org={org} adminName={org.adminDisplayName} unread={unread} onNavigate={() => setDrawerOpen(false)} />
            </div>
          </div>
        )}

        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-zinc-200 bg-white/95 px-4 backdrop-blur sm:px-6 print:hidden">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open navigation"
            className="-ml-1 rounded-md p-1.5 text-zinc-600 hover:bg-zinc-100 lg:hidden"
          >
            <Menu className="size-5" />
          </button>
          <p className="hidden truncate text-[13px] text-zinc-500 sm:block">
            {org.organizationName} <span className="text-zinc-300">/</span> {org.chapterName}
          </p>
          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            <LiveIndicator className="hidden sm:inline-flex" />
            <Button variant="primary" size="sm" onClick={openAddMember}>
              <UserPlus />
              <span>Add Member</span>
            </Button>
            <NotificationBell unread={unread} notifications={notifications} />
          </div>
        </header>

        <main className="px-4 py-6 sm:px-6 lg:px-8 print:p-0">{children}</main>
      </div>
      <AddMemberDialog
        key={addSession}
        open={addOpen}
        onClose={() => setAddOpen(false)}
        departments={departments}
        positions={positions}
      />
    </AdminUIContext.Provider>
  );
}

export function AddMemberTrigger({ label = "Add Member" }: { label?: string }) {
  const { openAddMember } = useAdminUI();
  return (
    <Button variant="primary" onClick={openAddMember}>
      <UserPlus />
      {label}
    </Button>
  );
}
