"use client";

import { FileText, LoaderCircle, Plus, Trash } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { createDocumentAction, deleteDocumentAction } from "@/actions/documents";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { GestureRow } from "@/components/ui/gestures";
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

type DeleteTarget = {
  documentId: string;
  documentType: DocumentType;
  actingAs: ActingAs;
  basePath: string;
  periodLabel: string;
};

/** "Delete this record?" — the one confirmation used by the button, the swipe action, and the long-press menu. */
function DeleteRecordDialog({
  open,
  onClose,
  target,
  viewing,
}: {
  open: boolean;
  onClose: () => void;
  target: DeleteTarget;
  /** The record is the one on screen, so the page moves to another record afterwards. */
  viewing: boolean;
}) {
  const router = useRouter();
  const label = DOCUMENT_TYPE_LABEL[target.documentType];
  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      title={`Delete this ${label} record?`}
      description={
        <>
          This removes the{" "}
          {target.periodLabel ? <strong className="font-medium text-zinc-900">{target.periodLabel}</strong> : "selected"} record and
          every entry in it. A full copy is preserved in the edit history, where the administrator can restore it.
        </>
      }
      confirmLabel="Delete record"
      onConfirm={async () => {
        const result = await deleteDocumentAction({ documentId: target.documentId, actingAs: target.actingAs });
        if (!result.ok) return result.error;
        onClose();
        toast(`${label} record deleted`);
        if (viewing) router.push(`${target.basePath}?type=${target.documentType}`);
        router.refresh();
      }}
    />
  );
}

export function DeleteRecordButton(target: DeleteTarget) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="danger-outline" className="w-full" onClick={() => setOpen(true)}>
        <Trash />
        Delete this record
      </Button>
      <DeleteRecordDialog open={open} onClose={() => setOpen(false)} target={target} viewing />
    </>
  );
}

/**
 * One record in the records list. On a phone, swipe it left for Delete; long
 * press (or right-click on a computer) for Open and Delete. Deleting always
 * asks first.
 */
export function RecordListItem({
  href,
  active,
  target,
  children,
}: {
  href: string;
  active: boolean;
  target: DeleteTarget;
  children: ReactNode;
}) {
  const [confirming, setConfirming] = useState(false);
  const ask = () => setConfirming(true);
  return (
    <li>
      <GestureRow
        menuLabel="Record actions"
        swipeActions={[{ label: "Delete", icon: <Trash />, tone: "danger", onSelect: ask }]}
        menuItems={[
          { label: "Open", icon: <FileText />, href },
          "separator",
          { label: "Delete record…", icon: <Trash />, tone: "danger", onSelect: ask },
        ]}
      >
        {children}
      </GestureRow>
      <DeleteRecordDialog open={confirming} onClose={() => setConfirming(false)} target={target} viewing={active} />
    </li>
  );
}
