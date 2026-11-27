"use client";

import { DatabaseBackup } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { backUpNowAction } from "@/actions/backups";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";

export function BackUpNowButton({ disabled }: { disabled?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="primary"
      size="sm"
      disabled={disabled || busy}
      onClick={async () => {
        setBusy(true);
        try {
          const result = await backUpNowAction();
          if (!result.ok) {
            toast(result.error, { kind: "error" });
            return;
          }
          toast("Backup saved", { detail: "It is listed below and kept with the automatic backups." });
          router.refresh();
        } finally {
          setBusy(false);
        }
      }}
    >
      <DatabaseBackup />
      {busy ? "Backing up…" : "Back up now"}
    </Button>
  );
}
