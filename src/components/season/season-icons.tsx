import { cn } from "@/lib/cn";
import { MAPLE } from "./autumn-art";

/*
 * Small holiday icons for the seasonal theme, drawn like the garland art.
 * Each piece is in the page all year but shows only while its season's
 * decoration is on (the .season-only-* rules in globals.css, keyed on
 * data-holiday and the Seasonal decorations setting), so server and client
 * components can use them without knowing the date. Decorative only.
 */

const VEINS = "M0 24 L0 -36 M0 6 L-28 -11 M0 6 L28 -11 M0 16 L-20 17 M0 16 L20 17";

export function MapleLeafIcon({ className, color = "var(--autumn-ember)" }: { className?: string; color?: string }) {
  return (
    <svg viewBox="-50 -50 100 104" aria-hidden className={className}>
      <path d="M0 22 Q1 36 3 50" fill="none" stroke={color} strokeWidth="5" strokeLinecap="round" />
      <path d={MAPLE} fill={color} stroke={color} strokeWidth="3" strokeLinejoin="round" />
      <path d={VEINS} fill="none" stroke="rgba(255,255,255,0.42)" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

const ARM = "M0 0 L0 -26 M0 -12 L-7.5 -19 M0 -12 L7.5 -19 M0 -20 L-5 -25 M0 -20 L5 -25";

export function SnowflakeIcon({ className, color = "var(--winter-frost)" }: { className?: string; color?: string }) {
  return (
    <svg viewBox="-30 -30 60 60" aria-hidden className={className}>
      <g fill="none" stroke={color} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
        {[0, 60, 120, 180, 240, 300].map((angle) => (
          <path key={angle} d={ARM} transform={`rotate(${angle})`} />
        ))}
      </g>
      <circle r="4" fill={color} />
    </svg>
  );
}

/** A leaf or a snowflake set after a headline, while the season shows. */
export function SeasonFlourish({ className }: { className?: string }) {
  const base = cn("ml-2.5 size-[0.72em] shrink-0 align-[0.02em]", className);
  return (
    <>
      <span aria-hidden className={cn("season-only-thanksgiving -rotate-12", base)}>
        <MapleLeafIcon className="size-full" />
      </span>
      <span aria-hidden className={cn("season-only-winter", base)}>
        <SnowflakeIcon className="size-full" />
      </span>
    </>
  );
}

/** A small round patch pinned to the corner of the "CP" mark, while the season shows. */
export function SeasonSticker() {
  const base =
    "absolute -top-[6px] -right-[6px] size-4 items-center justify-center rounded-full bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.14),0_1px_2px_rgba(0,0,0,0.25)]";
  return (
    <>
      <span aria-hidden className={cn("season-only-thanksgiving", base)}>
        <MapleLeafIcon className="size-[11px] -rotate-12" color="#c2410c" />
      </span>
      <span aria-hidden className={cn("season-only-winter", base)}>
        <SnowflakeIcon className="size-[11px]" color="#3a76a8" />
      </span>
    </>
  );
}

/** A thin trim in the season's colors along the bottom of a top bar. */
export function SeasonRibbon({ className }: { className?: string }) {
  return <span aria-hidden className={cn("season-ribbon pointer-events-none absolute inset-x-0 -bottom-px h-[2px]", className)} />;
}
