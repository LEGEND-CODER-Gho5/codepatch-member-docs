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

/** Where a menu opens: below/above a button, or at a point (long press, right-click). */
export function menuPosition(items: MenuItem[], anchor: DOMRect | { x: number; y: number }): { top: number; left: number } {
  const estimatedHeight = items.length * 34 + 8;
  if ("width" in anchor) {
    const below = anchor.bottom + 4;
    const top = below + estimatedHeight > window.innerHeight - 8 ? Math.max(8, anchor.top - estimatedHeight - 4) : below;
    const left = Math.max(8, Math.min(anchor.right - WIDTH, window.innerWidth - WIDTH - 8));
    return { top, left };
  }
  const top = anchor.y + estimatedHeight > window.innerHeight - 8 ? Math.max(8, anchor.y - estimatedHeight) : anchor.y;
  const left = Math.max(8, Math.min(anchor.x, window.innerWidth - WIDTH - 8));
  return { top, left };
}

/**
 * The open menu itself: a list of actions at a fixed position. Closes on
 * Escape, a press outside it (other than `ignore`), resizing, or scrolling.
 */
export function MenuPanel({
  items,
  position,
  onClose,
  ignore,
  label,
}: {
  items: MenuItem[];
  position: { top: number; left: number };
  onClose: (reason: "select" | "escape" | "outside") => void;
  /** An element whose presses do not count as "outside" (the button that toggles the menu). */
  ignore?: React.RefObject<HTMLElement | null>;
  label?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  // The latest onClose, so the listeners below are set up once per opening.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const onClose = (reason: "select" | "escape" | "outside") => onCloseRef.current(reason);
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panelRef.current?.contains(target) && !ignore?.current?.contains(target)) onClose("outside");
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose("escape");
    };
    const close = () => onClose("outside");
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    panelRef.current?.querySelector<HTMLElement>("[role=menuitem]:not([aria-disabled=true])")?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [ignore]);

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
    <div
      ref={panelRef}
      role="menu"
      aria-label={label}
      onKeyDown={onPanelKey}
      style={{ top: position.top, left: position.left, width: WIDTH }}
      className="fixed z-50 origin-top-left animate-[menu-in_140ms_ease-out] rounded-md border border-zinc-200 bg-surface py-1 shadow-raised motion-reduce:animate-none"
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
            onClick={() => onClose("select")}
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
              onClose("select");
              item.onSelect?.();
            }}
          >
            {item.icon}
            {item.label}
          </button>
        ),
      )}
    </div>
  );
}

/** A "⋯" button that opens a menu of actions. */
export function Menu({ items, label = "More actions", trigger }: { items: MenuItem[]; label?: string; trigger?: ReactNode }) {
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  function toggle() {
    const rect = buttonRef.current?.getBoundingClientRect();
    setPosition((open) => (open || !rect ? null : menuPosition(items, rect)));
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={position !== null}
        aria-label={label}
        className="inline-flex size-8 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 aria-expanded:bg-zinc-100"
      >
        {trigger ?? <Ellipsis className="size-4" />}
      </button>
      {position && (
        <MenuPanel
          items={items}
          position={position}
          ignore={buttonRef}
          label={label}
          onClose={(reason) => {
            setPosition(null);
            if (reason === "escape") buttonRef.current?.focus();
          }}
        />
      )}
    </>
  );
}
