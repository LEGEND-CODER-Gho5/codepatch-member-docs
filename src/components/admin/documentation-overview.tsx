"use client";

import { ArrowRight, Clock, FileText, Search, UserRound } from "lucide-react";
import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { Select } from "@/components/ui/field";
import { useActionMenu } from "@/components/ui/gestures";
import { Seal } from "@/components/ui/seal";
import { Badge, EmptyState, StatusBadge, tableStyles } from "@/components/ui/primitives";
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
  otherDepartments: { id: string; name: string }[];
  positionName: string;
  documentationRecords: number;
  hoursRecords: number;
  contributionCount: number;
  hoursEntryCount: number;
  hoursTotal: number;
  documentationUpdatedAt: string | null;
  hoursUpdatedAt: string | null;
  documentationToVerify: number;
  hoursToVerify: number;
  verifiedHours: number;
};

export function DocumentationOverview({
  rows,
  departments,
  initialVerification = "",
}: {
  rows: DocumentationRow[];
  departments: DepartmentOption[];
  /** "needed" opens the list filtered to records that need verifying (Overview → Review records). */
  initialVerification?: "" | "needed";
}) {
  const [query, setQuery] = useState("");
  const [department, setDepartment] = useState("");
  const [type, setType] = useState<"" | "member_documentation" | "volunteer_hours_record">("");
  const [status, setStatus] = useState<"" | MemberStatus>("active");
  const [verification, setVerification] = useState<"" | "needed">(initialVerification);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter(
      (row) =>
        (!needle || row.fullName.toLowerCase().includes(needle) || row.memberCode.toLowerCase().includes(needle)) &&
        (!department || row.departmentId === department || row.otherDepartments.some((other) => other.id === department)) &&
        (!status || row.status === status) &&
        (!verification ||
          (type !== "volunteer_hours_record" && row.documentationToVerify > 0) ||
          (type !== "member_documentation" && row.hoursToVerify > 0)),
    );
  }, [rows, query, department, status, verification, type]);

  const showDocs = type !== "volunteer_hours_record";
  const showHours = type !== "member_documentation";

  return (
    <div className="rounded-lg border border-zinc-200 bg-surface shadow-panel">
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 px-4 py-3">
        <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-zinc-400" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search for a member"
            aria-label="Search for a member"
            className="h-9 w-full rounded-md border border-zinc-300 bg-surface pr-3 pl-9 text-[13.5px] placeholder:text-zinc-400 focus:border-brand-500 focus:ring-3 focus:ring-brand-500/15 focus:outline-none"
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
        <Select
          value={verification}
          onChange={(event) => setVerification(event.target.value as "" | "needed")}
          aria-label="Filter by verification"
          className="w-48"
        >
          <option value="">Verified or not</option>
          <option value="needed">Needs verification</option>
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
                <OverviewRow key={row.memberId} row={row}>
                  <td className={tableStyles.td}>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-zinc-900">{row.fullName}</span>
                      {row.status === "inactive" && <StatusBadge status="inactive" />}
                    </div>
                    <p className="text-[12px] text-zinc-500">
                      {row.positionName} · <span className="font-mono">{row.memberCode}</span>
                    </p>
                  </td>
                  <td className={cn(tableStyles.td, "whitespace-nowrap")}>
                    {row.departmentName}
                    {row.otherDepartments.length > 0 && (
                      <span className="block text-[12px] text-zinc-500">also {row.otherDepartments.map((other) => other.name).join(", ")}</span>
                    )}
                  </td>
                  {showDocs && (
                    <td className={tableStyles.td}>
                      <DocCell
                        href={`/admin/documentation/${row.memberId}?type=member_documentation`}
                        primary={`${row.contributionCount} ${row.contributionCount === 1 ? "entry" : "entries"}`}
                        secondary={`${row.documentationRecords} record${row.documentationRecords === 1 ? "" : "s"}${row.documentationUpdatedAt ? ` · updated ${formatDateShort(row.documentationUpdatedAt)}` : ""}`}
                        toVerify={row.documentationToVerify}
                        hasEntries={row.contributionCount > 0}
                      />
                    </td>
                  )}
                  {showHours && (
                    <td className={tableStyles.td}>
                      <DocCell
                        href={`/admin/documentation/${row.memberId}?type=volunteer_hours_record`}
                        primary={`${formatHours(row.hoursTotal)} hours`}
                        secondary={`${row.hoursEntryCount} row${row.hoursEntryCount === 1 ? "" : "s"} · ${formatHours(row.verifiedHours)} verified${row.hoursUpdatedAt ? ` · updated ${formatDateShort(row.hoursUpdatedAt)}` : ""}`}
                        toVerify={row.hoursToVerify}
                        hasEntries={row.hoursEntryCount > 0}
                      />
                    </td>
                  )}
                </OverviewRow>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function DocCell({
  href,
  primary,
  secondary,
  toVerify,
  hasEntries,
}: {
  href: string;
  primary: string;
  secondary: string;
  toVerify: number;
  hasEntries: boolean;
}) {
  return (
    <Link href={href} className="group -mx-2 flex items-center gap-3 rounded-md px-2 py-1 transition-colors hover:bg-brand-50/60">
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="tabular font-medium text-zinc-900 group-hover:text-brand-800">{primary}</span>
          {toVerify > 0 ? (
            <Badge tone="warning">{toVerify} to verify</Badge>
          ) : (
            hasEntries && (
              <span className="flex items-center gap-1 text-[11.5px] font-medium text-emerald-700">
                <Seal size={14} />
                Verified
              </span>
            )
          )}
        </span>
        <span className="block truncate text-[12px] text-zinc-500">{secondary}</span>
      </span>
      <span className="flex items-center gap-1 text-[12px] font-medium text-brand-700 opacity-0 transition-opacity group-hover:opacity-100">
        Open
        <ArrowRight className="size-3.5" />
      </span>
    </Link>
  );
}

/** A member's row; long press (phones) or right-click (computers) opens shortcuts to their records. */
function OverviewRow({ row, children }: { row: DocumentationRow; children: ReactNode }) {
  const menu = useActionMenu(
    [
      { label: "Member Documentation", icon: <FileText />, href: `/admin/documentation/${row.memberId}?type=member_documentation` },
      { label: "Volunteer Hours Record", icon: <Clock />, href: `/admin/documentation/${row.memberId}?type=volunteer_hours_record` },
      "separator",
      { label: "Member profile", icon: <UserRound />, href: `/admin/members/${row.memberId}` },
    ],
    `Records of ${row.fullName}`,
  );
  return (
    <>
      <tr {...menu.handlers} className={cn(tableStyles.row, menu.liftClass)}>
        {children}
      </tr>
      {menu.menu}
    </>
  );
}
