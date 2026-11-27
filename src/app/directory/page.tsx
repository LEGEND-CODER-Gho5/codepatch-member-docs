import type { Metadata } from "next";
import { DirectoryBoard } from "@/components/directory-board";
import { LiveRefresh } from "@/components/realtime";
import { SeasonBanner } from "@/components/season/season-banner";
import { SiteHeader } from "@/components/site-header";
import { requireSiteAccess } from "@/lib/server/auth";
import { formatHours } from "@/lib/format";
import { getChapterHoursTotal, getDirectory } from "@/lib/server/queries";
import { getOrgInfo } from "@/lib/server/settings";

export const metadata: Metadata = { title: "Member Directory" };

export default async function DirectoryPage() {
  const viewer = await requireSiteAccess();
  const [org, directory, chapterHours] = await Promise.all([getOrgInfo(), getDirectory(), getChapterHoursTotal()]);

  return (
    <div className="min-h-dvh">
      <SiteHeader org={org} viewer={viewer} current="directory" live />
      <LiveRefresh scopes={["directory"]} />
      <div className="border-b border-zinc-200 bg-surface">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-end justify-between gap-6 px-4 py-6 sm:px-6">
          <div>
            <p className="text-[12px] font-medium text-zinc-500">{org.chapterName}</p>
            <h1
              data-large-title="Member Directory"
              className="mt-1 font-serif text-[30px] leading-[1.15] font-medium tracking-[-0.01em] text-zinc-950 sm:text-[32px]"
            >
              Member Directory
            </h1>
            <p className="mt-2 max-w-xl text-[14.5px] leading-relaxed text-zinc-600">
              Select your name to open your documentation. You will be asked for your personal password.
            </p>
          </div>
          <dl className="flex divide-x divide-zinc-200 rounded-lg border border-zinc-200 bg-zinc-50/60">
            <div className="px-5 py-2.5">
              <dt className="text-[12px] font-medium text-zinc-500">Hours volunteered</dt>
              <dd className="tabular font-serif text-[26px] leading-tight font-medium text-zinc-950">{formatHours(chapterHours)}</dd>
            </div>
            <div className="px-5 py-2.5">
              <dt className="text-[12px] font-medium text-zinc-500">Active members</dt>
              <dd className="tabular font-serif text-[26px] leading-tight font-medium text-zinc-950">{directory.totalActive}</dd>
            </div>
            <div className="px-5 py-2.5">
              <dt className="text-[12px] font-medium text-zinc-500">Departments</dt>
              <dd className="tabular font-serif text-[26px] leading-tight font-medium text-zinc-950">{directory.departments.length}</dd>
            </div>
          </dl>
        </div>
      </div>
      <main className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6">
        <SeasonBanner
          message={
            chapterHours > 0
              ? `Thank you to every member. Together, the chapter has given ${formatHours(chapterHours)} hours of service.`
              : "Thank you to every member for being part of the chapter."
          }
        />
        <DirectoryBoard departments={directory.departments} currentMemberId={viewer.member?.id ?? null} />
      </main>
    </div>
  );
}
