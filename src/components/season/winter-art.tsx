import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/cn";

/*
 * Winter holiday decorations, drawn as vector shapes: evergreen sprigs,
 * snowflakes, pinecones, and winter berries. Sharp on any screen (4K
 * included), colored by the winter palette in globals.css (with its own steps
 * for dark mode). Decorative only.
 */

const SHEEN_ID = "cps-winter-sheen";
const SHEEN = `url(#${SHEEN_ID})`;

function Snowflake({ size = 1 }: { size?: number }) {
  const arms: ReactNode[] = [];
  for (let index = 0; index < 6; index++) {
    arms.push(
      <g key={index} transform={`rotate(${index * 60})`}>
        <path d="M0 0 L0 -24 M0 -11 L-6.5 -17 M0 -11 L6.5 -17 M0 -18 L-4.5 -22.5 M0 -18 L4.5 -22.5" />
      </g>,
    );
  }
  return (
    <g transform={`scale(${size})`} fill="none" stroke="var(--winter-frost)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      {arms}
      <circle r="3.2" fill="var(--winter-frost)" stroke="none" />
    </g>
  );
}

/** An evergreen sprig: a curved twig with two layers of needles that shorten toward the tip. */
function PineSprig() {
  const needles: ReactNode[] = [];
  const steps = 16;
  for (let index = 0; index < steps; index++) {
    const t = index / (steps - 1);
    const y = 46 - t * 90;
    const x = Math.sin(t * Math.PI) * 3;
    for (const [spread, scale, color] of [
      [64, 1, "var(--winter-pine)"],
      [44, 0.82, "var(--winter-pine-light)"],
    ] as const) {
      const length = (19 - t * 10) * scale;
      for (const side of [-1, 1]) {
        const angle = ((side * spread - 90) * Math.PI) / 180;
        needles.push(
          <path
            key={`${index}${side}${spread}`}
            d={`M${x.toFixed(2)} ${y.toFixed(2)} l${(Math.cos(angle) * length).toFixed(2)} ${(Math.sin(angle) * length).toFixed(2)}`}
            stroke={color}
          />,
        );
      }
    }
  }
  return (
    <g fill="none" strokeWidth="2.3" strokeLinecap="round">
      <path d="M0 52 Q4 4 -1 -46" stroke="var(--winter-stem)" strokeWidth="2.8" />
      {needles}
      <path d="M-1 -46 l0 -9" stroke="var(--winter-pine-light)" />
    </g>
  );
}

function Pinecone() {
  const scales: ReactNode[] = [];
  for (let row = 0; row < 5; row++) {
    const y = -12 + row * 6.5;
    const width = 11 - Math.abs(row - 1.6) * 1.8;
    for (let column = -1; column <= 1; column++) {
      const x = column * width * 0.62 + (row % 2 ? width * 0.3 : 0);
      if (Math.abs(x) > width) continue;
      scales.push(<path key={`${row}${column}`} d={`M${(x - 3.4).toFixed(2)} ${y} q3.4 4.6 6.8 0`} />);
    }
  }
  return (
    <>
      <path d="M0 -20 Q2 -25 5 -27" fill="none" stroke="var(--winter-stem)" strokeWidth="2" strokeLinecap="round" />
      <ellipse cx="0" cy="0" rx="11.5" ry="19" fill="var(--winter-cone)" />
      <ellipse cx="0" cy="0" rx="11.5" ry="19" fill={SHEEN} />
      <g fill="none" stroke="var(--winter-cone-light)" strokeWidth="1.5" strokeLinecap="round">
        {scales}
      </g>
    </>
  );
}

function Berries() {
  const berries = [
    { x: -6, y: 4 },
    { x: 5, y: 6 },
    { x: 0, y: -4 },
  ];
  return (
    <>
      <path d="M0 -18 L0 -8 M0 -12 L-6 2 M0 -12 L5 4" fill="none" stroke="var(--winter-stem)" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M0 -18 C8 -24 14 -20 15 -14 C8 -12 3 -14 0 -18 Z" fill="var(--winter-pine-light)" />
      <path d="M0 -18 C-8 -25 -15 -21 -16 -15 C-9 -12 -3 -14 0 -18 Z" fill="var(--winter-pine)" />
      {berries.map((berry, index) => (
        <g key={index}>
          <circle cx={berry.x} cy={berry.y} r="5.4" fill="var(--winter-berry)" />
          <circle cx={berry.x - 1.6} cy={berry.y - 1.8} r="1.5" fill="#ffffff" opacity="0.55" />
        </g>
      ))}
    </>
  );
}

type Piece = { x: number; y: number; rotate: number; scale: number; art: ReactNode };

// An evergreen swag (sprigs fanning out from the middle), with ornaments resting on it.
const PIECES: Piece[] = [
  { x: 72, y: 92, rotate: -104, scale: 1.02, art: <PineSprig /> },
  { x: 168, y: 98, rotate: -80, scale: 0.96, art: <PineSprig /> },
  { x: 250, y: 100, rotate: -94, scale: 0.9, art: <PineSprig /> },
  { x: 272, y: 100, rotate: 94, scale: 0.9, art: <PineSprig /> },
  { x: 354, y: 98, rotate: 80, scale: 0.96, art: <PineSprig /> },
  { x: 450, y: 92, rotate: 104, scale: 1.02, art: <PineSprig /> },
  { x: 58, y: 46, rotate: 12, scale: 0.56, art: <Snowflake /> },
  { x: 126, y: 84, rotate: -10, scale: 1.15, art: <Berries /> },
  { x: 200, y: 104, rotate: -24, scale: 1.08, art: <Pinecone /> },
  { x: 261, y: 62, rotate: 0, scale: 1.18, art: <Snowflake /> },
  { x: 322, y: 104, rotate: 24, scale: 1.08, art: <Pinecone /> },
  { x: 396, y: 84, rotate: 10, scale: 1.15, art: <Berries /> },
  { x: 464, y: 46, rotate: -12, scale: 0.56, art: <Snowflake /> },
];

/**
 * A winter garland. With `settle`, the pieces drift into place once when the
 * page opens (not for people who prefer reduced motion).
 */
export function WinterGarland({ className, settle = true }: { className?: string; settle?: boolean }) {
  return (
    <svg viewBox="0 0 522 150" aria-hidden className={cn("overflow-visible", className)} role="presentation">
      <defs>
        <linearGradient id={SHEEN_ID} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.24" />
          <stop offset="0.45" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="1" stopColor="#000000" stopOpacity="0.2" />
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
