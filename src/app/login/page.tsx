import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { siteLoginAction } from "@/actions/auth";
import { AuthShell, SetupRequired } from "@/components/auth-shell";
import { PasswordLoginForm } from "@/components/password-login-form";
import { getViewer } from "@/lib/server/auth";
import { getOrgInfo } from "@/lib/server/settings";

export const metadata: Metadata = { title: "Chapter access" };

function safePath(value: unknown): string | null {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") && value.length < 200 ? value : null;
}

export default async function SiteLoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const next = safePath(params.next);
  const viewer = await getViewer();
  if (viewer.siteAccess) redirect(next ?? "/directory");
  const org = await getOrgInfo();

  return (
    <AuthShell org={org} step={1}>
      {viewer.configured ? (
        <>
          <h1 className="season-display font-serif text-[26px] leading-tight font-medium tracking-[-0.01em] text-zinc-950">Chapter access</h1>
          <p className="mt-1.5 text-[13.5px] leading-relaxed text-zinc-600">
            Enter the shared chapter password to open the member directory.
          </p>
          <div className="mt-7">
            <PasswordLoginForm
              action={siteLoginAction}
              label="Chapter password"
              submitLabel="Continue to directory"
              hidden={next ? { next } : undefined}
              footer="Don't have the chapter password? Ask the chapter administrator."
            />
          </div>
        </>
      ) : (
        <SetupRequired />
      )}
    </AuthShell>
  );
}
