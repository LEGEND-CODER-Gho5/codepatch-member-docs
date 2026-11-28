"use client";

import { KeyRound, LoaderCircle } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { changeMemberPasswordAction } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { PasswordInput } from "@/components/ui/inputs";
import { toast } from "@/components/ui/toast";
import { MEMBER_PASSWORD_MIN_LENGTH } from "@/lib/validation";

/**
 * "Change password" for a signed-in member: their current password, then the
 * new one twice. Only the password changes; their records are untouched.
 */
export function ChangePasswordButton({ memberId, memberName }: { memberId: string; memberName: string }) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formId = useId();
  const ids = { current: `${formId}-current`, next: `${formId}-next`, confirm: `${formId}-confirm`, hint: `${formId}-hint` };

  const close = () => {
    if (saving) return;
    setOpen(false);
    setCurrent("");
    setNext("");
    setConfirm("");
    setError(null);
  };

  const mismatch = confirm.length > 0 && next !== confirm;
  const ready = current.length > 0 && next.length >= MEMBER_PASSWORD_MIN_LENGTH && next === confirm;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!ready || saving) return;
    setSaving(true);
    setError(null);
    try {
      const result = await changeMemberPasswordAction({ memberId, currentPassword: current, newPassword: next, confirmPassword: confirm });
      setSaving(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast("Password changed. Use your new password next time you sign in.");
      close();
    } catch {
      setSaving(false);
      setError("Connection problem: your password was not changed. Try again.");
    }
  };

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <KeyRound />
        Change password
      </Button>
      <Dialog
        open={open}
        onClose={close}
        size="sm"
        dismissible={!saving}
        title="Change your password"
        description="Choose a password only you know. Your records stay exactly as they are."
        footer={
          <>
            <Button size="sm" variant="ghost" onClick={close} disabled={saving}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" type="submit" form={formId} disabled={!ready || saving}>
              {saving && <LoaderCircle className="animate-spin" />}
              Change password
            </Button>
          </>
        }
      >
        <form id={formId} onSubmit={submit} className="space-y-4">
          {/* Lets password managers save the new password for this account. */}
          <input type="text" name="username" autoComplete="username" value={memberName} readOnly hidden />
          <div>
            <label htmlFor={ids.current} className="mb-1.5 block text-[13px] font-medium text-zinc-800">
              Current password
            </label>
            <PasswordInput id={ids.current} value={current} onChange={(event) => setCurrent(event.target.value)} autoComplete="current-password" autoFocus required />
          </div>
          <div>
            <label htmlFor={ids.next} className="mb-1.5 block text-[13px] font-medium text-zinc-800">
              New password
            </label>
            <PasswordInput
              id={ids.next}
              value={next}
              onChange={(event) => setNext(event.target.value)}
              autoComplete="new-password"
              minLength={MEMBER_PASSWORD_MIN_LENGTH}
              maxLength={200}
              aria-describedby={ids.hint}
              required
            />
            <p id={ids.hint} className="mt-1.5 text-[12.5px] leading-snug text-zinc-500">
              At least {MEMBER_PASSWORD_MIN_LENGTH} characters. A short phrase is easy to remember and hard to guess. Don&rsquo;t use the shared chapter password.
            </p>
          </div>
          <div>
            <label htmlFor={ids.confirm} className="mb-1.5 block text-[13px] font-medium text-zinc-800">
              New password again
            </label>
            <PasswordInput
              id={ids.confirm}
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              autoComplete="new-password"
              invalid={mismatch}
              maxLength={200}
              required
            />
            {mismatch && <p className="mt-1.5 text-[12.5px] text-red-700">The two new passwords don&rsquo;t match yet.</p>}
          </div>
          {error && (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-[13px] text-red-800 ring-1 ring-red-200">
              {error}
            </p>
          )}
          <p className="text-[12.5px] leading-snug text-zinc-500">
            You&rsquo;ll stay signed in here; other devices will need the new password. If you ever forget it, the chapter administrator can reset it.
          </p>
        </form>
      </Dialog>
    </>
  );
}
