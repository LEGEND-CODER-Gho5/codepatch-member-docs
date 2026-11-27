import { ArrowRight, Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { DocumentationOverview } from "@/components/admin/documentation-overview";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { Badge, EmptyState, PageHeader } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { formatHours, formatPlainDate } from "@/lib/format";
import { requireAdminPage } from "@/lib/server/auth";
import { getDocumentationOverview, listAllEntries, listDepartments, listMembers } from "@/lib/server/queries";

export const metadata: Metadata = { title: "Documentation Management" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function text(value: string | string[] | undefined) {
  return typeof value === "string" ? value : "";
}

export default async function DocumentationPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdminPage();
  const query = await searchParams;
  const view = text(query.view) === "entries" ? "entries" : "members";
  const departments = await listDepartments();
  const departmentOptions = departments.map((department) => ({ id: department.id, name: department.name }));

  const tabs = [
    { key: "members", label: "By member", href: "/admin/documentation" },
    { key: "entries", label: "All entries", href: "/admin/documentation?view=entries" },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="Documentation Management"
        description="Open any member's Member Documentation or Volunteer Hours Record directly — no member password is required. Every administrator change is recorded in Edit History."
      />
      <nav aria-label="Views" className="mb-4 flex gap-1 border-b border-zinc-200">
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={view === tab.key ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-[13.5px] font-medium transition-colors",
              view === tab.key ? "border-brand-700 text-zinc-950" : "border-transparent text-zinc-500 hover:text-zinc-800",
            )}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
      {view === "members" ? <MembersView departments={departmentOptions} /> : <EntriesView query={query} departments={departmentOptions} />}
    </>
  );
}

async function MembersView({ departments }: { departments: { id: string; name: string }[] }) {
  const rows = await getDocumentationOverview();
  return <DocumentationOverview rows={rows} departments={departments} />;
}

async function EntriesView({
  query,
  departments,
}: {
  query: Record<string, string | string[] | undefined>;
  departments: { id: string; name: string }[];
}) {
  const filters = { kind: text(query.kind), member: text(query.member), department: text(query.department), q: text(query.q) };
  const [entries, members] = await Promise.all([listAllEntries(filters), listMembers()]);

  return (
    <div className="rounded-lg border border-zinc-200 bg-surface shadow-panel">
      <form method="get" className="flex flex-wrap items-center gap-2 border-b border-zinc-200 px-4 py-3">
        <input type="hidden" name="view" value="entries" />
        <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-zinc-400" />
          <input
            type="search"
            name="q"
            defaultValue={filters.q}
            placeholder="Search entries"
            aria-label="Search entries"
            className="h-9 w-full rounded-md border border-zinc-300 bg-surface pr-3 pl-9 text-[13.5px] placeholder:text-zinc-400 focus:border-brand-500 focus:ring-3 focus:ring-brand-500/15 focus:outline-none"
          />
        </div>
        <Select name="member" defaultValue={filters.member} aria-label="Filter by member" className="w-48">
          <option value="">All members</option>
          {members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.fullName}
            </option>
          ))}
        </Select>
        <Select name="department" defaultValue={filters.department} aria-label="Filter by department" className="w-44">
          <option value="">All departments</option>
          {departments.map((department) => (
            <option key={department.id} value={department.id}>
              {department.name}
            </option>
          ))}
        </Select>
        <Select name="kind" defaultValue={filters.kind} aria-label="Filter by document" className="w-52">
          <option value="">Both document formats</option>
          <option value="contribution">Member Documentation</option>
          <option value="hours">Volunteer Hours Record</option>
        </Select>
        <Button type="submit" size="md">
          Apply
        </Button>
        {(filters.q || filters.member || filters.department || filters.kind) && (
          <Link href="/admin/documentation?view=entries" className="px-1 text-[12.5px] font-medium text-zinc-500 hover:text-zinc-900">
            Clear
          </Link>
        )}
        <p className="ml-auto text-[12.5px] text-zinc-500">
          {entries.length} {entries.length === 1 ? "entry" : "entries"}
          {entries.length === 300 ? " (most recent 300)" : ""}
        </p>
      </form>

      {entries.length === 0 ? (
        <EmptyState title="No entries found" description="Entries appear here as members document their contributions and hours." />
      ) : (
        <ul className="divide-y divide-zinc-100">
          {entries.map((entry) => (
            <li key={`${entry.kind}-${entry.id}`}>
              <Link
                href={`/admin/documentation/${entry.memberId}?type=${entry.kind === "hours" ? "volunteer_hours_record" : "member_documentation"}&doc=${entry.documentId}`}
                className="group flex gap-4 px-4 py-3 transition-colors hover:bg-zinc-50"
              >
                <div className="w-28 shrink-0 text-[12.5px] text-zinc-500">
                  {entry.date ? formatPlainDate(entry.date, "short") : "Undated"}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-[13px]">
                    <span className="font-medium text-zinc-900">{entry.memberName}</span>
                    <span className="text-zinc-400">·</span>
                    <span className="text-zinc-500">{entry.departmentName}</span>
                    <Badge tone={entry.kind === "hours" ? "info" : "brand"}>
                      {entry.kind === "hours" ? "Volunteer Hours" : "Member Documentation"}
                    </Badge>
                    {entry.kind === "hours" && <span className="tabular font-medium text-zinc-900">{formatHours(entry.hours)} hrs</span>}
                  </p>
                  {entry.title && <p className="mt-1 text-[13px] font-medium text-zinc-800">{entry.title}</p>}
                  {entry.body && <p className="mt-0.5 line-clamp-2 text-[13px] whitespace-pre-line text-zinc-600">{entry.body}</p>}
                </div>
                <ArrowRight className="mt-1 size-4 shrink-0 text-zinc-300 group-hover:text-zinc-500" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
