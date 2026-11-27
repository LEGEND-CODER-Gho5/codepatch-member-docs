"use client";

import { CircleExclamationPoint, LoaderCircle } from "lucide-react";
import { useActionState, type ReactNode } from "react";
import type { LoginState } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/field";
import { PasswordInput } from "@/components/ui/inputs";

export function PasswordLoginForm({
  action,
  label,
  submitLabel,
  hidden,
  footer,
}: {
  action: (state: LoginState, formData: FormData) => Promise<LoginState>;
  label: string;
  submitLabel: string;
  hidden?: Record<string, string>;
  footer?: ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, { error: null });

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {hidden && Object.entries(hidden).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
      <div className="space-y-1.5">
        <Label htmlFor="password">{label}</Label>
        <PasswordInput
          id="password"
          name="password"
          autoFocus
          autoComplete="current-password"
          invalid={Boolean(state.error)}
          aria-describedby={state.error ? "password-error" : undefined}
        />
      </div>
      {state.error && (
        <p id="password-error" role="alert" className="flex items-start gap-1.5 text-[13px] text-red-700">
          <CircleExclamationPoint className="mt-0.5 size-4 shrink-0" />
          {state.error}
        </p>
      )}
      <Button type="submit" variant="primary" className="h-10 w-full" disabled={pending}>
        {pending && <LoaderCircle className="animate-spin" />}
        {submitLabel}
      </Button>
      {footer && <div className="pt-1 text-[12.5px] text-zinc-500">{footer}</div>}
    </form>
  );
}
