import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { adminLoginAction } from "@/actions/auth";
import { AuthShell } from "@/components/auth-shell";
import { PasswordLoginForm } from "@/components/password-login-form";
import { getViewer } from "@/lib/server/auth";
import { getOrgInfo } from "@/lib/server/settings";

export const metadata: Metadata = { title: "Administrator sign-in" };

export default async function AdminLoginPage() {
  const viewer = await getViewer();
  if (!viewer.siteAccess) redirect("/login?next=/admin/login");
  if (viewer.rulesPending) redirect("/welcome?next=/admin/login");
  if (viewer.admin) redirect("/admin");
  const org = await getOrgInfo();

  return (
    <AuthShell org={org} step={3}>
      <Link href="/directory" className="mb-6 inline-flex items-center gap-1.5 text-[13px] text-zinc-500 hover:text-zinc-900">
        <ArrowLeft className="size-4" />
        Back to directory
      </Link>
      <h1 className="season-display font-serif text-[26px] leading-tight font-medium tracking-[-0.01em] text-zinc-950">Administrator sign-in</h1>
      <p className="mt-1.5 text-[13.5px] leading-relaxed text-zinc-600">
        The administrator password is separate from the chapter password and from every member password.
      </p>
      <div className="mt-7">
        <PasswordLoginForm action={adminLoginAction} label="Administrator password" submitLabel="Sign in to dashboard" />
      </div>
    </AuthShell>
  );
}
