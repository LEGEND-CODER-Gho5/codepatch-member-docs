"use client";

import { LoaderCircle, Pencil, Plus, Trash } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { deleteDepartmentAction, deletePositionAction, saveDepartmentAction, savePositionAction } from "@/actions/organization";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Field, FormError, Input } from "@/components/ui/field";
import { tableStyles } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { formatHours } from "@/lib/format";

/* --------------------------------- Departments --------------------------------- */

export type DepartmentItem = {
  id: string;
  name: string;
  description: string;
  sortOrder: number;
  activeMembers: number;
  totalMembers: number;
  hoursTotal: number;
};

type DepartmentDraft = { id: string | null; name: string; description: string; sortOrder: string };

export function DepartmentsManager({ departments }: { departments: DepartmentItem[] }) {
  const router = useRouter();
  const [draft, setDraft] = useState<DepartmentDraft | null>(null);
  const [deleting, setDeleting] = useState<DepartmentItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const openNew = () => {
    setError(null);
    const nextOrder = departments.reduce((max, item) => Math.max(max, item.sortOrder), 0) + 1;
    setDraft({ id: null, name: "", description: "", sortOrder: String(nextOrder) });
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    setPending(true);
    setError(null);
    const result = await saveDepartmentAction({ id: draft.id, name: draft.name, description: draft.description, sortOrder: draft.sortOrder });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    toast(draft.id ? "Department updated" : "Department created", { detail: draft.name });
    setDraft(null);
    router.refresh();
  }

  return (
    <div className="rounded-lg border border-zinc-200 bg-surface shadow-panel">
      <div className="flex items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3">
        <p className="text-[13px] text-zinc-500">
          {departments.length} department{departments.length === 1 ? "" : "s"} · shown as columns in the member directory, in display order
        </p>
        <Button variant="primary" size="sm" onClick={openNew}>
          <Plus />
          Add department
        </Button>
      </div>
      <div className={tableStyles.wrapper}>
        <table className={tableStyles.table}>
          <thead>
            <tr>
              <th className={cn(tableStyles.th, "w-16")}>Order</th>
              <th className={tableStyles.th}>Department</th>
              <th className={cn(tableStyles.th, "text-right")}>Active</th>
              <th className={cn(tableStyles.th, "text-right")}>All members</th>
              <th className={cn(tableStyles.th, "text-right")}>Hours</th>
              <th className={cn(tableStyles.th, "w-24")}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {departments.map((department) => (
              <tr key={department.id} className={tableStyles.row}>
                <td className={cn(tableStyles.td, "tabular text-zinc-500")}>{department.sortOrder}</td>
                <td className={tableStyles.td}>
                  <p className="font-medium text-zinc-900">{department.name}</p>
                  {department.description && <p className="text-[12px] text-zinc-500">{department.description}</p>}
                </td>
                <td className={cn(tableStyles.td, "tabular text-right")}>{department.activeMembers}</td>
                <td className={cn(tableStyles.td, "tabular text-right text-zinc-500")}>{department.totalMembers}</td>
                <td className={cn(tableStyles.td, "tabular text-right")}>{formatHours(department.hoursTotal)}</td>
                <td className={cn(tableStyles.td, "py-1 text-right whitespace-nowrap")}>
                  <button
                    type="button"
                    onClick={() => {
                      setError(null);
                      setDraft({
                        id: department.id,
                        name: department.name,
                        description: department.description,
                        sortOrder: String(department.sortOrder),
                      });
                    }}
                    aria-label={`Edit ${department.name}`}
                    className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
                  >
                    <Pencil className="size-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleting(department)}
                    aria-label={`Delete ${department.name}`}
                    className="rounded-md p-1.5 text-zinc-500 hover:bg-red-50 hover:text-red-700"
                  >
                    <Trash className="size-4" />
                  </button>
                </td>
              </tr>
            ))}
            {departments.length === 0 && (
              <tr>
                <td colSpan={6} className={cn(tableStyles.td, "py-10 text-center text-zinc-500")}>
                  No departments yet. Add one to start assigning members.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Dialog
        open={draft !== null}
        onClose={() => !pending && setDraft(null)}
        title={draft?.id ? "Edit department" : "Add department"}
        footer={
          <>
            <Button onClick={() => setDraft(null)} disabled={pending}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" form="department-form" disabled={pending}>
              {pending && <LoaderCircle className="animate-spin" />}
              {draft?.id ? "Save changes" : "Add department"}
            </Button>
          </>
        }
      >
        {draft && (
          <form id="department-form" onSubmit={submit} className="space-y-4" noValidate>
            <Field label="Department name" htmlFor="department-name" hint="For example: Coding Department">
              <Input
                id="department-name"
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                maxLength={80}
                autoFocus
              />
            </Field>
            <Field label="Description" htmlFor="department-description" optional>
              <Input
                id="department-description"
                value={draft.description}
                onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                maxLength={300}
              />
            </Field>
            <Field label="Display order" htmlFor="department-order" hint="Lower numbers appear first in the directory.">
              <Input
                id="department-order"
                type="number"
                min={0}
                max={999}
                value={draft.sortOrder}
                onChange={(event) => setDraft({ ...draft, sortOrder: event.target.value })}
                className="w-28"
              />
            </Field>
            <FormError message={error} />
          </form>
        )}
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={`Delete ${deleting?.name}?`}
        description="Departments can only be deleted once no members (active or inactive) are assigned to them."
        confirmLabel="Delete department"
        onConfirm={async () => {
          if (!deleting) return;
          const result = await deleteDepartmentAction(deleting.id);
          if (!result.ok) return result.error;
          toast("Department deleted", { detail: deleting.name });
          setDeleting(null);
          router.refresh();
        }}
      />
    </div>
  );
}

/* ---------------------------------- Positions ---------------------------------- */

export type PositionItem = { id: string; name: string; sortOrder: number; memberCount: number };

export function PositionsManager({ positions }: { positions: PositionItem[] }) {
  const router = useRouter();
  const [draft, setDraft] = useState<{ id: string | null; name: string; sortOrder: string } | null>(null);
  const [deleting, setDeleting] = useState<PositionItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    setPending(true);
    setError(null);
    const result = await savePositionAction({ id: draft.id, name: draft.name, sortOrder: draft.sortOrder });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    toast(draft.id ? "Position updated" : "Position added", { detail: draft.name });
    setDraft(null);
    router.refresh();
  }

  return (
    <>
      <ul className="divide-y divide-zinc-100">
        {positions.map((position) => (
          <li key={position.id} className="flex items-center gap-3 px-4 py-2">
            <span className="tabular w-8 text-[12px] text-zinc-400">{position.sortOrder}</span>
            <span className="flex-1 text-[13.5px] text-zinc-900">{position.name}</span>
            <span className="text-[12px] text-zinc-500">
              {position.memberCount} member{position.memberCount === 1 ? "" : "s"}
            </span>
            <button
              type="button"
              onClick={() => {
                setError(null);
                setDraft({ id: position.id, name: position.name, sortOrder: String(position.sortOrder) });
              }}
              aria-label={`Edit ${position.name}`}
              className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
            >
              <Pencil className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => setDeleting(position)}
              aria-label={`Delete ${position.name}`}
              className="rounded-md p-1.5 text-zinc-500 hover:bg-red-50 hover:text-red-700"
            >
              <Trash className="size-4" />
            </button>
          </li>
        ))}
        {positions.length === 0 && <li className="px-4 py-6 text-center text-[13px] text-zinc-500">No positions yet.</li>}
      </ul>
      <div className="border-t border-zinc-200 px-4 py-3">
        <Button
          size="sm"
          onClick={() => {
            setError(null);
            const nextOrder = positions.reduce((max, item) => Math.max(max, item.sortOrder), 0) + 1;
            setDraft({ id: null, name: "", sortOrder: String(nextOrder) });
          }}
        >
          <Plus />
          Add position
        </Button>
      </div>

      <Dialog
        open={draft !== null}
        onClose={() => !pending && setDraft(null)}
        title={draft?.id ? "Edit position" : "Add position"}
        size="sm"
        footer={
          <>
            <Button onClick={() => setDraft(null)} disabled={pending}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" form="position-form" disabled={pending}>
              {pending && <LoaderCircle className="animate-spin" />}
              Save
            </Button>
          </>
        }
      >
        {draft && (
          <form id="position-form" onSubmit={submit} className="space-y-4" noValidate>
            <Field label="Position/Role name" htmlFor="position-name">
              <Input id="position-name" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} maxLength={80} autoFocus />
            </Field>
            <Field label="Display order" htmlFor="position-order" hint="Members are listed by position order within each department.">
              <Input
                id="position-order"
                type="number"
                min={0}
                max={999}
                value={draft.sortOrder}
                onChange={(event) => setDraft({ ...draft, sortOrder: event.target.value })}
                className="w-28"
              />
            </Field>
            <FormError message={error} />
          </form>
        )}
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={`Delete ${deleting?.name}?`}
        description="Positions can only be deleted when no members hold them."
        confirmLabel="Delete position"
        onConfirm={async () => {
          if (!deleting) return;
          const result = await deletePositionAction(deleting.id);
          if (!result.ok) return result.error;
          toast("Position deleted", { detail: deleting.name });
          setDeleting(null);
          router.refresh();
        }}
      />
    </>
  );
}
