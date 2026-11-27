import { ArrowLeft, ArrowRight, FileText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActivityList } from "@/components/admin/activity-list";
import { MemberProfileActions } from "@/components/admin/member-actions";
import { Avatar, KeyValue, PageHeader, Panel, StatusBadge } from "@/components/ui/primitives";
import { DOCUMENT_TYPE_LABEL } from "@/lib/document-text";
import { formatDateTime, formatHours, formatPlainDate } from "@/lib/format";
import { requireAdminPage } from "@/lib/server/auth";
import { getMember, listDocumentSummaries, listRecentActivity } from "@/lib/server/queries";
import type { DocumentType } from "@/lib/types";

export const metadata: Metadata = { title: "Member profile" };

export default async function MemberProfilePage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPage();
  const { id } = await params;
  const member = await getMember(id);
  if (!member) notFound();
  const [summaries, activity] = await Promise.all([listDocumentSummaries(id), listRecentActivity(15, { memberId: id })]);

  const types: DocumentType[] = ["member_documentation", "volunteer_hours_record"];

  return (
    <>
      <Link href="/admin/members" className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-zinc-500 hover:text-zinc-900">
        <ArrowLeft className="size-4" />
        Member Management
      </Link>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            <Avatar name={member.fullName} className="size-10 text-[13px]" />
            {member.fullName}
            <StatusBadge status={member.status} />
          </span>
        }
        description={`${member.positionName} · ${member.departmentName} · ${member.memberCode}`}
        actions={
          <MemberProfileActions
            member={{
              id: member.id,
              fullName: member.fullName,
              departmentId: member.departmentId,
              positionId: member.positionId,
              status: member.status,
              email: member.email,
              startDate: member.startDate,
            }}
          />
        }
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <div className="space-y-6">
          <Panel title="Member details">
            <dl className="divide-y divide-zinc-100 px-4">
              <KeyValue label="Member ID">
                <span className="font-mono">{member.memberCode}</span>
              </KeyValue>
              <KeyValue label="Full name">{member.fullName}</KeyValue>
              <KeyValue label="Department">{member.departmentName}</KeyValue>
              <KeyValue label="Position/Role">{member.positionName}</KeyValue>
              <KeyValue label="Status">
                <StatusBadge status={member.status} />
                {member.deactivatedAt && <span className="ml-2 text-zinc-500">since {formatDateTime(member.deactivatedAt)}</span>}
              </KeyValue>
              <KeyValue label="Email address">{member.email ?? <span className="text-zinc-400">Not provided</span>}</KeyValue>
              <KeyValue label="Start date">{member.startDate ? formatPlainDate(member.startDate) : <span className="text-zinc-400">Not set</span>}</KeyValue>
              <KeyValue label="Account created">{formatDateTime(member.createdAt)}</KeyValue>
              <KeyValue label="Last sign-in">{member.lastLoginAt ? formatDateTime(member.lastLoginAt) : <span className="text-zinc-400">Never</span>}</KeyValue>
              <KeyValue label="Password set">{member.passwordChangedAt ? formatDateTime(member.passwordChangedAt) : "—"}</KeyValue>
            </dl>
          </Panel>

          <Panel title="Documentation" description="Both formats are issued automatically to every member">
            <ul className="divide-y divide-zinc-100">
              {types.map((type) => {
                const records = summaries.filter((summary) => summary.documentType === type);
                const entries = records.reduce((sum, summary) => sum + summary.entryCount, 0);
                const hours = records.reduce((sum, summary) => sum + summary.hoursTotal, 0);
                return (
                  <li key={type}>
                    <Link
                      href={`/admin/documentation/${member.id}?type=${type}`}
                      className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-zinc-50"
                    >
                      <FileText className="size-4 text-zinc-400" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13.5px] font-medium text-zinc-900">{DOCUMENT_TYPE_LABEL[type]}</span>
                        <span className="block text-[12px] text-zinc-500">
                          {records.length} record{records.length === 1 ? "" : "s"} ·{" "}
                          {type === "volunteer_hours_record" ? `${formatHours(hours)} hours · ${entries} rows` : `${entries} entries`}
                        </span>
                      </span>
                      <ArrowRight className="size-4 text-zinc-300 group-hover:text-zinc-500" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Panel>
        </div>

        <Panel
          title="Activity"
          description="Every recorded change involving this member"
          actions={
            <Link
              href={`/admin/history?q=${encodeURIComponent(member.fullName)}`}
              className="text-[12.5px] font-medium text-brand-700 hover:text-brand-900"
            >
              Full history
            </Link>
          }
        >
          <ActivityList items={activity} />
        </Panel>
      </div>
    </>
  );
}
