import type { ReactNode } from "react";
import { SeasonFlourish } from "@/components/season/season-icons";
import { cn } from "@/lib/cn";
import { initials } from "@/lib/format";

type Tone = "neutral" | "brand" | "success" | "warning" | "danger" | "info" | "dark";

const toneStyles: Record<Tone, string> = {
  neutral: "bg-zinc-100 text-zinc-700 ring-zinc-200",
  brand: "bg-brand-50 text-brand-800 ring-brand-200",
  success: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  warning: "bg-amber-50 text-amber-800 ring-amber-200",
  danger: "bg-red-50 text-red-800 ring-red-200",
  info: "bg-sky-50 text-sky-800 ring-sky-200",
  dark: "bg-charcoal-800 text-white ring-charcoal-700",
};

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-[4px] px-1.5 py-px text-[11.5px] font-medium whitespace-nowrap ring-1 ring-inset",
        toneStyles[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: "active" | "inactive" }) {
  return status === "active" ? (
    <Badge tone="success">
      <span className="size-1.5 rounded-full bg-emerald-600" aria-hidden />
      Active
    </Badge>
  ) : (
    <Badge tone="neutral">
      <span className="size-1.5 rounded-full bg-zinc-400" aria-hidden />
      Inactive
    </Badge>
  );
}

export function ActorBadge({ type }: { type: "member" | "admin" | "system" }) {
  if (type === "admin") return <Badge tone="brand">Administrator</Badge>;
  if (type === "system") return <Badge tone="neutral">System</Badge>;
  return <Badge tone="info">Member</Badge>;
}

export function Panel({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn("rounded-lg border border-zinc-200 bg-surface shadow-panel", className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-200 px-4 py-3">
          <div className="min-w-0">
            {title && <h2 className="text-[13.5px] font-semibold text-zinc-900">{title}</h2>}
            {description && <p className="mt-0.5 text-[12.5px] text-zinc-500">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
  compactTitle,
  display = false,
}: {
  title: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
  /** Plain text the top bar shows once the title scrolls away (defaults to the title when it is text). */
  compactTitle?: string;
  /** The serif headline of a home page (Overview), in the typeface of the chapter's official forms. */
  display?: boolean;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-[12px] font-medium text-zinc-500">{eyebrow}</div>}
        {/* Large on phones, like an iPhone app's title; it moves into the top bar as you scroll (CompactTitle). */}
        <h1
          data-large-title={compactTitle ?? (typeof title === "string" ? title : undefined)}
          className={
            display
              ? "season-display font-serif text-[30px] leading-[1.15] font-medium tracking-[-0.01em] text-zinc-950 sm:text-[34px]"
              : "season-display text-[28px] leading-tight font-bold tracking-[-0.015em] text-zinc-950 sm:text-[21px] sm:font-semibold sm:tracking-[-0.01em]"
          }
        >
          {title}
          {display && <SeasonFlourish />}
        </h1>
        {description && <p className={display ? "mt-2.5 max-w-2xl text-[15px] leading-relaxed text-zinc-600" : "mt-1 max-w-2xl text-[13.5px] text-zinc-600"}>{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center px-6 py-12 text-center", className)}>
      {icon && <div className="mb-3 text-zinc-400 [&_svg]:size-6">{icon}</div>}
      <p className="text-[14px] font-medium text-zinc-800">{title}</p>
      {description && <p className="mt-1 max-w-sm text-[13px] text-zinc-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Soft tints for initials; each name always gets the same one. */
const AVATAR_TONES = [
  "bg-brand-100 text-brand-800 ring-brand-200",
  "bg-sky-100 text-sky-800 ring-sky-200",
  "bg-emerald-100 text-emerald-800 ring-emerald-200",
  "bg-amber-100 text-amber-900 ring-amber-200",
  "bg-zinc-100 text-zinc-700 ring-zinc-200",
];

function avatarTone(name: string): string {
  let hash = 0;
  for (const char of name.trim().toLowerCase()) hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  return AVATAR_TONES[hash % AVATAR_TONES.length];
}

export function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-full text-[11.5px] font-semibold ring-1 ring-inset",
        avatarTone(name),
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

export function KeyValue({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-3 py-2 text-[13px]">
      <dt className="text-zinc-500">{label}</dt>
      <dd className="min-w-0 text-zinc-900">{children}</dd>
    </div>
  );
}

export const tableStyles = {
  wrapper: "relative overflow-x-auto",
  table: "w-full border-collapse text-left text-[13px]",
  th: "border-b border-zinc-200 bg-zinc-50/80 px-4 py-2 text-[12px] font-medium whitespace-nowrap text-zinc-500",
  td: "border-b border-zinc-100 px-4 py-2.5 align-middle",
  row: "transition-colors hover:bg-zinc-50/80",
};
