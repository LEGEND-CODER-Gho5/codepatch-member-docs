"use client";

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import { MenuPanel, menuPosition, type MenuItem } from "./menu";

/** How long a finger must rest on an item before its menu opens. */
const HOLD_MS = 450;
/** Moving the finger farther than this cancels the long press (it is a scroll or a swipe). */
const MOVE_TOLERANCE = 10;

type Point = { x: number; y: number };

/**
 * Long press (phones and tablets) or right-click (computers) on an item opens
 * its menu of actions at that spot, and the item lifts while the menu is
 * open, like an iPhone context menu. The keyboard's Menu key or Shift+F10
 * opens it too. Spread `handlers` on the item and render `menu` anywhere.
 */
export function useActionMenu(items: MenuItem[], label = "Actions") {
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const [pressing, setPressing] = useState(false);
  const press = useRef<(Point & { timer: number }) | null>(null);
  // The long press opened the menu: swallow the click that follows the finger lifting.
  const fired = useRef(false);
  const enabled = items.length > 0;

  useEffect(() => () => window.clearTimeout(press.current?.timer), []);

  function cancel() {
    if (press.current) window.clearTimeout(press.current.timer);
    press.current = null;
    setPressing(false);
  }

  function openAt(point: Point) {
    setPosition(menuPosition(items, point));
  }

  const handlers = {
    onPointerDown(event: ReactPointerEvent) {
      if (!enabled || event.pointerType === "mouse" || event.button !== 0) return;
      fired.current = false;
      cancel();
      const point = { x: event.clientX, y: event.clientY };
      setPressing(true);
      press.current = {
        ...point,
        timer: window.setTimeout(() => {
          press.current = null;
          setPressing(false);
          fired.current = true;
          navigator.vibrate?.(8);
          openAt(point);
        }, HOLD_MS),
      };
    },
    onPointerMove(event: ReactPointerEvent) {
      const start = press.current;
      if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > MOVE_TOLERANCE) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onContextMenu(event: ReactMouseEvent) {
      if (!enabled) return;
      event.preventDefault();
      cancel();
      if ((event.nativeEvent as PointerEvent).pointerType === "touch") fired.current = true;
      openAt({ x: event.clientX, y: event.clientY });
    },
    onClickCapture(event: ReactMouseEvent) {
      if (!fired.current) return;
      fired.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
    onKeyDown(event: ReactKeyboardEvent) {
      if (!enabled || !(event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))) return;
      event.preventDefault();
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      openAt({ x: rect.left + 16, y: rect.bottom - 4 });
    },
  };

  const open = position !== null;
  // Rendered at the page level: valid inside tables, and never placed relative to the lifted (transformed) item.
  const menu = position
    ? createPortal(<MenuPanel items={items} position={position} label={label} onClose={() => setPosition(null)} />, document.body)
    : null;

  /** Classes for the pressed/lifted look. */
  const liftClass = cn(
    "transition-[transform,box-shadow,background-color] duration-200 ease-out motion-reduce:transition-none",
    pressing && "scale-[0.985] select-none [-webkit-touch-callout:none]",
    open && "relative z-10 scale-[1.012] bg-surface shadow-raised",
  );

  return { handlers, menu, open, liftClass, cancel };
}

export type SwipeAction = {
  label: string;
  icon?: ReactNode;
  tone?: "danger" | "accent" | "neutral";
  onSelect: () => void;
};

const ACTION_WIDTH = 84;

/**
 * A list row with iPhone-style swipe actions and a long-press menu.
 * On a touch screen, swiping the row to the left reveals `swipeActions`;
 * tapping one runs it, tapping the row (or anywhere else) closes them.
 * Long press, right-click, or the Menu key opens `menuItems`.
 * With a mouse the row behaves normally (the actions stay in its menus).
 */
