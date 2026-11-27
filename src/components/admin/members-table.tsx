"use client";

import { FileText, KeyRound, Pencil, Search, Trash, UserCheck, UserRound, Users, UserX } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Select } from "@/components/ui/field";
import { Menu } from "@/components/ui/menu";
import { Avatar, EmptyState, StatusBadge, tableStyles } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { formatDateShort, formatHours, formatPlainDate } from "@/lib/format";
import type { DepartmentOption, MemberStatus, PositionOption } from "@/lib/types";
import { AddMemberTrigger } from "./admin-shell";
import { useMemberActions } from "./member-actions";

export type MemberTableRow = {
  id: string;
  memberCode: string;
  fullName: string;
  email: string | null;
  status: MemberStatus;
  startDate: string | null;
  departmentId: string;
  departmentName: string;
  positionId: string;
  positionName: string;
  hoursTotal: number;
  contributionCount: number;
  lastActivityAt: string | null;
};

export function MembersTable({
  members,
  departments,
  positions,
}: {
  members: MemberTableRow[];
  departments: DepartmentOption[];
  positions: PositionOption[];
}) {
  const [query, setQuery] = useState("");
  const [department, setDepartment] = useState("");
  const [position, setPosition] = useState("");
  const [status, setStatus] = useState<"" | MemberStatus>("");
  const actions = useMemberActions();

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return members.filter(
      (member) =>
        (!needle ||
          member.fullName.toLowerCase().includes(needle) ||
          member.memberCode.toLowerCase().includes(needle) ||
          (member.email ?? "").toLowerCase().includes(needle)) &&
        (!department || member.departmentId === department) &&
        (!position || member.positionId === position) &&
        (!status || member.status === status),
    );
  }, [members, query, department, position, status]);

  const activeCount = members.filter((member) => member.status === "active").length;
  const filtering = Boolean(query || department || position || status);

  return (
    <div className="rounded-lg border border-zinc-200 bg-white shadow-panel">
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 px-4 py-3">
        <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-zinc-400" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search name, ID, or email"
            aria-label="Search members"
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
        <Select value={position} onChange={(event) => setPosition(event.target.value)} aria-label="Filter by position" className="w-40">
          <option value="">All positions</option>
          {positions.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </Select>
        <Select value={status} onChange={(event) => setStatus(event.target.value as "" | MemberStatus)} aria-label="Filter by status" className="w-36">
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </Select>
        {filtering && (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setDepartment("");
              setPosition("");
              setStatus("");
            }}
            className="px-1 text-[12.5px] font-medium text-zinc-500 hover:text-zinc-900"
          >
            Clear filters
          </button>
        )}
        <p className="ml-auto text-[12.5px] text-zinc-500">
          {filtering ? `${filtered.length} of ${members.length}` : members.length} members · {activeCount} active
        </p>
      </div>

      {members.length === 0 ? (
        <EmptyState
          icon={<Users />}
          title="No members yet"
          description="Add the first member to generate their password and documentation."
          action={<AddMemberTrigger />}
        />
      ) : filtered.length === 0 ? (
        <EmptyState icon={<Search />} title="No members match these filters" />
      ) : (
        <div className={tableStyles.wrapper}>
          <table className={tableStyles.table}>
            <thead>
              <tr>
                <th className={tableStyles.th}>Member</th>
                <th className={tableStyles.th}>Department</th>
                <th className={tableStyles.th}>Position/Role</th>
                <th className={tableStyles.th}>Status</th>
                <th className={cn(tableStyles.th, "text-right")}>Hours</th>
                <th className={cn(tableStyles.th, "text-right")}>Entries</th>
                <th className={tableStyles.th}>Start date</th>
                <th className={tableStyles.th}>Last activity</th>
                <th className={cn(tableStyles.th, "w-12")}>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((member) => {
                const target = { id: member.id, fullName: member.fullName };
                return (
                  <tr key={member.id} className={cn(tableStyles.row, member.status === "inactive" && "text-zinc-500")}>
                    <td className={tableStyles.td}>
                      <Link href={`/admin/members/${member.id}`} className="group flex items-center gap-3">
                        <Avatar name={member.fullName} />
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-zinc-900 group-hover:text-brand-800 group-hover:underline">
                            {member.fullName}
                          </span>
                          <span className="block truncate text-[12px] text-zinc-500">
                            <span className="font-mono">{member.memberCode}</span>
                            {member.email && <> · {member.email}</>}
                          </span>
                        </span>
                      </Link>
                    </td>
                    <td className={cn(tableStyles.td, "whitespace-nowrap")}>{member.departmentName}</td>
                    <td className={cn(tableStyles.td, "whitespace-nowrap")}>{member.positionName}</td>
                    <td className={tableStyles.td}>
                      <StatusBadge status={member.status} />
                    </td>
                    <td className={cn(tableStyles.td, "tabular text-right")}>{formatHours(member.hoursTotal)}</td>
                    <td className={cn(tableStyles.td, "tabular text-right")}>{member.contributionCount}</td>
                    <td className={cn(tableStyles.td, "whitespace-nowrap text-zinc-600")}>
                      {member.startDate ? formatPlainDate(member.startDate, "short") : "—"}
                    </td>
                    <td className={cn(tableStyles.td, "whitespace-nowrap text-zinc-600")}>
                      {member.lastActivityAt ? formatDateShort(member.lastActivityAt) : "—"}
                    </td>
                    <td className={cn(tableStyles.td, "py-1 text-right")}>
                      <Menu
                        label={`Actions for ${member.fullName}`}
                        items={[
                          { label: "View profile", icon: <UserRound />, href: `/admin/members/${member.id}` },
                          { label: "Open documentation", icon: <FileText />, href: `/admin/documentation/${member.id}` },
                          "separator",
                          {
                            label: "Edit member",
                            icon: <Pencil />,
                            onSelect: () =>
                              actions.edit({
                                id: member.id,
                                fullName: member.fullName,
                                departmentId: member.departmentId,
                                positionId: member.positionId,
                                status: member.status,
                                email: member.email,
                                startDate: member.startDate,
                              }),
                          },
                          { label: "Reset password", icon: <KeyRound />, onSelect: () => actions.resetPassword(target) },
                          {
                            label: member.status === "active" ? "Deactivate" : "Reactivate",
                            icon: member.status === "active" ? <UserX /> : <UserCheck />,
                            onSelect: () => actions.toggleStatus({ ...target, status: member.status }),
                          },
                          "separator",
                          { label: "Delete member", icon: <Trash />, tone: "danger", onSelect: () => actions.remove(target) },
                        ]}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {actions.dialogs}
    </div>
  );
}
