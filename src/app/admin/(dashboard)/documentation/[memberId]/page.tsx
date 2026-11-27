import { ArrowLeft, UserRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DocumentWorkspace } from "@/components/documents/workspace";
import { ButtonLink } from "@/components/ui/button";
import { Avatar, PageHeader, StatusBadge } from "@/components/ui/primitives";
import { formatDepartments } from "@/lib/format";
import { requireAdminPage } from "@/lib/server/auth";
import { getDocumentRecord, getWorkspaceMember, listDocumentSummaries, listRecentActivity } from "@/lib/server/queries";
import { getOrgInfo } from "@/lib/server/settings";
import type { DocumentType } from "@/lib/types";

export const metadata: Metadata = { title: "Member documentation" };

export default async function AdminMemberDocumentationPage({
  params,
  searchParams,
}: {
  params: Promise<{ memberId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminPage();
  const { memberId } = await params;
  const query = await searchParams;
  const member = await getWorkspaceMember(memberId);
  if (!member) notFound();

  const [org, summaries] = await Promise.all([getOrgInfo(), listDocumentSummaries(memberId)]);
  const activeType: DocumentType = query.type === "volunteer_hours_record" ? "volunteer_hours_record" : "member_documentation";
  const ofType = summaries.filter((summary) => summary.documentType === activeType);
  const selected = ofType.find((summary) => summary.id === query.doc) ?? ofType[0];
  const [record, history] = selected
    ? await Promise.all([getDocumentRecord(selected.id), listRecentActivity(20, { documentId: selected.id })])
    : [null, []];

  return (
    <>
      <Link href="/admin/documentation" className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-zinc-500 hover:text-zinc-900 print:hidden">
        <ArrowLeft className="size-4" />
        Documentation Management
      </Link>
      <div className="print:hidden">
        <PageHeader
          title={
            <span className="flex flex-wrap items-center gap-3">
              <Avatar name={member.fullName} className="size-10 text-[13px]" />
              {member.fullName}
              {member.status === "inactive" && <StatusBadge status="inactive" />}
            </span>
          }
          description={`${member.positionName} · ${formatDepartments(member.departmentName, member.otherDepartmentNames)} · ${member.memberCode}`}
          actions={
            <ButtonLink href={`/admin/members/${member.id}`}>
              <UserRound />
              Member profile
            </ButtonLink>
          }
        />
      </div>
      <DocumentWorkspace
        mode="admin"
        member={member}
        org={org}
        summaries={summaries}
        activeType={activeType}
        record={record}
        basePath={`/admin/documentation/${member.id}`}
        history={history}
      />
    </>
  );
}
