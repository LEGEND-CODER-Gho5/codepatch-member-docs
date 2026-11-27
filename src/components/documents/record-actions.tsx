"use client";

import { LoaderCircle, Plus, Trash } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createDocumentAction, deleteDocumentAction } from "@/actions/documents";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { DOCUMENT_TYPE_LABEL } from "@/lib/document-text";
import type { ActingAs, DocumentType } from "@/lib/types";

export function NewRecordButton({
  memberId,
  documentType,
  actingAs,
  basePath,
  variant = "secondary",
  label,
}: {
  memberId: string;
  documentType: DocumentType;
  actingAs: ActingAs;
  basePath: string;
  variant?: "secondary" | "primary";
  label?: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function create() {
    setPending(true);
    const result = await createDocumentAction({ memberId, documentType, actingAs });
    setPending(false);
    if (!result.ok) {
      toast("Could not create the record", { kind: "error", detail: result.error });
      return;
    }
    toast(`New ${DOCUMENT_TYPE_LABEL[documentType]} record created`);
    router.push(`${basePath}?type=${documentType}&doc=${result.data.id}`);
    router.refresh();
  }

  return (
    <Button size="sm" variant={variant} onClick={create} disabled={pending}>
      {pending ? <LoaderCircle className="animate-spin" /> : <Plus />}
      {label ?? "New record"}
    </Button>
  );
}

export function DeleteRecordButton({
  documentId,
  documentType,
  actingAs,
  basePath,
  periodLabel,
}: {
  documentId: string;
  documentType: DocumentType;
  actingAs: ActingAs;
  basePath: string;
  periodLabel: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const label = DOCUMENT_TYPE_LABEL[documentType];

  return (
    <>
      <Button size="sm" variant="danger-outline" className="w-full" onClick={() => setOpen(true)}>
        <Trash />
        Delete this record
      </Button>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        title={`Delete this ${label} record?`}
        description={
          <>
            This removes the {periodLabel ? <strong className="font-medium text-zinc-900">{periodLabel}</strong> : "selected"} record and
            every entry in it. A full copy is preserved in the edit history, where the administrator can restore it.
          </>
        }
        confirmLabel="Delete record"
        onConfirm={async () => {
          const result = await deleteDocumentAction({ documentId, actingAs });
          if (!result.ok) return result.error;
          setOpen(false);
          toast(`${label} record deleted`);
          router.push(`${basePath}?type=${documentType}`);
          router.refresh();
        }}
      />
    </>
  );
}
