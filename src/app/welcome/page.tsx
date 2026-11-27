import { ArrowLeft, LogOut, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { acceptRulesAction, exitSiteAction } from "@/actions/auth";
import { AcceptRulesForm } from "@/components/accept-rules-form";
import { Wordmark } from "@/components/brand";
import { RulesText } from "@/components/rules-text";
import { buttonStyles, ButtonLink } from "@/components/ui/button";
import { formatDateLong } from "@/lib/format";
import { getViewer } from "@/lib/server/auth";
import { getOrgInfo, getSettings } from "@/lib/server/settings";
import { effectiveRules, PORTAL_GUIDE } from "@/lib/site-rules";

export const metadata: Metadata = { title: "Welcome" };

function safePath(value: unknown): string | null {
  return typeof value === "string" && /^\/[A-Za-z0-9\-._~/?=&%]*$/.test(value) && !value.startsWith("//") && value.length < 200
    ? value
    : null;
}

export default async function WelcomePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await getViewer();
  if (!viewer.siteAccess) redirect("/login");
  const params = await searchParams;
  const next = safePath(params.next);
  const [org, settings] = await Promise.all([getOrgInfo(), getSettings()]);
  if (!settings) redirect("/login");
  const mustAccept = viewer.rulesPending;

  return (
    <div className="min-h-dvh bg-zinc-50">
      <header className="border-b border-black/40 bg-charcoal-950">
        <div className="mx-auto flex h-14 max-w-[760px] items-center justify-between gap-4 px-4">
          <Wordmark organizationName={org.organizationName} subtitle="Member Documentation" tone="light" />
          <form action={exitSiteAction}>
            <button type="submit" className={buttonStyles({ variant: "dark", size: "sm" })}>
              <LogOut />
              Sign out
            </button>
          </form>
        </div>
      </header>

      <main className="mx-auto max-w-[760px] px-4 pt-10 pb-16">
        <p className="text-[13px] font-medium text-brand-700">
          {org.organizationName}, {org.chapterName}
        </p>
        <h1 className="mt-1.5 text-[28px] leading-tight font-semibold tracking-[-0.015em] text-zinc-950">Welcome to the member portal</h1>
        <p className="mt-3 max-w-[62ch] text-[15px] leading-relaxed text-zinc-600">
          {mustAccept
            ? "Before you open the member directory, read how the portal works and the chapter's policies and procedures."
            : "How the portal works, and the chapter's policies and procedures."}
        </p>

        <section aria-labelledby="guide" className="mt-10">
          <h2 id="guide" className="text-[18px] font-semibold text-zinc-950">
            How to use the portal
          </h2>
          <ol className="mt-4 space-y-4">
            {PORTAL_GUIDE.map((step, index) => (
              <li key={step.title} className="flex gap-4">
                <span
                  aria-hidden
                  className="tabular flex size-8 shrink-0 items-center justify-center rounded-full border-2 border-dashed border-brand-400 text-[14px] font-semibold text-brand-800"
                >
                  {index + 1}
                </span>
                <div className="pt-1">
                  <p className="text-[15px] font-semibold text-zinc-900">{step.title}</p>
                  <p className="mt-0.5 text-[14px] leading-relaxed text-zinc-600">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="policies" className="mt-12">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="policies" className="text-[18px] font-semibold text-zinc-950">
              Policies and procedures
            </h2>
            {settings.site_rules_updated_at && (
              <p className="text-[12.5px] text-zinc-500">Updated {formatDateLong(settings.site_rules_updated_at)}</p>
            )}
          </div>
          <div className="mt-4 rounded-lg border border-zinc-200 bg-white px-6 py-5">
            <RulesText text={effectiveRules(settings.site_rules)} />
          </div>
        </section>

        <section aria-label="Agreement" className="mt-8 rounded-lg border border-brand-200 bg-brand-50/70 px-6 py-5">
          {mustAccept ? (
            <AcceptRulesForm action={acceptRulesAction} version={settings.site_rules_version} next={next} />
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-4">
              <p className="flex items-center gap-2 text-[14px] text-brand-900">
                <ShieldCheck className="size-5 text-brand-600" />
                You have accepted these policies for this visit.
              </p>
              <ButtonLink href={next ?? "/directory"} variant="primary">
                <ArrowLeft />
                Back to directory
              </ButtonLink>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
