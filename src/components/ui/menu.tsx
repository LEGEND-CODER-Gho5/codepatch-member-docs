"use client";

import { Ellipsis } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export type MenuItem =
  | {
      label: string;
      icon?: ReactNode;
      onSelect?: () => void;
      href?: string;
      tone?: "danger";
      disabled?: boolean;
    }
  | "separator";

const WIDTH = 216;

export function Menu({ items, label = "More actions", trigger }: { items: MenuItem[]; label?: string; trigger?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!panelRef.current?.contains(target) && !buttonRef.current?.contains(target)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    const close = () => setOpen(false);
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    panelRef.current?.querySelector<HTMLElement>("[role=menuitem]:not([aria-disabled=true])")?.focus();
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);

  function toggle() {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) {
      const estimatedHeight = items.length * 34 + 8;
      const below = rect.bottom + 4;
      const top = below + estimatedHeight > window.innerHeight - 8 ? Math.max(8, rect.top - estimatedHeight - 4) : below;
      const left = Math.max(8, Math.min(rect.right - WIDTH, window.innerWidth - WIDTH - 8));
      setPosition({ top, left });
    }
    setOpen((value) => !value);
  }

  function onPanelKey(event: React.KeyboardEvent) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const nodes = [...(panelRef.current?.querySelectorAll<HTMLElement>("[role=menuitem]:not([aria-disabled=true])") ?? [])];
    const index = nodes.indexOf(document.activeElement as HTMLElement);
    const next = event.key === "ArrowDown" ? (index + 1) % nodes.length : (index - 1 + nodes.length) % nodes.length;
    nodes[next]?.focus();
  }

  const itemClass = (danger?: boolean, disabled?: boolean) =>
    cn(
      "flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[13px] outline-none transition-colors [&_svg]:size-4 [&_svg]:shrink-0",
      danger ? "text-red-700 hover:bg-red-50 focus:bg-red-50 [&_svg]:text-red-600" : "text-zinc-700 hover:bg-zinc-100 focus:bg-zinc-100 [&_svg]:text-zinc-400",
      disabled && "pointer-events-none opacity-40",
    );

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        className="inline-flex size-8 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 aria-expanded:bg-zinc-100"
      >
        {trigger ?? <Ellipsis className="size-4" />}
      </button>
      {open && (
        <div
          ref={panelRef}
          role="menu"
          onKeyDown={onPanelKey}
          style={{ top: position.top, left: position.left, width: WIDTH }}
          className="fixed z-50 rounded-md border border-zinc-200 bg-white py-1 shadow-raised"
        >
          {items.map((item, index) =>
            item === "separator" ? (
              <div key={`sep-${index}`} className="my-1 h-px bg-zinc-100" />
            ) : item.href ? (
              <Link
                key={item.label}
                href={item.href}
                role="menuitem"
                aria-disabled={item.disabled}
                className={itemClass(item.tone === "danger", item.disabled)}
                onClick={() => setOpen(false)}
              >
                {item.icon}
                {item.label}
              </Link>
            ) : (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                aria-disabled={item.disabled}
                className={itemClass(item.tone === "danger", item.disabled)}
                onClick={() => {
                  setOpen(false);
                  item.onSelect?.();
                }}
              >
                {item.icon}
                {item.label}
              </button>
            ),
          )}
        </div>
      )}
    </>
  );
}
