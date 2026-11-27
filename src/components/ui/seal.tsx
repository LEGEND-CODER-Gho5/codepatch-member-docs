import { cn } from "@/lib/cn";

/**
 * The Verified seal: a round patch with stitching, like the chapter's "CP"
 * mark (a stitched patch), and a check. Used wherever a record has been
 * signed off by the administrator. Colors follow light and dark mode.
 */
export function Seal({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 40 40" width={size} height={size} aria-hidden className={cn("shrink-0", className)}>
      <circle cx="20" cy="20" r="19.25" className="fill-emerald-600" />
      <circle
        cx="20"
        cy="20"
        r="15.6"
        fill="none"
        className="stroke-emerald-100"
        strokeWidth="1.5"
        strokeDasharray="2.4 2.1"
        strokeLinecap="round"
      />
      <path d="M13.6 20.6 17.9 24.8 26.6 15.8" fill="none" className="stroke-surface" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * The seal pressed onto a verified record (on screen only: the printed form
 * stays exactly as the official PDF).
 */
export function VerifiedStamp({ date, className }: { date: string; className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none flex -rotate-6 items-center gap-2.5 rounded-full border-[1.5px] border-emerald-600/60 py-1.5 pr-4 pl-1.5 text-emerald-800 select-none print:hidden",
        className,
      )}
    >
      <Seal size={30} />
      <span className="leading-tight">
        <span className="block font-serif text-[15px] font-medium tracking-[0.01em]">Verified</span>
        <span className="block text-[10.5px] text-emerald-700">{date}</span>
      </span>
    </div>
  );
}
