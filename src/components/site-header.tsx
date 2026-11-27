import { LayoutDashboard, LogOut, Shield } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { exitSiteAction } from "@/actions/auth";
import { Wordmark } from "@/components/brand";
import { LiveIndicator } from "@/components/realtime";
import { buttonStyles } from "@/components/ui/button";
import { HeaderTools } from "@/components/preferences/header-tools";
import { SeasonRibbon } from "@/components/season/season-icons";
import { CompactTitle } from "@/components/ui/large-title";
import { cn } from "@/lib/cn";
import type { Viewer } from "@/lib/server/auth";
import type { OrgInfo } from "@/lib/types";

function HeaderLink({ href, active, children }: { href: string; active?: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "rounded-md px-2.5 py-1.5 text-[13px] font-medium whitespace-nowrap transition-colors",
        active ? "bg-white/10 text-white" : "text-zinc-400 hover:bg-white/5 hover:text-white",
      )}
    >
      {children}
    </Link>
  );
}

export function SiteHeader({
  org,
  viewer,
  current,
  live = false,
}: {
  org: OrgInfo;
  viewer: Viewer;
  current?: "directory" | "workspace";
  live?: boolean;
}) {
  const links = (
    <>
      <HeaderLink href="/directory" active={current === "directory"}>
        Directory
      </HeaderLink>
      {viewer.member && (
        <HeaderLink href={`/members/${viewer.member.id}`} active={current === "workspace"}>
          My documentation
        </HeaderLink>
      )}
      <HeaderLink href="/welcome">Policies</HeaderLink>
    </>
  );

  return (
    <header className="theme-fixed sticky top-0 z-30 border-b border-black/40 bg-charcoal-950 print:hidden">
      <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-5 px-4 sm:px-6">
        <Link href="/directory" className="min-w-0 rounded-md">
          {/* Once the page title scrolls away, it takes the wordmark's place in this bar. */}
          <CompactTitle titleClassName="text-white">
            <Wordmark organizationName={org.organizationName} subtitle="Member Documentation" tone="light" />
          </CompactTitle>
        </Link>
        <nav aria-label="Primary" className="hidden items-center gap-1 md:flex">
          {links}
        </nav>
        <div className="ml-auto flex items-center gap-2.5">
          {live && <LiveIndicator tone="dark" className="mr-1 hidden sm:inline-flex" />}
          <HeaderTools tone="dark" />
          {viewer.admin ? (
            <Link href="/admin" className={buttonStyles({ variant: "dark", size: "sm" })}>
              <LayoutDashboard />
              <span className="hidden sm:inline">Admin dashboard</span>
            </Link>
          ) : (
            <Link href="/admin/login" className={buttonStyles({ variant: "dark", size: "sm" })}>
              <Shield />
              <span className="hidden sm:inline">Administrator</span>
            </Link>
          )}
          <form action={exitSiteAction}>
            <button type="submit" className={buttonStyles({ variant: "dark", size: "sm" })} title="Sign out of the website">
              <LogOut />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </form>
        </div>
      </div>
      <nav aria-label="Primary" className="flex gap-1 overflow-x-auto border-t border-white/5 px-3 py-1.5 md:hidden">
        {links}
      </nav>
      <SeasonRibbon />
    </header>
  );
}
