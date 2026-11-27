"use client";

import { KeyRound, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import {
  changeAdminPasswordAction,
  changeSitePasswordAction,
  updateOrganizationAction,
  updatePreferencesAction,
} from "@/actions/organization";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input, Select } from "@/components/ui/field";
import { PasswordInput } from "@/components/ui/inputs";
import { toast } from "@/components/ui/toast";
import type { ActionResult } from "@/lib/types";
import { ResetPasswordDialog } from "./member-dialogs";

function useSubmit(run: () => Promise<ActionResult<null>>, success: string, after?: () => void) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    const result = await run();
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    toast(success);
    after?.();
    router.refresh();
  };
  return { pending, error, submit };
}

function FormFooter({ pending, label, note }: { pending: boolean; label: string; note?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200 bg-zinc-50/60 px-4 py-3">
      <p className="text-[12px] text-zinc-500">{note}</p>
      <Button type="submit" variant="primary" size="sm" disabled={pending}>
        {pending && <LoaderCircle className="animate-spin" />}
        {label}
      </Button>
    </div>
  );
}

export function OrganizationForm({
  initial,
}: {
  initial: { organizationName: string; chapterName: string; adminDisplayName: string; defaultDocumentationPeriod: string };
}) {
  const [values, setValues] = useState(initial);
  const { pending, error, submit } = useSubmit(() => updateOrganizationAction(values), "Organization information saved");
  const set = (key: keyof typeof values) => (event: { target: { value: string } }) => setValues({ ...values, [key]: event.target.value });
  return (
    <form onSubmit={submit} noValidate>
      <div className="grid gap-4 px-4 py-4 sm:grid-cols-2">
        <Field label="Organization" htmlFor="org-name" hint='Shown on the Volunteer Hours Record ("Organization:").'>
          <Input id="org-name" value={values.organizationName} onChange={set("organizationName")} maxLength={120} />
        </Field>
        <Field label="Chapter" htmlFor="org-chapter" hint='Shown on both documents ("Chapter:").'>
          <Input id="org-chapter" value={values.chapterName} onChange={set("chapterName")} maxLength={160} />
        </Field>
        <Field label="Administrator display name" htmlFor="org-admin" hint="Identifies administrator actions in history and notifications.">
          <Input id="org-admin" value={values.adminDisplayName} onChange={set("adminDisplayName")} maxLength={120} />
        </Field>
        <Field label="Default documentation period" htmlFor="org-period" optional hint="Pre-filled on documentation issued to new members.">
          <Input
            id="org-period"
            value={values.defaultDocumentationPeriod}
            onChange={set("defaultDocumentationPeriod")}
            placeholder="e.g., 2026–2027 School Year"
            maxLength={160}
          />
        </Field>
        <div className="sm:col-span-2">
          <FormError message={error} />
        </div>
      </div>
      <FormFooter pending={pending} label="Save organization" note="Document wording from the official template is never changed." />
    </form>
  );
}

export function SitePasswordForm({ changedAt }: { changedAt: string }) {
  const [values, setValues] = useState({ newPassword: "", confirmPassword: "" });
  const { pending, error, submit } = useSubmit(
    () => changeSitePasswordAction(values),
    "Shared website password changed",
    () => setValues({ newPassword: "", confirmPassword: "" }),
  );
  return (
    <form onSubmit={submit} noValidate>
      <div className="grid gap-4 px-4 py-4 sm:grid-cols-2">
        <Field label="New shared password" htmlFor="site-new" hint="At least 8 characters.">
          <PasswordInput
            id="site-new"
            value={values.newPassword}
            onChange={(event) => setValues({ ...values, newPassword: event.target.value })}
            autoComplete="new-password"
          />
        </Field>
        <Field label="Confirm new shared password" htmlFor="site-confirm">
          <PasswordInput
            id="site-confirm"
            value={values.confirmPassword}
            onChange={(event) => setValues({ ...values, confirmPassword: event.target.value })}
            autoComplete="new-password"
          />
        </Field>
        <div className="sm:col-span-2">
          <FormError message={error} />
        </div>
      </div>
      <FormFooter
        pending={pending}
        label="Change shared password"
        note={`Last changed ${changedAt}. Directory sessions are signed out; member and administrator passwords are unaffected.`}
      />
    </form>
  );
}

