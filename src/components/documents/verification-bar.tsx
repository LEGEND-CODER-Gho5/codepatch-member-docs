"use client";

import { BadgeCheck, CircleDashed, LoaderCircle, Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { unverifyDocumentAction, verifyDocumentAction } from "@/actions/documents";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/format";
import type { ActingAs, Verification } from "@/lib/types";

/**
 * The record's sign-off status, above the form. The administrator verifies a
 * record after checking it (or removes the verification); a member sees the
 * status and what changing a verified record does.
 */
export function VerificationBar({
  documentId,
  verification,
  actingAs,
  label,
}: {
  documentId: string;
  verification: Verification;
  actingAs: ActingAs;
  label: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const admin = actingAs === "admin";

  async function change(verify: boolean) {
    setBusy(true);
    try {
      const result = verify ? await verifyDocumentAction({ documentId }) : await unverifyDocumentAction({ documentId });
      if (!result.ok) {
        toast(verify ? "The record could not be verified" : "The verification could not be removed", { kind: "error", detail: result.error });
        return;
      }
      toast(verify ? `${label} verified` : "Verification removed", {
        detail: verify ? "If the member changes it, you'll get a notification to verify it again." : undefined,
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-label="Verification"
      className={cn(
        "mb-4 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-md border px-3 py-2.5 print:hidden",
        verification ? "border-emerald-200 bg-emerald-50" : "border-zinc-200 bg-surface",
      )}
    >
      <div className="flex min-w-0 flex-1 items-start gap-2.5">
        {verification ? (
          <BadgeCheck className="mt-0.5 size-[18px] shrink-0 text-emerald-600" aria-hidden />
        ) : (
          <CircleDashed className="mt-0.5 size-[18px] shrink-0 text-zinc-400" aria-hidden />
        )}
        <div className="min-w-0 text-[12.5px]">
          <p className={cn("text-[13.5px] font-semibold", verification ? "text-emerald-900" : "text-zinc-900")}>
            {verification ? `Verified by ${verification.byName}` : "Not verified yet"}
            {verification && <span className="font-normal text-emerald-800"> · {formatDateTime(verification.at)}</span>}
          </p>
          <p className={cn("mt-0.5", verification ? "text-emerald-800" : "text-zinc-500")}>
            {verification
              ? admin
                ? "If the member changes anything, the verification is removed and you get a notification to check it again."
                : "The administrator checked this record. If you change anything, it goes back to “not verified” until it is checked again, and a verified record can't be deleted."
              : admin
                ? "Check the hours and details, then verify the record. Only you can fill in the supervisor signature and its date."
                : "The administrator verifies records after checking them. The supervisor signature and its date are filled in by the administrator."}
          </p>
        </div>
      </div>
      {admin &&
        (verification ? (
          <Button size="sm" onClick={() => void change(false)} disabled={busy}>
            {busy ? <LoaderCircle className="animate-spin" /> : <Undo2 />}
            Remove verification
          </Button>
        ) : (
          <Button size="sm" variant="primary" onClick={() => void change(true)} disabled={busy}>
            {busy ? <LoaderCircle className="animate-spin" /> : <BadgeCheck />}
            Verify this record
          </Button>
        ))}
    </section>
  );
}
