import { LogOut } from "lucide-react";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { memberLogoutAction } from "@/actions/auth";
import { DocumentWorkspace } from "@/components/documents/workspace";
import { LiveRefresh } from "@/components/realtime";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/primitives";
import { getViewer } from "@/lib/server/auth";
import { getDocumentRecord, getWorkspaceMember, listDocumentSummaries } from "@/lib/server/queries";
import { getOrgInfo } from "@/lib/server/settings";
import type { DocumentType } from "@/lib/types";
import { isUuid } from "@/lib/validation";

export const metadata: Metadata = { title: "My documentation" };

export default async function MemberWorkspacePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const query = await searchParams;

  // Server-side authorization: only this member's own session may open this page.
  const viewer = await getViewer();
  if (!viewer.siteAccess) redirect("/login");
  if (!viewer.member || viewer.member.id !== id) {
    if (viewer.admin) redirect(`/admin/documentation/${id}`);
    redirect(`/members/${id}/login`);
  }

  const [org, member, summaries] = await Promise.all([getOrgInfo(), getWorkspaceMember(id), listDocumentSummaries(id)]);
  if (!member) notFound();

  const activeType: DocumentType = query.type === "volunteer_hours_record" ? "volunteer_hours_record" : "member_documentation";
  const ofType = summaries.filter((summary) => summary.documentType === activeType);
  // Only documents that belong to this member can be selected.
  const selected = ofType.find((summary) => summary.id === query.doc) ?? ofType[0];
  const record = selected ? await getDocumentRecord(selected.id) : null;

  return (
    <div className="min-h-dvh">
      <SiteHeader org={org} viewer={viewer} current="workspace" live />
      <LiveRefresh scopes={["member", "directory"]} memberId={id} />
      <div className="border-b border-zinc-200 bg-white print:hidden">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-4 px-4 py-5 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Avatar name={member.fullName} className="size-10 text-[13px]" />
            <div className="min-w-0">
              <h1 className="truncate text-[19px] leading-tight font-semibold tracking-[-0.01em] text-zinc-950">{member.fullName}</h1>
              <p className="mt-0.5 truncate text-[12.5px] text-zinc-500">
                {member.positionName} · {member.departmentName} · <span className="font-mono">{member.memberCode}</span>
              </p>
            </div>
          </div>
          <form action={memberLogoutAction}>
            <Button type="submit" size="sm">
              <LogOut />
              Sign out of documentation
            </Button>
          </form>
        </div>
      </div>
      <main className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6 print:max-w-none print:p-0">
        <DocumentWorkspace
          mode="member"
          member={member}
          org={org}
          summaries={summaries}
          activeType={activeType}
          record={record}
          basePath={`/members/${id}`}
        />
      </main>
    </div>
  );
}
