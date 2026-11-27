"use client";

import { Check, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";

function AcceptButton({ agreed }: { agreed: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" disabled={!agreed || pending}>
      {pending ? <LoaderCircle className="animate-spin" /> : <Check />}
      Accept and continue
    </Button>
  );
}

/** The checkbox is also `required`, so the form cannot be sent without it even before scripts load. */
export function AcceptRulesForm({ action, version, next }: { action: (formData: FormData) => Promise<void>; version: number; next: string | null }) {
  const [agreed, setAgreed] = useState(false);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="version" value={version} />
      {next && <input type="hidden" name="next" value={next} />}
      <label className="flex items-start gap-3 text-[14px] leading-snug text-zinc-800">
        <input
          type="checkbox"
          name="agree"
          value="yes"
          required
          checked={agreed}
          onChange={(event) => setAgreed(event.target.checked)}
          className="mt-0.5 size-[18px] shrink-0 rounded border-zinc-300 accent-brand-700"
        />
        I have read the guide and agree to follow the chapter&apos;s policies and procedures.
      </label>
      <AcceptButton agreed={agreed} />
    </form>
  );
}
