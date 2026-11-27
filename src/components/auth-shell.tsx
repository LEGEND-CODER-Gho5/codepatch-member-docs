import type { ReactNode } from "react";
import { Wordmark } from "@/components/brand";
import { cn } from "@/lib/cn";
import type { OrgInfo } from "@/lib/types";

const STEPS = [
  { number: "01", title: "Chapter access", body: "One shared password opens the member directory." },
  {
    number: "02",
    title: "Member documentation",
    body: "Each member signs in with a personal password and reaches only their own records.",
  },
  {
    number: "03",
    title: "Administration",
    body: "A separate administrator password manages members, documentation, and history.",
  },
];

export function AuthShell({ org, step, children }: { org: OrgInfo; step: 1 | 2 | 3; children: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(400px,40%)_1fr]">
      <aside className="theme-fixed hidden flex-col justify-between border-r border-black/40 bg-charcoal-950 px-12 py-10 lg:flex">
        <Wordmark organizationName={org.organizationName} subtitle={org.chapterName} tone="light" />
        <div className="max-w-[360px]">
          <p className="text-[13px] font-medium text-brand-300">Member Documentation System</p>
          <p className="mt-3 text-[22px] leading-snug font-medium text-white">
            Contributions and volunteer hours for {org.organizationName}, {org.chapterName}.
          </p>
          <ol className="mt-10 space-y-6 border-l border-white/10 pl-6">
            {STEPS.map((item, index) => {
              const active = index + 1 === step;
              return (
                <li key={item.number} className="relative">
                  <span
                    aria-hidden
                    className={cn(
                      "absolute top-1.5 -left-[27px] size-[7px] rounded-full ring-4 ring-charcoal-950",
                      active ? "bg-brand-300" : "bg-zinc-700",
                    )}
                  />
                  <p className={cn("flex items-baseline gap-2.5 text-[13.5px] font-medium", active ? "text-white" : "text-zinc-500")}>
                    <span className={cn("font-mono text-[11px]", active ? "text-brand-300" : "text-zinc-600")}>{item.number}</span>
                    {item.title}
                  </p>
                  <p className={cn("mt-1 text-[12.5px] leading-relaxed", active ? "text-zinc-400" : "text-zinc-600")}>{item.body}</p>
                </li>
              );
            })}
          </ol>
        </div>
        <p className="text-[12px] text-zinc-600">Restricted to authorized members of {org.organizationName}.</p>
      </aside>
      <main className="flex flex-col bg-zinc-50">
        <div className="border-b border-zinc-200 bg-surface px-5 py-3 lg:hidden">
          <Wordmark organizationName={org.organizationName} subtitle={org.chapterName} />
        </div>
        <div className="flex flex-1 items-center justify-center px-5 py-12">
          <div className="w-full max-w-[380px]">{children}</div>
        </div>
      </main>
    </div>
  );
}

export function SetupRequired() {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-5 text-[13.5px] text-amber-900">
      <p className="font-semibold">Initial setup required</p>
      <p className="mt-2 leading-relaxed">
        The shared website password and administrator password have not been configured. Set{" "}
        <code className="font-mono text-[12.5px]">INITIAL_SITE_PASSWORD</code> and{" "}
        <code className="font-mono text-[12.5px]">INITIAL_ADMIN_PASSWORD</code> in <code className="font-mono text-[12.5px]">.env.local</code>{" "}
        (or run <code className="font-mono text-[12.5px]">npm run setup</code>), then restart the server.
      </p>
    </div>
  );
}