export function GestureRow({
  swipeActions = [],
  menuItems = [],
  menuLabel,
  children,
  className,
  as: Tag = "div",
}: {
  swipeActions?: SwipeAction[];
  menuItems?: MenuItem[];
  menuLabel?: string;
  children: ReactNode;
  className?: string;
  as?: "div" | "li";
}) {
  const width = swipeActions.length * ACTION_WIDTH;
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ x: number; y: number; start: number; axis: "x" | "y" | null } | null>(null);
  const swiped = useRef(false);
  const rowRef = useRef<HTMLElement | null>(null);
  const actionMenu = useActionMenu(menuItems, menuLabel);
  const revealed = offset !== 0;

  // An open row closes when you touch anything else or scroll.
  useEffect(() => {
    if (!revealed) return;
    const onPointer = (event: PointerEvent) => {
      if (!rowRef.current?.contains(event.target as Node)) setOffset(0);
    };
    const close = () => setOffset(0);
    document.addEventListener("pointerdown", onPointer);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("scroll", close, true);
    };
  }, [revealed]);

  const swipeHandlers =
    width === 0
      ? {}
      : {
          onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
            if (event.pointerType !== "touch") return;
            drag.current = { x: event.clientX, y: event.clientY, start: offset, axis: null };
            swiped.current = false;
          },
          onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
            const current = drag.current;
            if (!current) return;
            const dx = event.clientX - current.x;
            const dy = event.clientY - current.y;
            if (!current.axis) {
              if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
              current.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
              if (current.axis === "x") {
                actionMenu.cancel();
                try {
                  // Keep following the finger even if it leaves the row.
                  event.currentTarget.setPointerCapture(event.pointerId);
                } catch {
                  // Not an active pointer (some browsers, synthetic events): the swipe still works within the row.
                }
                swiped.current = true;
                setDragging(true);
              }
            }
            if (current.axis !== "x") return;
            let next = current.start + dx;
            // Resist a little past either end, like iOS.
            if (next > 0) next = next / 4;
            if (next < -width) next = -width + (next + width) / 4;
            setOffset(next);
          },
          onPointerUp() {
            const current = drag.current;
            drag.current = null;
            if (current?.axis !== "x") return;
            setDragging(false);
            setOffset((value) => (value < -width / 2 ? -width : 0));
          },
          onPointerCancel() {
            if (drag.current?.axis === "x") setOffset(0);
            drag.current = null;
            setDragging(false);
          },
        };

  // Both behaviours share the row's pointer events.
  const handlers = {
    ...actionMenu.handlers,
    onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
      actionMenu.handlers.onPointerDown(event);
      swipeHandlers.onPointerDown?.(event);
    },
    onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
      actionMenu.handlers.onPointerMove(event);
      swipeHandlers.onPointerMove?.(event);
    },
    onPointerUp() {
      actionMenu.handlers.onPointerUp();
      swipeHandlers.onPointerUp?.();
    },
    onPointerCancel() {
      actionMenu.handlers.onPointerCancel();
      swipeHandlers.onPointerCancel?.();
    },
    onClickCapture(event: ReactMouseEvent) {
      // A swipe, or a tap that closes revealed actions, is not a click on the row.
      if (swiped.current || (revealed && !dragging)) {
        swiped.current = false;
        event.preventDefault();
        event.stopPropagation();
        if (revealed) setOffset(0);
        return;
      }
      actionMenu.handlers.onClickCapture(event);
    },
  };

  return (
    <Tag ref={rowRef as never} className={cn("relative", (revealed || dragging) && "overflow-hidden", className)}>
      {width > 0 && (
        <div className="absolute inset-y-0 right-0 flex" style={{ width }} aria-hidden={!revealed}>
          {swipeActions.map((action) => (
            <button
              key={action.label}
              type="button"
              tabIndex={revealed ? 0 : -1}
              onClick={() => {
                setOffset(0);
                action.onSelect();
              }}
              className={cn(
                "flex flex-1 flex-col items-center justify-center gap-1 px-1 text-[12px] font-medium text-white [&_svg]:size-[18px]",
                action.tone === "danger" ? "bg-danger" : action.tone === "neutral" ? "bg-zinc-500" : "bg-accent",
              )}
            >
              {action.icon}
              {action.label}
            </button>
          ))}
        </div>
      )}
      <div
        {...handlers}
        style={width > 0 ? { transform: `translateX(${offset}px)` } : undefined}
        className={cn(
          "relative bg-surface",
          width > 0 && "touch-pan-y",
          width > 0 && !dragging && "transition-transform duration-200 ease-out motion-reduce:transition-none",
          !revealed && actionMenu.liftClass,
        )}
      >
        {children}
      </div>
      {actionMenu.menu}
    </Tag>
  );
}
