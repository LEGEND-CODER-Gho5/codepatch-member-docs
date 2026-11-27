"use client";

import { LoaderCircle, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Button } from "./button";
import { FormError, Input, Label } from "./field";

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  dismissible = true,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
  /** When false, Escape and backdrop clicks do not close the dialog. */
  dismissible?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onCancel={(event) => {
        event.preventDefault();
        if (dismissible) onClose();
      }}
      onMouseDown={(event) => {
        const dialog = ref.current;
        if (!dismissible || !dialog || event.target !== dialog) return;
        const rect = dialog.getBoundingClientRect();
        const inside =
          event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
        if (!inside) onClose();
      }}
      className={cn(
        "m-auto w-[calc(100%-2rem)] overflow-visible rounded-lg border border-zinc-200 bg-white p-0 text-zinc-900 shadow-raised",
        size === "sm" && "max-w-md",
        size === "md" && "max-w-lg",
        size === "lg" && "max-w-2xl",
      )}
    >
      {open && (
        <div className="flex max-h-[calc(100dvh-3rem)] flex-col">
          <header className="flex items-start justify-between gap-4 border-b border-zinc-200 px-5 py-4">
            <div className="min-w-0">
              <h2 className="text-[15px] font-semibold text-zinc-950">{title}</h2>
              {description && <p className="mt-0.5 text-[13px] text-zinc-500">{description}</p>}
            </div>
            {dismissible && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close dialog"
                className="-mt-0.5 -mr-1.5 rounded-md p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
              >
                <X className="size-4" />
              </button>
            )}
          </header>
          <div className="min-h-0 overflow-y-auto px-5 py-4">{children}</div>
          {footer && (
            <footer className="flex flex-wrap items-center justify-end gap-2 rounded-b-lg border-t border-zinc-200 bg-zinc-50/70 px-5 py-3">
              {footer}
            </footer>
          )}
        </div>
      )}
    </dialog>
  );
}

export function ConfirmDialog({
  open,
  onClose,
  title,
  description,
  confirmLabel,
  tone = "danger",
  onConfirm,
  requireText,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  tone?: "danger" | "primary";
  /** Return an error message to keep the dialog open, or nothing on success. */
  onConfirm: (typed: string) => Promise<string | void>;
  /** When set, the user must type this text before confirming. */
  requireText?: string;
  children?: ReactNode;
}) {
  const [pending, setPending] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Reset the confirmation input each time the dialog opens.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setTyped("");
      setError(null);
    }
  }

  const blocked = requireText ? typed.trim().toLowerCase() !== requireText.trim().toLowerCase() : false;

  async function run() {
    setPending(true);
    setError(null);
    try {
      const message = await onConfirm(typed);
      if (message) setError(message);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={() => !pending && onClose()}
      title={title}
      size="sm"
      footer={
        <>
          <Button onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant={tone === "danger" ? "danger" : "primary"} onClick={run} disabled={pending || blocked}>
            {pending && <LoaderCircle className="animate-spin" />}
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-[13.5px] text-zinc-700">
        {description && <div>{description}</div>}
        {children}
        {requireText && (
          <div className="space-y-1.5">
            <Label htmlFor="confirm-text">
              Type <span className="font-semibold text-zinc-900">{requireText}</span> to confirm
            </Label>
            <Input id="confirm-text" value={typed} onChange={(event) => setTyped(event.target.value)} autoComplete="off" />
          </div>
        )}
        <FormError message={error} />
      </div>
    </Dialog>
  );
}
