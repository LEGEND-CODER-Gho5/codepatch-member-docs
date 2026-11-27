import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/cn";

/*
 * Thanksgiving decorations, drawn as vector shapes: sharp on any screen (4K
 * included), a few kilobytes, and colored by the autumn palette in
 * globals.css, which has its own steps for dark mode. Decorative only.
 */

const MAPLE =
  "M0 -46 L6 -33 L15 -38 L12 -21 L27 -30 L31 -23 L23 -11 L41 -15 L37 -5 L46 3 L28 12 L32 24 L16 20 L10 30 L4 22 L1.5 40 L-1.5 40 L-4 22 L-10 30 L-16 20 L-32 24 L-28 12 L-46 3 L-37 -5 L-41 -15 L-23 -11 L-31 -23 L-27 -30 L-12 -21 L-15 -38 L-6 -33 Z";
const OAK =
  "M0 -46 C7 -46 9 -39 6 -35 C13 -35 15 -28 10 -24 C17 -22 17 -13 10 -11 C17 -7 16 2 9 3 C14 8 13 15 6 16 C8 21 6 26 1.5 26 L-1.5 26 C-6 26 -8 21 -6 16 C-13 15 -14 8 -9 3 C-16 2 -17 -7 -10 -11 C-17 -13 -17 -22 -10 -24 C-15 -28 -13 -35 -6 -35 C-9 -39 -7 -46 0 -46 Z";
const LEAF = "M0 -40 C16 -26 18 8 0 30 C-18 8 -16 -26 0 -40 Z";

/** A soft highlight-to-shadow across each leaf (shared gradient in the garland's defs). */
const SHEEN_ID = "cps-autumn-sheen";
const SHEEN = `url(#${SHEEN_ID})`;

function MapleLeaf({ color }: { color: string }) {
  return (
    <>
      <path d="M0 22 Q1 36 3 50" fill="none" stroke="var(--autumn-bark)" strokeWidth="2.4" strokeLinecap="round" />
      <path d={MAPLE} fill={color} stroke={color} strokeWidth="3" strokeLinejoin="round" />
      <path d={MAPLE} fill={SHEEN} stroke={SHEEN} strokeWidth="3" strokeLinejoin="round" />
      <path
        d="M0 24 L0 -38 M0 6 L-30 -12 M0 6 L30 -12 M0 16 L-22 18 M0 16 L22 18 M0 -14 L-11 -24 M0 -14 L11 -24"
        fill="none"
        stroke="var(--autumn-vein)"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </>
  );
}

function OakLeaf({ color }: { color: string }) {
  return (
    <>
      <path d="M0 24 Q0 36 -2 46" fill="none" stroke="var(--autumn-bark)" strokeWidth="2.2" strokeLinecap="round" />
      <path d={OAK} fill={color} />
      <path d={OAK} fill={SHEEN} />
      <path
        d="M0 24 L0 -40 M0 -24 L8 -29 M0 -24 L-8 -29 M0 -10 L11 -13 M0 -10 L-11 -13 M0 4 L9 3 M0 4 L-9 3"
        fill="none"
        stroke="var(--autumn-vein)"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </>
  );
}

function SimpleLeaf({ color }: { color: string }) {
  return (
    <>
      <path d="M0 28 L0 42" fill="none" stroke="var(--autumn-bark)" strokeWidth="2" strokeLinecap="round" />
      <path d={LEAF} fill={color} />
      <path d={LEAF} fill={SHEEN} />
      <path
        d="M0 28 L0 -34 M0 -14 L9 -22 M0 -14 L-9 -22 M0 2 L11 -6 M0 2 L-11 -6 M0 16 L8 10 M0 16 L-8 10"
        fill="none"
        stroke="var(--autumn-vein)"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </>
  );
}

