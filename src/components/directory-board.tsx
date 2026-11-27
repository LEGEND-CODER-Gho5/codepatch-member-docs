"use client";

import { ChevronRight, Search, X } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Avatar, Badge } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";

type Member = { id: string; fullName: string; positionName: string; memberCode: string };
type Department = { id: string; name: string; description: string; members: Member[] };

export function DirectoryBoard({ departments, currentMemberId }: { departments: Department[]; currentMemberId?: string | null }) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();

  const filtered = useMemo(
    () =>
      departments.map((department) => ({
        ...department,
        visible: needle
          ? department.members.filter(
              (member) =>
                member.fullName.toLowerCase().includes(needle) ||
                member.positionName.toLowerCase().includes(needle) ||
                department.name.toLowerCase().includes(needle),
            )
          : department.members,
      })),
    [departments, needle],
  );
  // A member in several departments appears in several columns but counts once.
  const matches = new Set(filtered.flatMap((department) => department.visible.map((member) => member.id))).size;

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-sm">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-zinc-400" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a member by name or role"
            aria-label="Find a member"
            className="h-9 w-full rounded-md border border-zinc-300 bg-white pr-8 pl-9 text-[13.5px] shadow-[inset_0_1px_1px_rgba(0,0,0,0.03)] placeholder:text-zinc-400 focus:border-brand-500 focus:ring-3 focus:ring-brand-500/15 focus:outline-none [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-zinc-400 hover:text-zinc-700"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
        {needle && (
          <p className="text-[13px] text-zinc-500" aria-live="polite">
            {matches} {matches === 1 ? "member matches" : "members match"}
          </p>
        )}
      </div>

      {departments.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-300 bg-white px-6 py-12 text-center text-[13.5px] text-zinc-500">
          No departments have been configured yet.
        </div>
      ) : (
        <div className="grid items-start gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {filtered.map((department) => (
            <section
              key={department.id}
              aria-labelledby={`dept-${department.id}`}
              className={cn(
                "flex flex-col rounded-lg border border-zinc-200 bg-white shadow-panel",
                needle && department.visible.length === 0 && "opacity-60",
              )}
            >
              <header className="flex items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3">
                <div className="min-w-0">
                  <h2 id={`dept-${department.id}`} className="truncate text-[13.5px] font-semibold text-zinc-900">
                    {department.name}
                  </h2>
                  {department.description && <p className="truncate text-[12px] text-zinc-500">{department.description}</p>}
                </div>
                <span
                  className="tabular shrink-0 rounded-[4px] bg-zinc-100 px-1.5 py-px text-[12px] font-semibold text-zinc-600 ring-1 ring-zinc-200 ring-inset"
                  title={`${department.members.length} active member${department.members.length === 1 ? "" : "s"}`}
                >
                  {department.members.length}
                </span>
              </header>
              {department.visible.length === 0 ? (
                <p className="px-4 py-6 text-[13px] text-zinc-500">
                  {department.members.length === 0 ? "No active members yet." : "No matching members."}
                </p>
              ) : (
                <ul className="divide-y divide-zinc-100">
                  {department.visible.map((member) => (
                    <li key={member.id}>
                      <Link
                        href={`/members/${member.id}/login`}
                        className="group flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-zinc-50 focus-visible:bg-zinc-50 focus-visible:outline-offset-[-2px]"
                      >
                        <Avatar name={member.fullName} />
                        <div className="min-w-0 flex-1">
                          <p className="flex items-center gap-2 truncate text-[13.5px] font-medium text-zinc-900 group-hover:text-brand-800">
                            {member.fullName}
                            {member.id === currentMemberId && <Badge tone="brand">You</Badge>}
                          </p>
                          <p className="truncate text-[12px] text-zinc-500">
                            {member.positionName}
                            <span className="text-zinc-300"> · </span>
                            {department.name}
                          </p>
                        </div>
                        <ChevronRight aria-hidden className="size-4 shrink-0 text-zinc-300 transition-colors group-hover:text-zinc-500" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
