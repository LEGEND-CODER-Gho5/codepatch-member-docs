"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { cn } from "@/lib/cn";

/** Height of the sticky top bars (h-14), used if the bar cannot be measured. */
const BAR_HEIGHT = 56;

/**
 * The page's large title (an element with data-large-title="…") once it has
 * scrolled up under the top bar, otherwise null. Re-checks on every page.
 */
function useCompactTitle(ref: RefObject<HTMLElement | null>): string | null {
  const pathname = usePathname();
  const [state, setState] = useState<{ pathname: string; title: string | null }>({ pathname, title: null });
  // A new page starts with its large title visible.
  if (state.pathname !== pathname) setState({ pathname, title: null });

  useEffect(() => {
    const element = document.querySelector<HTMLElement>("[data-large-title]");
    if (!element) return;
    // The title counts as gone once it is behind the whole bar (taller on phones with a second row).
    const barHeight = Math.round(ref.current?.closest("header")?.getBoundingClientRect().height ?? BAR_HEIGHT);
    const observer = new IntersectionObserver(
      ([entry]) => {
        const hidden = !entry.isIntersecting && entry.boundingClientRect.top < barHeight;
        setState({ pathname, title: hidden ? element.dataset.largeTitle || element.textContent?.trim() || null : null });
      },
      { rootMargin: `-${barHeight}px 0px 0px 0px`, threshold: 0 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [pathname, ref]);

  return state.pathname === pathname ? state.title : null;
}

/**
 * Shows `children` in a top bar until the page's large title scrolls under the
 * bar; then the title itself slides into the bar in their place (and back
 * when you scroll up), like the large titles of iPhone apps.
 */
export function CompactTitle({
  children,
  className,
  titleClassName,
}: {
  children?: ReactNode;
  className?: string;
  titleClassName?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const title = useCompactTitle(ref);
  return (
    <span ref={ref} className={cn("grid min-w-0 items-center", className)}>
      <span
        className={cn(
          "col-start-1 row-start-1 min-w-0 transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none",
          title ? "pointer-events-none -translate-y-1 opacity-0" : "translate-y-0 opacity-100",
        )}
        aria-hidden={title ? true : undefined}
      >
        {children}
      </span>
      <span
        aria-hidden
        className={cn(
          "col-start-1 row-start-1 min-w-0 truncate text-[15px] font-semibold tracking-[-0.01em] transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none",
          title ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-1.5 opacity-0",
          titleClassName,
        )}
      >
        {title}
      </span>
    </span>
  );
}

function subscribeToScroll(onChange: () => void) {
  window.addEventListener("scroll", onChange, { passive: true });
  return () => window.removeEventListener("scroll", onChange);
}

/** True once the page has scrolled at all (for a top bar that gains its edge only then). */
export function useScrolled(): boolean {
  return useSyncExternalStore(
    subscribeToScroll,
    () => window.scrollY > 2,
    () => false,
  );
}
