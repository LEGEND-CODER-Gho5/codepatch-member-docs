"use client";

import { CircleCheck, CircleExclamationPoint, Info, X } from "lucide-react";
import { useSyncExternalStore } from "react";
import { cn } from "@/lib/cn";

type ToastKind = "success" | "error" | "info";
type ToastItem = { id: number; kind: ToastKind; message: string; detail?: string };

let toasts: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const EMPTY: ToastItem[] = [];

function emit() {
  for (const listener of listeners) listener();
}

export function toast(message: string, options: { kind?: ToastKind; detail?: string; duration?: number } = {}) {
  const item: ToastItem = { id: nextId++, kind: options.kind ?? "success", message, detail: options.detail };
  toasts = [...toasts.slice(-3), item];
  emit();
  window.setTimeout(() => dismiss(item.id), options.duration ?? (item.kind === "error" ? 6000 : 3800));
}

function dismiss(id: number) {
  toasts = toasts.filter((item) => item.id !== id);
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function Toaster() {
  const items = useSyncExternalStore(
    subscribe,
    () => toasts,
    () => EMPTY,
  );
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2 print:hidden"
    >
      {items.map((item) => (
        <div
          key={item.id}
          className="pointer-events-auto flex items-start gap-2.5 rounded-lg border border-zinc-200 bg-white px-3.5 py-3 shadow-raised"
        >
          {item.kind === "success" && <CircleCheck className="mt-px size-4 shrink-0 text-emerald-600" />}
          {item.kind === "error" && <CircleExclamationPoint className="mt-px size-4 shrink-0 text-red-600" />}
          {item.kind === "info" && <Info className="mt-px size-4 shrink-0 text-brand-600" />}
          <div className="min-w-0 flex-1">
            <p className={cn("text-[13px] font-medium", item.kind === "error" ? "text-red-900" : "text-zinc-900")}>{item.message}</p>
            {item.detail && <p className="mt-0.5 text-[12.5px] text-zinc-500">{item.detail}</p>}
          </div>
          <button
            type="button"
            onClick={() => dismiss(item.id)}
            className="-mr-1 rounded p-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
            aria-label="Dismiss"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
