"use client";

import { FileText, KeyRound, Pencil, Trash, UserCheck, UserX } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { deleteMemberAction, setMemberStatusAction } from "@/actions/members";
import { Button, ButtonLink } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import type { MemberStatus } from "@/lib/types";
import { useAdminUI } from "./admin-shell";
import { EditMemberDialog, ResetPasswordDialog, type EditableMember } from "./member-dialogs";

type Target = { id: string; fullName: string };

export function useMemberActions({ onDeleted }: { onDeleted?: () => void } = {}) {
  const { departments, positions } = useAdminUI();
  const router = useRouter();
  const [editing, setEditing] = useState<EditableMember | null>(null);
  const [resetting, setResetting] = useState<Target | null>(null);
  const [statusTarget, setStatusTarget] = useState<(Target & { status: MemberStatus }) | null>(null);
  const [deleting, setDeleting] = useState<Target | null>(null);

  const deactivating = statusTarget?.status === "active";

  const dialogs = (
    <>
      <EditMemberDialog
        key={`edit-${editing?.id ?? "closed"}`}
        member={editing}
        onClose={() => setEditing(null)}
        departments={departments}
        positions={positions}
      />
      <ResetPasswordDialog key={`reset-${resetting?.id ?? "closed"}`} member={resetting} onClose={() => setResetting(null)} />
      <ConfirmDialog
        open={statusTarget !== null}
        onClose={() => setStatusTarget(null)}
        tone={deactivating ? "danger" : "primary"}
        title={deactivating ? `Deactivate ${statusTarget?.fullName}?` : `Reactivate ${statusTarget?.fullName}?`}
        description={
          deactivating
            ? "The member is removed from the directory and member counts, and can no longer sign in. Their documentation and history are kept and can be reactivated at any time."
            : "The member returns to the directory and can sign in again with their existing password."
        }
        confirmLabel={deactivating ? "Deactivate member" : "Reactivate member"}
        onConfirm={async () => {
          if (!statusTarget) return;
          const next: MemberStatus = statusTarget.status === "active" ? "inactive" : "active";
          const result = await setMemberStatusAction(statusTarget.id, next);
          if (!result.ok) return result.error;
          toast(next === "inactive" ? "Member deactivated" : "Member reactivated", { detail: statusTarget.fullName });
          setStatusTarget(null);
          router.refresh();
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={`Permanently delete ${deleting?.fullName}?`}
        description={
          <>
            This deletes the member account, both documentation formats, and every entry. It cannot be undone from this screen.{" "}
            <strong className="font-medium text-zinc-900">The edit history is preserved</strong>, including a full copy of the deleted
            records. To keep the account but hide it, deactivate it instead.
          </>
        }
        confirmLabel="Delete permanently"
        requireText={deleting?.fullName}
        onConfirm={async (typed) => {
          if (!deleting) return;
          const result = await deleteMemberAction(deleting.id, typed);
          if (!result.ok) return result.error;
          toast("Member deleted", { detail: deleting.fullName });
          setDeleting(null);
          if (onDeleted) onDeleted();
          else router.refresh();
        }}
      />
    </>
  );

  return {
    edit: setEditing,
    resetPassword: setResetting,
    toggleStatus: setStatusTarget,
    remove: setDeleting,
    dialogs,
  };
}

export function MemberProfileActions({ member }: { member: EditableMember & { status: MemberStatus } }) {
  const router = useRouter();
  const actions = useMemberActions({
    onDeleted: () => {
      router.push("/admin/members");
      router.refresh();
    },
  });
  const target = { id: member.id, fullName: member.fullName };
  return (
    <>
      <ButtonLink href={`/admin/documentation/${member.id}`} variant="secondary">
        <FileText />
        Open documentation
      </ButtonLink>
      <Button onClick={() => actions.edit(member)}>
        <Pencil />
        Edit
      </Button>
      <Button onClick={() => actions.resetPassword(target)}>
        <KeyRound />
        Reset password
      </Button>
      <Button onClick={() => actions.toggleStatus({ ...target, status: member.status })}>
        {member.status === "active" ? <UserX /> : <UserCheck />}
        {member.status === "active" ? "Deactivate" : "Reactivate"}
      </Button>
      <Button variant="danger-outline" onClick={() => actions.remove(target)}>
        <Trash />
        Delete
      </Button>
      {actions.dialogs}
    </>
  );
}
