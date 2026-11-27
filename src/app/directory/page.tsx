import type { Metadata } from "next";
import { DirectoryBoard } from "@/components/directory-board";
import { LiveRefresh } from "@/components/realtime";
import { SiteHeader } from "@/components/site-header";
import { requireSiteAccess } from "@/lib/server/auth";
import { getDirectory } from "@/lib/server/queries";
import { getOrgInfo } from "@/lib/server/settings";

export const metadata: Metadata = { title: "Member Directory" };

export default async function DirectoryPage() {
  const viewer = await requireSiteAccess();
  const [org, directory] = await Promise.all([getOrgInfo(), getDirectory()]);

  return (
    <div className="min-h-dvh">
      <SiteHeader org={org} viewer={viewer} current="directory" live />
      <LiveRefresh scopes={["directory"]} />
      <div className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-end justify-between gap-6 px-4 py-6 sm:px-6">
          <div>
            <p className="text-[12px] font-medium text-zinc-500">{org.chapterName}</p>
            <h1 className="mt-1 text-[22px] leading-tight font-semibold tracking-[-0.01em] text-zinc-950">Member Directory</h1>
            <p className="mt-1 max-w-xl text-[13.5px] text-zinc-600">
              Select your name to open your documentation. You will be asked for your personal password.
            </p>
          </div>
          <dl className="flex divide-x divide-zinc-200 rounded-lg border border-zinc-200 bg-zinc-50/60">
            <div className="px-5 py-2.5">
              <dt className="text-[11px] font-semibold tracking-[0.06em] text-zinc-500 uppercase">Active members</dt>
              <dd className="tabular text-[24px] leading-tight font-semibold text-zinc-950">{directory.totalActive}</dd>
            </div>
            <div className="px-5 py-2.5">
              <dt className="text-[11px] font-semibold tracking-[0.06em] text-zinc-500 uppercase">Departments</dt>
              <dd className="tabular text-[24px] leading-tight font-semibold text-zinc-950">{directory.departments.length}</dd>
            </div>
          </dl>
        </div>
      </div>
      <main className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6">
        <DirectoryBoard departments={directory.departments} currentMemberId={viewer.member?.id ?? null} />
      </main>
    </div>
  );
}
