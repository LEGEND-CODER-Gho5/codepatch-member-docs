"use client";

import {
  Bell,
  Building,
  ClipboardCheck,
  CornerDownLeft,
  DatabaseBackup,
  FileClock,
  FileSpreadsheet,
  FileText,
  LayoutDashboard,
  Search,
  Settings,
  UserPlus,
  Users,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { listSearchMembersAction, type SearchMember } from "@/actions/search";
import { Avatar } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";

type Item = {
  id: string;
  group: "Members" | "Pages" | "Actions";
  label: string;
  detail?: string;
  keywords: string;
  icon: ReactNode;
  run: () => void;
};

const PAGES = [
  { label: "Overview", href: "/admin", icon: <LayoutDashboard />, keywords: "home dashboard stats" },
  { label: "Member Management", href: "/admin/members", icon: <Users />, keywords: "members people accounts" },
  { label: "Documentation", href: "/admin/documentation", icon: <FileText />, keywords: "records hours verify" },
  { label: "Attendance", href: "/admin/attendance", icon: <ClipboardCheck />, keywords: "meeting check in" },
  { label: "Edit History", href: "/admin/history", icon: <FileClock />, keywords: "audit changes log" },
  { label: "Notifications", href: "/admin/notifications", icon: <Bell />, keywords: "alerts unread" },
  { label: "Departments", href: "/admin/departments", icon: <Building />, keywords: "teams groups" },
  { label: "Backups", href: "/admin/backups", icon: <DatabaseBackup />, keywords: "export download restore" },
  { label: "Settings", href: "/admin/settings", icon: <Settings />, keywords: "passwords organization policies" },
];

function subscribeNever() {
  return () => undefined;
}

/** "⌘" on Apple devices, "Ctrl" elsewhere. */
export function useShortcutKey(): string {
  return useSyncExternalStore(
    subscribeNever,
    () => (/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? "⌘" : "Ctrl"),
    () => "Ctrl",
  );
}

/**
 * Quick search for administrators: Ctrl+K (⌘K on a Mac) or the search button
 * opens it; type part of a name, member ID, email, department, or page, then
 * use the arrow keys and Enter.
 */
export function CommandPalette({ onAddMember }: { onAddMember: () => void }) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [members, setMembers] = useState<SearchMember[] | null>(null);
  const shortcut = useShortcutKey();

  function show() {
    setQuery("");
    setActive(0);
    setOpen(true);
  }

  // The keyboard shortcut works anywhere in the admin area.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => {
          if (!value) {
            setQuery("");
            setActive(0);
          }
          return !value;
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      inputRef.current?.focus();
      if (members === null) {
        void listSearchMembersAction().then((result) => setMembers(result.ok ? result.data : []));
      }
    }
    if (!open && dialog.open) dialog.close();
  }, [open, members]);

  const items = useMemo<Item[]>(() => {
    const go = (href: string) => () => {
      setOpen(false);
      router.push(href);
    };
    const all: Item[] = [
      ...(members ?? []).map((member) => ({
        id: `m:${member.id}`,
        group: "Members" as const,
        label: member.fullName,
        detail: `${member.memberCode} · ${member.departmentName}${member.status === "inactive" ? " · inactive" : ""}`,
        keywords: `${member.memberCode} ${member.email ?? ""} ${member.departmentName}`,
        icon: <Avatar name={member.fullName} className="size-6 text-[10px]" />,
        run: go(`/admin/members/${member.id}`),
      })),
      ...PAGES.map((page) => ({
        id: `p:${page.href}`,
        group: "Pages" as const,
        label: page.label,
        keywords: page.keywords,
        icon: page.icon,
        run: go(page.href),
      })),
      {
        id: "a:add",
        group: "Actions",
        label: "Add a member",
        keywords: "new create member",
        icon: <UserPlus />,
        run: () => {
          setOpen(false);
          onAddMember();
        },
      },
      {
        id: "a:meeting",
        group: "Actions",
        label: "Start a meeting",
        keywords: "attendance check in",
        icon: <ClipboardCheck />,
        run: go("/admin/attendance"),
      },
      {
        id: "a:verify",
        group: "Actions",
        label: "Records that need verification",
        keywords: "verify sign off check hours",
        icon: <FileText />,
        run: go("/admin/documentation"),
      },
      {
        id: "a:export",
        group: "Actions",
        label: "Download the spreadsheet",
        keywords: "export excel xlsx backup",
        icon: <FileSpreadsheet />,
        run: () => {
          setOpen(false);
          // A plain link download (the file is not a page).
          const link = document.createElement("a");
          link.href = "/admin/backups/spreadsheet";
          link.click();
        },
      },
    ];
    const needle = query.trim().toLowerCase();
    if (!needle) return all.filter((item) => item.group !== "Members").concat(all.filter((item) => item.group === "Members").slice(0, 5));
    const words = needle.split(/\s+/);
    return all.filter((item) => {
      const haystack = `${item.label} ${item.detail ?? ""} ${item.keywords}`.toLowerCase();
      return words.every((word) => haystack.includes(word));
    });
  }, [members, query, router, onAddMember]);

  const activeIndex = items.length === 0 ? -1 : Math.min(active, items.length - 1);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (items.length === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((activeIndex + step + items.length) % items.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      items[activeIndex]?.run();
    }
  }

  const groups = (["Members", "Actions", "Pages"] as const)
    .map((group) => ({ group, entries: items.map((item, index) => ({ item, index })).filter(({ item }) => item.group === group) }))
    .filter((entry) => entry.entries.length > 0);

  return (
    <>
      <button
        type="button"
        onClick={show}
        aria-label="Search members and pages"
        className="flex h-8 items-center gap-2 rounded-md border border-zinc-200 bg-surface px-2 text-[13px] text-zinc-500 transition-colors hover:border-zinc-300 hover:text-zinc-800 sm:w-56 sm:px-2.5"
      >
        <Search className="size-4 shrink-0" />
        <span className="hidden flex-1 text-left sm:inline">Search</span>
        <kbd className="hidden rounded border border-zinc-200 bg-zinc-50 px-1.5 font-sans text-[11px] font-medium text-zinc-500 sm:inline">
          {shortcut} K
        </kbd>
      </button>

      <dialog
        ref={dialogRef}
        onClose={() => setOpen(false)}
        onClick={(event) => {
          if (event.target === event.currentTarget) setOpen(false);
        }}
        aria-label="Quick search"
        className="m-auto mt-[12vh] w-[min(560px,calc(100vw-2rem))] overflow-hidden rounded-xl border border-zinc-200 bg-surface p-0 text-zinc-900 shadow-raised backdrop:bg-black/40"
      >
        {open && (
          <div onKeyDown={onKeyDown}>
            <div className="flex items-center gap-2.5 border-b border-zinc-200 px-4">
              <Search className="size-4 shrink-0 text-zinc-400" />
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActive(0);
                }}
                placeholder="Search members, pages, and actions"
                aria-label="Search members, pages, and actions"
                role="combobox"
                aria-expanded="true"
                aria-controls="quick-search-results"
                aria-activedescendant={activeIndex >= 0 ? `quick-search-${activeIndex}` : undefined}
                className="h-12 flex-1 bg-transparent text-[14.5px] text-zinc-950 placeholder:text-zinc-400 focus:outline-none"
              />
              <kbd className="rounded border border-zinc-200 bg-zinc-50 px-1.5 text-[11px] font-medium text-zinc-500">Esc</kbd>
            </div>
            <div ref={listRef} id="quick-search-results" role="listbox" className="max-h-[min(420px,60vh)] overflow-y-auto py-1.5">
              {items.length === 0 ? (
                <p className="px-4 py-8 text-center text-[13px] text-zinc-500">
                  {members === null ? "Loading members…" : `Nothing matches “${query.trim()}”. Try a first name, member ID, or page.`}
                </p>
              ) : (
                groups.map(({ group, entries }) => (
                  <div key={group} role="group" aria-label={group} className="px-1.5 pb-1">
                    <p className="px-2.5 pt-2 pb-1 text-[11.5px] font-medium text-zinc-400">{group}</p>
                    {entries.map(({ item, index }) => (
                      <div
                        key={item.id}
                        id={`quick-search-${index}`}
                        data-index={index}
                        role="option"
                        aria-selected={index === activeIndex}
                        onMouseMove={() => setActive(index)}
                        onClick={item.run}
                        className={cn(
                          "flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-2 text-[13.5px] [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-zinc-400",
                          index === activeIndex ? "bg-zinc-100 text-zinc-950" : "text-zinc-700",
                        )}
                      >
                        {item.icon}
                        <span className="min-w-0 flex-1 truncate">
                          {item.label}
                          {item.detail && <span className="ml-2 text-[12px] text-zinc-500">{item.detail}</span>}
                        </span>
                        {index === activeIndex && <CornerDownLeft aria-hidden />}
                      </div>
                    ))}
                  </div>
                ))
              )}
            </div>
            <div className="flex items-center gap-4 border-t border-zinc-200 bg-zinc-50 px-4 py-2 text-[11.5px] text-zinc-500">
              <span>
                <kbd className="font-sans font-medium">↑</kbd> <kbd className="font-sans font-medium">↓</kbd> to move
              </span>
              <span>
                <kbd className="font-sans font-medium">Enter</kbd> to open
              </span>
              <span className="ml-auto">
                {shortcut} K to close
              </span>
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}
