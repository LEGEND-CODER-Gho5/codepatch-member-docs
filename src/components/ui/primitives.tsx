import type { ReactNode } from "react";
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
  dark: "bg-charcoal-800 text-zinc-100 ring-charcoal-700",
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
    <section className={cn("rounded-lg border border-zinc-200 bg-white shadow-panel", className)}>
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
}: {
  title: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-[12px] font-medium text-zinc-500">{eyebrow}</div>}
        <h1 className="text-[21px] leading-tight font-semibold tracking-[-0.01em] text-zinc-950">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-[13.5px] text-zinc-600">{description}</p>}
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

export function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-[11.5px] font-semibold text-zinc-600 ring-1 ring-zinc-200 ring-inset",
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
  wrapper: "overflow-x-auto",
  table: "w-full border-collapse text-left text-[13px]",
  th: "border-b border-zinc-200 bg-zinc-50/80 px-4 py-2 text-[11.5px] font-semibold tracking-[0.02em] whitespace-nowrap text-zinc-500 uppercase",
  td: "border-b border-zinc-100 px-4 py-2.5 align-middle",
  row: "transition-colors hover:bg-zinc-50/80",
};
