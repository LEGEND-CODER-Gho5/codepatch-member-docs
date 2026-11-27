import { cn } from "@/lib/cn";

export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative inline-flex size-8 shrink-0 items-center justify-center rounded-[6px] bg-brand-700 font-mono text-[11.5px] font-medium tracking-tight text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]",
        className,
      )}
    >
      <span className="absolute inset-[3px] rounded-[3px] border border-dashed border-white/30" />
      CP
    </span>
  );
}

export function Wordmark({
  organizationName,
  subtitle,
  tone = "dark",
  className,
}: {
  organizationName: string;
  subtitle?: string;
  tone?: "dark" | "light";
  className?: string;
}) {
  return (
    <span className={cn("flex min-w-0 items-center gap-2.5", className)}>
      <BrandMark />
      <span className="min-w-0 leading-tight">
        <span className={cn("block truncate text-[14px] font-semibold tracking-[-0.005em]", tone === "light" ? "text-white" : "text-zinc-950")}>
          {organizationName}
        </span>
        {subtitle && (
          <span className={cn("block truncate text-[11.5px]", tone === "light" ? "text-zinc-400" : "text-zinc-500")}>{subtitle}</span>
        )}
      </span>
    </span>
  );
}
