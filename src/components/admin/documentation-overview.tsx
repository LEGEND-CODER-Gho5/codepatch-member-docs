"use client";

import { ArrowRight, FileText, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Select } from "@/components/ui/field";
import { EmptyState, StatusBadge, tableStyles } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { formatDateShort, formatHours } from "@/lib/format";
import type { DepartmentOption, MemberStatus } from "@/lib/types";

export type DocumentationRow = {
  memberId: string;
  memberCode: string;
  fullName: string;
  status: MemberStatus;
  departmentId: string;
  departmentName: string;
  positionName: string;
  documentationRecords: number;
  hoursRecords: number;
  contributionCount: number;
  hoursEntryCount: number;
  hoursTotal: number;
  documentationUpdatedAt: string | null;
  hoursUpdatedAt: string | null;
};

export function DocumentationOverview({ rows, departments }: { rows: DocumentationRow[]; departments: DepartmentOption[] }) {
  const [query, setQuery] = useState("");
  const [department, setDepartment] = useState("");
  const [type, setType] = useState<"" | "member_documentation" | "volunteer_hours_record">("");
  const [status, setStatus] = useState<"" | MemberStatus>("active");

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter(
      (row) =>
        (!needle || row.fullName.toLowerCase().includes(needle) || row.memberCode.toLowerCase().includes(needle)) &&
        (!department || row.departmentId === department) &&
        (!status || row.status === status),
    );
  }, [rows, query, department, status]);

  const showDocs = type !== "volunteer_hours_record";
  const showHours = type !== "member_documentation";

  return (
    <div className="rounded-lg border border-zinc-200 bg-white shadow-panel">
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 px-4 py-3">
        <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-zinc-400" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search for a member"
            aria-label="Search for a member"
            className="h-9 w-full rounded-md border border-zinc-300 bg-white pr-3 pl-9 text-[13.5px] placeholder:text-zinc-400 focus:border-brand-500 focus:ring-3 focus:ring-brand-500/15 focus:outline-none"
          />
        </div>
        <Select value={department} onChange={(event) => setDepartment(event.target.value)} aria-label="Filter by department" className="w-44">
          <option value="">All departments</option>
          {departments.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </Select>
        <Select value={type} onChange={(event) => setType(event.target.value as typeof type)} aria-label="Filter by document" className="w-52">
          <option value="">Both document formats</option>
          <option value="member_documentation">Member Documentation</option>
          <option value="volunteer_hours_record">Volunteer Hours Record</option>
        </Select>
        <Select value={status} onChange={(event) => setStatus(event.target.value as "" | MemberStatus)} aria-label="Filter by status" className="w-36">
          <option value="active">Active members</option>
          <option value="inactive">Inactive members</option>
          <option value="">All members</option>
        </Select>
        <p className="ml-auto text-[12.5px] text-zinc-500">{filtered.length} members</p>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={<FileText />} title={rows.length === 0 ? "No members yet" : "No members match these filters"} />
      ) : (
        <div className={tableStyles.wrapper}>
          <table className={tableStyles.table}>
            <thead>
              <tr>
                <th className={tableStyles.th}>Member</th>
                <th className={tableStyles.th}>Department</th>
                {showDocs && <th className={tableStyles.th}>Member Documentation</th>}
                {showHours && <th className={tableStyles.th}>Volunteer Hours Record</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr key={row.memberId} className={tableStyles.row}>
                  <td className={tableStyles.td}>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-zinc-900">{row.fullName}</span>
                      {row.status === "inactive" && <StatusBadge status="inactive" />}
                    </div>
                    <p className="text-[12px] text-zinc-500">
                      {row.positionName} · <span className="font-mono">{row.memberCode}</span>
                    </p>
                  </td>
                  <td className={cn(tableStyles.td, "whitespace-nowrap")}>{row.departmentName}</td>
                  {showDocs && (
                    <td className={tableStyles.td}>
                      <DocCell
                        href={`/admin/documentation/${row.memberId}?type=member_documentation`}
                        primary={`${row.contributionCount} ${row.contributionCount === 1 ? "entry" : "entries"}`}
                        secondary={`${row.documentationRecords} record${row.documentationRecords === 1 ? "" : "s"}${row.documentationUpdatedAt ? ` · updated ${formatDateShort(row.documentationUpdatedAt)}` : ""}`}
                      />
                    </td>
                  )}
                  {showHours && (
                    <td className={tableStyles.td}>
                      <DocCell
                        href={`/admin/documentation/${row.memberId}?type=volunteer_hours_record`}
                        primary={`${formatHours(row.hoursTotal)} hours`}
                        secondary={`${row.hoursEntryCount} row${row.hoursEntryCount === 1 ? "" : "s"}${row.hoursUpdatedAt ? ` · updated ${formatDateShort(row.hoursUpdatedAt)}` : ""}`}
                      />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function DocCell({ href, primary, secondary }: { href: string; primary: string; secondary: string }) {
  return (
    <Link href={href} className="group -mx-2 flex items-center gap-3 rounded-md px-2 py-1 transition-colors hover:bg-brand-50/60">
      <span className="min-w-0 flex-1">
        <span className="tabular block font-medium text-zinc-900 group-hover:text-brand-800">{primary}</span>
        <span className="block truncate text-[12px] text-zinc-500">{secondary}</span>
      </span>
      <span className="flex items-center gap-1 text-[12px] font-medium text-brand-700 opacity-0 transition-opacity group-hover:opacity-100">
        Open
        <ArrowRight className="size-3.5" />
      </span>
    </Link>
  );
}
