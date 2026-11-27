"use client";

import { ArrowDownUp, Search } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Input, Select } from "@/components/ui/field";
import { ACTION_FILTER_OPTIONS, DOCUMENT_FILTER_OPTIONS } from "@/lib/audit-display";
import type { DepartmentOption } from "@/lib/types";

export function HistoryFilters({ departments, total }: { departments: DepartmentOption[]; total: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState(params.get("q") ?? "");

  const update = (changes: Record<string, string>) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    next.delete("page");
    startTransition(() => router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false }));
  };

  useEffect(() => {
    const current = params.get("q") ?? "";
    if (query === current) return;
    const timer = window.setTimeout(() => update({ q: query }), 350);
    return () => window.clearTimeout(timer);
    // Only the typed query should trigger this debounce.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const value = (key: string) => params.get(key) ?? "";
  const active = ["q", "department", "action", "document", "actor", "from", "to"].some((key) => params.get(key));
  const oldestFirst = value("sort") === "oldest";

  return (
    <div className="space-y-3 border-b border-zinc-200 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-zinc-400" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by member, actor, or change"
            aria-label="Search history"
            className="h-9 w-full rounded-md border border-zinc-300 bg-surface pr-3 pl-9 text-[13.5px] placeholder:text-zinc-400 focus:border-brand-500 focus:ring-3 focus:ring-brand-500/15 focus:outline-none"
          />
        </div>
        <Select value={value("department")} onChange={(event) => update({ department: event.target.value })} aria-label="Department" className="w-44">
          <option value="">All departments</option>
          {departments.map((department) => (
            <option key={department.id} value={department.id}>
              {department.name}
            </option>
          ))}
        </Select>
        <Select value={value("action")} onChange={(event) => update({ action: event.target.value })} aria-label="Action" className="w-40">
          <option value="">All actions</option>
          {ACTION_FILTER_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
        <Select value={value("document")} onChange={(event) => update({ document: event.target.value })} aria-label="Document type" className="w-52">
          <option value="">All documents and records</option>
          {DOCUMENT_FILTER_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
        <Select value={value("actor")} onChange={(event) => update({ actor: event.target.value })} aria-label="Actor type" className="w-40">
          <option value="">All actors</option>
          <option value="member">Members</option>
          <option value="admin">Administrator</option>
          <option value="system">System</option>
        </Select>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-zinc-600">
        <label className="flex items-center gap-2">
          From
          <Input type="date" value={value("from")} onChange={(event) => update({ from: event.target.value })} className="h-8 w-[150px] text-[13px]" />
        </label>
        <label className="flex items-center gap-2">
          To
          <Input type="date" value={value("to")} onChange={(event) => update({ to: event.target.value })} className="h-8 w-[150px] text-[13px]" />
        </label>
        <button
          type="button"
          onClick={() => update({ sort: oldestFirst ? "" : "oldest" })}
          className="ml-1 inline-flex h-8 items-center gap-1.5 rounded-md border border-zinc-300 bg-surface px-2.5 font-medium text-zinc-700 hover:bg-zinc-50"
        >
          <ArrowDownUp className="size-3.5" />
          {oldestFirst ? "Oldest first" : "Newest first"}
        </button>
        {active && (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              startTransition(() => router.replace(pathname, { scroll: false }));
            }}
            className="px-1 font-medium text-zinc-500 hover:text-zinc-900"
          >
            Clear filters
          </button>
        )}
        <span className="ml-auto">
          {pending ? "Updating…" : `${total.toLocaleString()} record${total === 1 ? "" : "s"} · times shown in America/New_York`}
        </span>
      </div>
    </div>
  );
}
