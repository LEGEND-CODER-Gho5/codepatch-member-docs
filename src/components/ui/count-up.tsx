"use client";

import { useEffect, useRef, useState } from "react";
import { formatCount, formatHours } from "@/lib/format";

/**
 * A number that glides to its new value when it changes while you watch (for
 * example when a member saves hours and the dashboard updates live). The first
 * render shows the value as is, so nothing flickers on page load. Respects
 * reduced motion.
 */
export function CountUp({ value, kind = "count" }: { value: number; kind?: "count" | "hours" }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);

  useEffect(() => {
    const start = from.current;
    from.current = value;
    if (start === value) return;
    const duration = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 650;
    const began = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const t = duration === 0 ? 1 : Math.min((now - began) / duration, 1);
      const eased = 1 - (1 - t) ** 3;
      setShown(start + (value - start) * eased);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value]);

  return <>{kind === "hours" ? formatHours(shown) : formatCount(Math.round(shown))}</>;
}