export function AdminPasswordForm({ changedAt }: { changedAt: string }) {
  const [values, setValues] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const { pending, error, submit } = useSubmit(
    () => changeAdminPasswordAction(values),
    "Administrator password changed",
    () => setValues({ currentPassword: "", newPassword: "", confirmPassword: "" }),
  );
  return (
    <form onSubmit={submit} noValidate>
      <div className="grid gap-4 px-4 py-4 sm:grid-cols-3">
        <Field label="Current administrator password" htmlFor="admin-current">
          <PasswordInput
            id="admin-current"
            value={values.currentPassword}
            onChange={(event) => setValues({ ...values, currentPassword: event.target.value })}
            autoComplete="current-password"
          />
        </Field>
        <Field label="New administrator password" htmlFor="admin-new" hint="At least 10 characters.">
          <PasswordInput
            id="admin-new"
            value={values.newPassword}
            onChange={(event) => setValues({ ...values, newPassword: event.target.value })}
            autoComplete="new-password"
          />
        </Field>
        <Field label="Confirm new password" htmlFor="admin-confirm">
          <PasswordInput
            id="admin-confirm"
            value={values.confirmPassword}
            onChange={(event) => setValues({ ...values, confirmPassword: event.target.value })}
            autoComplete="new-password"
          />
        </Field>
        <div className="sm:col-span-3">
          <FormError message={error} />
        </div>
      </div>
      <FormFooter
        pending={pending}
        label="Change administrator password"
        note={`Last changed ${changedAt}. You stay signed in; other administrator sessions are signed out.`}
      />
    </form>
  );
}

export function MemberPasswordReset({ members }: { members: { id: string; fullName: string; departmentName: string; status: string }[] }) {
  const [selected, setSelected] = useState("");
  const [target, setTarget] = useState<{ id: string; fullName: string } | null>(null);
  return (
    <div className="flex flex-wrap items-end gap-3 px-4 py-4">
      <Field label="Member" htmlFor="reset-member" className="min-w-[260px] flex-1">
        <Select id="reset-member" value={selected} onChange={(event) => setSelected(event.target.value)}>
          <option value="">Select a member</option>
          {members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.fullName} — {member.departmentName}
              {member.status === "inactive" ? " (inactive)" : ""}
            </option>
          ))}
        </Select>
      </Field>
      <Button
        disabled={!selected}
        onClick={() => {
          const member = members.find((item) => item.id === selected);
          if (member) setTarget({ id: member.id, fullName: member.fullName });
        }}
      >
        <KeyRound />
        Reset password
      </Button>
      <ResetPasswordDialog key={`reset-${target?.id ?? "closed"}`} member={target} onClose={() => setTarget(null)} />
    </div>
  );
}

export function PreferencesForm({
  initial,
}: {
  initial: { siteSessionHours: number; memberIdleMinutes: number; adminIdleMinutes: number };
}) {
  const [values, setValues] = useState({
    siteSessionHours: String(initial.siteSessionHours),
    memberIdleMinutes: String(initial.memberIdleMinutes),
    adminIdleMinutes: String(initial.adminIdleMinutes),
  });
  const { pending, error, submit } = useSubmit(() => updatePreferencesAction(values), "Preferences saved");
  const set = (key: keyof typeof values) => (event: { target: { value: string } }) => setValues({ ...values, [key]: event.target.value });
  return (
    <form onSubmit={submit} noValidate>
      <div className="grid gap-4 px-4 py-4 sm:grid-cols-3">
        <Field label="Directory session length (hours)" htmlFor="pref-site" hint="How long the shared password stays valid on a device.">
          <Input id="pref-site" type="number" min={1} max={168} value={values.siteSessionHours} onChange={set("siteSessionHours")} />
        </Field>
        <Field label="Member idle timeout (minutes)" htmlFor="pref-member" hint="Members are signed out after this much inactivity.">
          <Input id="pref-member" type="number" min={5} max={720} value={values.memberIdleMinutes} onChange={set("memberIdleMinutes")} />
        </Field>
        <Field label="Administrator idle timeout (minutes)" htmlFor="pref-admin" hint="Applies to the administrator dashboard.">
          <Input id="pref-admin" type="number" min={5} max={720} value={values.adminIdleMinutes} onChange={set("adminIdleMinutes")} />
        </Field>
        <div className="sm:col-span-3">
          <FormError message={error} />
        </div>
      </div>
      <FormFooter pending={pending} label="Save preferences" note="Member and administrator sessions also end 12 hours after sign-in." />
    </form>
  );
}
