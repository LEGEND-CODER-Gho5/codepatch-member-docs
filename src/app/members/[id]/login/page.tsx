import { ArrowLeft, LayoutDashboard, Lock } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { memberLoginAction } from "@/actions/auth";
import { PasswordLoginForm } from "@/components/password-login-form";
import { SiteHeader } from "@/components/site-header";
import { buttonStyles } from "@/components/ui/button";
import { Avatar } from "@/components/ui/primitives";
import { requireSiteAccess } from "@/lib/server/auth";
import { getWorkspaceMember } from "@/lib/server/queries";
import { getOrgInfo } from "@/lib/server/settings";
import { isUuid } from "@/lib/validation";

export const metadata: Metadata = { title: "Documentation sign-in" };

export default async function MemberLoginPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const viewer = await requireSiteAccess();
  if (viewer.member?.id === id) redirect(`/members/${id}`);
  const member = await getWorkspaceMember(id);
  if (!member || member.status !== "active") notFound();
  const org = await getOrgInfo();

  return (
    <div className="min-h-dvh">
      <SiteHeader org={org} viewer={viewer} />
      <main className="mx-auto flex max-w-[1440px] justify-center px-4 py-12 sm:py-16">
        <div className="w-full max-w-[400px]">
          <Link href="/directory" className="mb-5 inline-flex items-center gap-1.5 text-[13px] text-zinc-500 hover:text-zinc-900">
            <ArrowLeft className="size-4" />
            Back to directory
          </Link>
          <div className="rounded-lg border border-zinc-200 bg-white shadow-panel">
            <div className="flex items-center gap-3 border-b border-zinc-200 px-6 py-5">
              <Avatar name={member.fullName} className="size-10 text-[13px]" />
              <div className="min-w-0">
                <h1 className="truncate text-[16px] font-semibold text-zinc-950">{member.fullName}</h1>
                <p className="truncate text-[12.5px] text-zinc-500">
                  {member.positionName} · {member.departmentName}
                </p>
              </div>
            </div>
            <div className="px-6 py-6">
              <p className="mb-5 flex items-start gap-2 text-[13px] leading-relaxed text-zinc-600">
                <Lock className="mt-0.5 size-4 shrink-0 text-zinc-400" />
                Enter your personal password to open your Member Documentation and Volunteer Hours Record.
              </p>
              <PasswordLoginForm
                action={memberLoginAction}
                label="Personal password"
                submitLabel="Open my documentation"
                hidden={{ memberId: member.id }}
                footer="Your password was issued by the chapter administrator, who can reset it if needed."
              />
            </div>
          </div>
          {viewer.admin && (
            <Link
              href={`/admin/documentation/${member.id}`}
              className={buttonStyles({ variant: "secondary", size: "sm", className: "mt-4 w-full" })}
            >
              <LayoutDashboard />
              Open as administrator
            </Link>
          )}
        </div>
      </main>
    </div>
  );
}
