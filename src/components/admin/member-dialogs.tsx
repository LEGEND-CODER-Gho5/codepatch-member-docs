"use client";

import { CircleCheck, FileText, KeyRound, LoaderCircle, TriangleExclamationPoint, UserPlus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import {
  createMemberAction,
  resetMemberPasswordAction,
  updateMemberAction,
  type IssuedCredential,
  type MemberFormInput,
} from "@/actions/members";
import { Button, buttonStyles } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, FormError, Input, Select } from "@/components/ui/field";
import { CopyButton } from "@/components/ui/inputs";
import { toast } from "@/components/ui/toast";
import { todayInAppTimeZone } from "@/lib/format";
import type { DepartmentOption, MemberStatus, PositionOption } from "@/lib/types";

/* --------------------------------- Shared form -------------------------------- */

function MemberFormFields({
  value,
  onChange,
  departments,
  positions,
}: {
  value: MemberFormInput;
  onChange: (next: MemberFormInput) => void;
  departments: DepartmentOption[];
  positions: PositionOption[];
}) {
  const set = (key: Exclude<keyof MemberFormInput, "otherDepartmentIds">) => (event: { target: { value: string } }) =>
    onChange({ ...value, [key]: event.target.value });
  // The main department is never also one of the other departments.
  const setMainDepartment = (event: { target: { value: string } }) =>
    onChange({
      ...value,
      departmentId: event.target.value,
      otherDepartmentIds: value.otherDepartmentIds.filter((id) => id !== event.target.value),
    });
  const toggleOther = (id: string, checked: boolean) =>
    onChange({
      ...value,
      otherDepartmentIds: checked ? [...value.otherDepartmentIds, id] : value.otherDepartmentIds.filter((other) => other !== id),
    });
  const otherChoices = departments.filter((department) => department.id !== value.departmentId);
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Full Name" htmlFor="member-name" className="sm:col-span-2">
        <Input id="member-name" value={value.fullName} onChange={set("fullName")} autoComplete="off" required maxLength={120} autoFocus />
      </Field>
      <Field label="Main Department" htmlFor="member-department">
        <Select id="member-department" value={value.departmentId} onChange={setMainDepartment} required>
          <option value="" disabled>
            Select department
          </option>
          {departments.map((department) => (
            <option key={department.id} value={department.id}>
              {department.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Position/Role" htmlFor="member-position">
        <Select id="member-position" value={value.positionId} onChange={set("positionId")} required>
          <option value="" disabled>
            Select position
          </option>
          {positions.map((position) => (
            <option key={position.id} value={position.id}>
              {position.name}
            </option>
          ))}
        </Select>
      </Field>
      {otherChoices.length > 0 && (
        <fieldset className="space-y-1.5 sm:col-span-2">
          <legend className="text-[13px] font-medium text-zinc-800">
            Other Departments
            <span className="ml-1 font-normal text-zinc-400">(optional)</span>
          </legend>
          <p className="text-[12px] text-zinc-500">
            The member also appears in these directory columns. Volunteer-hour totals count only the main department.
          </p>
          <div className="grid gap-x-4 gap-y-1.5 pt-1 sm:grid-cols-2">
            {otherChoices.map((department) => (
              <label key={department.id} className="flex items-center gap-2 text-[13px] text-zinc-700">
                <input
                  type="checkbox"
                  checked={value.otherDepartmentIds.includes(department.id)}
                  onChange={(event) => toggleOther(department.id, event.target.checked)}
                  className="size-4 rounded border-zinc-300 accent-brand-700"
                />
                {department.name}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <Field label="Member Status" htmlFor="member-status">
        <Select id="member-status" value={value.status} onChange={set("status")}>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </Select>
      </Field>
      <Field label="Start Date" htmlFor="member-start">
        <Input id="member-start" type="date" value={value.startDate} onChange={set("startDate")} />
      </Field>
      <Field label="Email Address" htmlFor="member-email" optional className="sm:col-span-2">
        <Input id="member-email" type="email" value={value.email} onChange={set("email")} autoComplete="off" maxLength={200} />
      </Field>
    </div>
  );
}

/* ------------------------------ Issued credential ------------------------------ */

function CredentialCard({
  credential,
  acknowledged,
  onAcknowledge,
  heading,
}: {
  credential: IssuedCredential;
  acknowledged: boolean;
  onAcknowledge: (value: boolean) => void;
  heading: string;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2.5 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2.5">
        <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" />
        <div className="text-[13px] text-emerald-900">
          <p className="font-medium">{heading}</p>
          <p className="mt-0.5 text-emerald-800">The account can be used immediately with the password below.</p>
        </div>
      </div>
      <dl className="divide-y divide-zinc-100 rounded-md border border-zinc-200 text-[13px]">
        {[
          ["Member", credential.fullName],
          ["Member ID", credential.memberCode],
          ["Department", credential.departmentName],
          ["Position/Role", credential.positionName],
          ["Status", credential.status === "active" ? "Active" : "Inactive"],
        ].map(([label, text]) => (
          <div key={label} className="grid grid-cols-[120px_1fr] gap-3 px-3 py-2">
            <dt className="text-zinc-500">{label}</dt>
            <dd className={label === "Member ID" ? "font-mono text-zinc-900" : "font-medium text-zinc-900"}>{text}</dd>
          </div>
        ))}
      </dl>
      <div>
        <p className="mb-1.5 text-[12.5px] font-medium text-zinc-700">Generated password</p>
        <div className="flex items-center gap-2 rounded-md border border-brand-200 bg-brand-50/60 p-2 pl-3">
          <code className="flex-1 font-mono text-[17px] font-medium tracking-[0.06em] text-brand-950 select-all">{credential.password}</code>
          <CopyButton value={credential.password} label="Copy password" onCopied={() => onAcknowledge(true)} />
        </div>
      </div>
      <div className="flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2.5 text-[12.5px] text-amber-900 ring-1 ring-amber-200 ring-inset">
        <TriangleExclamationPoint className="mt-px size-4 shrink-0 text-amber-600" />
        <p>
          This password is shown only once. It is stored only as a secure hash and cannot be displayed again. If it is lost, reset it
          from Member Management. Share it with the member privately.
        </p>
      </div>
      <label className="flex items-center gap-2 text-[13px] text-zinc-700">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(event) => onAcknowledge(event.target.checked)}
          className="size-4 rounded border-zinc-300 accent-brand-700"
        />
        I have copied or recorded this password
      </label>
    </div>
  );
}

/* ---------------------------------- Add member --------------------------------- */

function blankForm(departments: DepartmentOption[], positions: PositionOption[]): MemberFormInput {
  const defaultPosition = positions.find((position) => position.name.toLowerCase() === "member") ?? positions[0];
  return {
    fullName: "",
    departmentId: departments[0]?.id ?? "",
    otherDepartmentIds: [],
    positionId: defaultPosition?.id ?? "",
    status: "active",
    email: "",
    startDate: todayInAppTimeZone(),
  };
}

export function AddMemberDialog({
  open,
  onClose,
  departments,
  positions,
}: {
  open: boolean;
  onClose: () => void;
  departments: DepartmentOption[];
  positions: PositionOption[];
}) {
  const router = useRouter();
  const [form, setForm] = useState<MemberFormInput>(() => blankForm(departments, positions));
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [issued, setIssued] = useState<IssuedCredential | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  // The shell remounts this component (new key) every time it opens, so the
  // initial state above is always a blank form.

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const result = await createMemberAction(form);
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setIssued(result.data);
    router.refresh();
  }

  // Each step gets its own key so React never morphs the "Add another" button
  // into the form's submit button in the middle of a click.
  if (issued) {
    return (
      <Dialog
        key="issued"
        open={open}
        onClose={onClose}
        dismissible={false}
        title="Member account created"
        description="Both documentation formats were created and the member now appears in the directory."
        footer={
          <>
            <Link
              href={`/admin/documentation/${issued.id}`}
              onClick={onClose}
              className={buttonStyles({ variant: "ghost", size: "md", className: "mr-auto" })}
              aria-disabled={!acknowledged}
              tabIndex={acknowledged ? undefined : -1}
              style={acknowledged ? undefined : { pointerEvents: "none", opacity: 0.5 }}
            >
              <FileText />
              Open documentation
            </Link>
            <Button
              disabled={!acknowledged}
              onClick={() => {
                setIssued(null);
                setAcknowledged(false);
                setError(null);
                setForm(blankForm(departments, positions));
              }}
            >
              Add another
            </Button>
            <Button variant="primary" disabled={!acknowledged} onClick={onClose}>
              Done
            </Button>
          </>
        }
      >
        <CredentialCard credential={issued} acknowledged={acknowledged} onAcknowledge={setAcknowledged} heading="Account created" />
      </Dialog>
    );
  }

  const ready = departments.length > 0 && positions.length > 0;
  return (
    <Dialog
      key="form"
      open={open}
      onClose={() => !pending && onClose()}
      title="Add member"
      description="A unique member ID, a secure password, and both documentation formats are generated automatically."
      footer={
        <>
          <Button onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="add-member-form" disabled={pending || !ready}>
            {pending ? <LoaderCircle className="animate-spin" /> : <UserPlus />}
            Create member
          </Button>
        </>
      }
    >
      <form id="add-member-form" onSubmit={submit} className="space-y-4" noValidate>
        {!ready && (
          <FormError message="Create at least one department and one position (Departments and Settings pages) before adding members." />
        )}
        <MemberFormFields value={form} onChange={setForm} departments={departments} positions={positions} />
        <FormError message={error} />
      </form>
    </Dialog>
  );
}

/* --------------------------------- Edit member --------------------------------- */

export type EditableMember = {
  id: string;
  fullName: string;
  departmentId: string;
  otherDepartmentIds: string[];
  positionId: string;
  status: MemberStatus;
  email: string | null;
  startDate: string | null;
};

export function EditMemberDialog({
  member,
  onClose,
  departments,
  positions,
}: {
  member: EditableMember | null;
  onClose: () => void;
  departments: DepartmentOption[];
  positions: PositionOption[];
}) {
  const router = useRouter();
  // Callers key this component by member id, so the form initializes per member.
  const [form, setForm] = useState<MemberFormInput | null>(() =>
    member
      ? {
          fullName: member.fullName,
          departmentId: member.departmentId,
          otherDepartmentIds: member.otherDepartmentIds,
          positionId: member.positionId,
          status: member.status,
          email: member.email ?? "",
          startDate: member.startDate ?? "",
        }
      : null,
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!member || !form) return;
    setPending(true);
    setError(null);
    const result = await updateMemberAction(member.id, form);
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    toast("Member updated", { detail: `${form.fullName}'s profile and documentation headers were updated.` });
    router.refresh();
    onClose();
  }

  return (
    <Dialog
      open={member !== null}
      onClose={() => !pending && onClose()}
      title="Edit member"
      description="Changes apply immediately to the directory and to both documentation formats."
      footer={
        <>
          <Button onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="edit-member-form" disabled={pending}>
            {pending && <LoaderCircle className="animate-spin" />}
            Save changes
          </Button>
        </>
      }
    >
      {form && (
        <form id="edit-member-form" onSubmit={submit} className="space-y-4" noValidate>
          <MemberFormFields value={form} onChange={setForm} departments={departments} positions={positions} />
          {form.status === "inactive" && member?.status === "active" && (
            <p className="text-[12.5px] text-amber-800">
              Inactive members are removed from the directory and counts and cannot sign in. Their records and history are kept.
            </p>
          )}
          <FormError message={error} />
        </form>
      )}
    </Dialog>
  );
}

/* -------------------------------- Reset password ------------------------------- */

export function ResetPasswordDialog({ member, onClose }: { member: { id: string; fullName: string } | null; onClose: () => void }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<IssuedCredential | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  // Callers key this component by member id, so state starts fresh per member.

  async function reset() {
    if (!member) return;
    setPending(true);
    setError(null);
    const result = await resetMemberPasswordAction(member.id);
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setIssued(result.data);
    router.refresh();
  }

  if (issued) {
    return (
      <Dialog
        key="issued"
        open={member !== null}
        onClose={onClose}
        dismissible={false}
        title="New password issued"
        description={`${issued.fullName}'s previous password no longer works and any open sessions were signed out.`}
        footer={
          <Button variant="primary" disabled={!acknowledged} onClick={onClose}>
            Done
          </Button>
        }
      >
        <CredentialCard credential={issued} acknowledged={acknowledged} onAcknowledge={setAcknowledged} heading="Password reset" />
      </Dialog>
    );
  }

  return (
    <Dialog
      key="confirm"
      open={member !== null}
      onClose={() => !pending && onClose()}
      title="Reset password"
      size="sm"
      footer={
        <>
          <Button onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" onClick={reset} disabled={pending}>
            {pending ? <LoaderCircle className="animate-spin" /> : <KeyRound />}
            Generate new password
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-[13.5px] text-zinc-700">
        <p>
          Generate a new documentation password for <strong className="font-medium text-zinc-900">{member?.fullName}</strong>? Their
          current password stops working immediately. No other member, the shared website password, or the administrator password is
          affected.
        </p>
        <FormError message={error} />
      </div>
    </Dialog>
  );
}
