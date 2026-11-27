"use client";

import { RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { restoreAuditVersionAction } from "@/actions/history";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";

export function RestoreButton({ auditId, deleted }: { auditId: number; deleted: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <RotateCcw />
        {deleted ? "Restore deleted record" : "Restore previous version"}
      </Button>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        tone="primary"
        title={deleted ? "Restore this deleted record?" : "Restore the previous version?"}
        description={
          deleted
            ? "The record is re-created from the copy stored in this history entry. The restore is itself recorded as an administrator action."
            : "The current values are replaced with the previous version shown here. The current values remain available in history, and the restore is recorded as an administrator action."
        }
        confirmLabel="Restore"
        onConfirm={async () => {
          const result = await restoreAuditVersionAction(auditId);
          if (!result.ok) return result.error;
          setOpen(false);
          toast("Version restored");
          router.push(result.data.link);
        }}
      />
    </>
  );
}