function Acorn() {
  return (
    <>
      <ellipse cx="0" cy="9" rx="10" ry="13" fill="var(--autumn-acorn)" />
      <ellipse cx="-3.5" cy="5" rx="2.6" ry="5" fill="#ffffff" opacity="0.28" />
      <path d="M-13 -1 C-13 -12 13 -12 13 -1 C13 2.5 -13 2.5 -13 -1 Z" fill="var(--autumn-bark)" />
      <path d="M-8 -5 L8 -5 M-10 -1.5 L10 -1.5 M-4 -9 L-4 1 M2 -9.5 L2 1 M8 -7 L8 1 M-10 -6 L-10 1" stroke="#000" strokeOpacity="0.18" strokeWidth="0.9" />
      <path d="M0 -9 Q2 -15 5.5 -17" fill="none" stroke="var(--autumn-bark)" strokeWidth="2" strokeLinecap="round" />
    </>
  );
}

function Wheat() {
  const grains: ReactNode[] = [];
  for (let index = 0; index < 5; index++) {
    const y = -36 + index * 10;
    for (const side of [-1, 1]) {
      grains.push(
        <ellipse key={`${index}${side}`} cx={side * 4.6} cy={y} rx="3.6" ry="7.5" fill="var(--autumn-wheat)" transform={`rotate(${side * 28} ${side * 4.6} ${y})`} />,
      );
    }
  }
  return (
    <>
      <path d="M0 52 C1.5 22 0.5 -8 -1 -44" fill="none" stroke="var(--autumn-wheat-stem)" strokeWidth="2" strokeLinecap="round" />
      {grains}
      <ellipse cx="0" cy="-46" rx="3.4" ry="7.5" fill="var(--autumn-wheat)" />
      <path d="M0 -53 L0 -64 M-5 -41 L-11 -54 M5 -41 L11 -54 M-5 -31 L-13 -42 M5 -31 L13 -42" stroke="var(--autumn-wheat)" strokeWidth="0.9" strokeLinecap="round" />
    </>
  );
}

type Piece = { x: number; y: number; rotate: number; scale: number; art: ReactNode };

const PIECES: Piece[] = [
  { x: 34, y: 76, rotate: -24, scale: 1, art: <Wheat /> },
  { x: 92, y: 74, rotate: -16, scale: 0.92, art: <MapleLeaf color="var(--autumn-ember)" /> },
  { x: 150, y: 70, rotate: 22, scale: 0.86, art: <OakLeaf color="var(--autumn-olive)" /> },
  { x: 208, y: 78, rotate: 6, scale: 1.02, art: <MapleLeaf color="var(--autumn-amber)" /> },
  { x: 262, y: 92, rotate: -12, scale: 1, art: <Acorn /> },
  { x: 286, y: 84, rotate: 18, scale: 0.82, art: <Acorn /> },
  { x: 338, y: 72, rotate: -8, scale: 0.94, art: <MapleLeaf color="var(--autumn-cranberry)" /> },
  { x: 392, y: 74, rotate: 30, scale: 0.9, art: <SimpleLeaf color="var(--autumn-gold)" /> },
  { x: 440, y: 72, rotate: -26, scale: 0.84, art: <OakLeaf color="var(--autumn-bark-leaf)" /> },
  { x: 488, y: 76, rotate: 20, scale: 0.96, art: <Wheat /> },
];

/**
 * A garland of autumn leaves, acorns, and wheat. With `settle`, the pieces
 * drift into place once when the page opens (not for people who prefer
 * reduced motion).
 */
export function AutumnGarland({ className, settle = true }: { className?: string; settle?: boolean }) {
  return (
    <svg viewBox="0 0 522 150" aria-hidden className={cn("overflow-visible", className)} role="presentation">
      <defs>
        <linearGradient id={SHEEN_ID} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.26" />
          <stop offset="0.45" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="1" stopColor="#000000" stopOpacity="0.18" />
        </linearGradient>
      </defs>
      {PIECES.map((piece, index) => (
        <g key={index} transform={`translate(${piece.x} ${piece.y})`}>
          <g
            data-motion={settle ? "" : undefined}
            className={settle ? "animate-[leaf-settle_900ms_cubic-bezier(0.2,0.8,0.2,1)_both] [transform-box:fill-box] [transform-origin:center]" : undefined}
            style={settle ? ({ animationDelay: `${index * 70}ms` } as CSSProperties) : undefined}
          >
            <g transform={`rotate(${piece.rotate}) scale(${piece.scale})`}>{piece.art}</g>
          </g>
        </g>
      ))}
    </svg>
  );
}
