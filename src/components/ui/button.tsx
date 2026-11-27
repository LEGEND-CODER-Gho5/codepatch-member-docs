import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "danger-outline" | "dark";
export type ButtonSize = "xs" | "sm" | "md";

export function buttonStyles({
  variant = "secondary",
  size = "md",
  className,
}: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}) {
  return cn(
    "inline-flex shrink-0 select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-[background-color,border-color,color,box-shadow] duration-150 disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0",
    size === "xs" && "h-7 px-2 text-[12px] [&_svg]:size-3.5",
    size === "sm" && "h-8 px-2.5 text-[13px] [&_svg]:size-4",
    size === "md" && "h-9 px-3.5 text-[13.5px] [&_svg]:size-4",
    variant === "primary" &&
      "bg-accent text-white shadow-[0_1px_2px_rgba(27,18,43,0.3),inset_0_1px_0_rgba(255,255,255,0.08)] hover:bg-accent-hover active:bg-accent-active",
    variant === "secondary" &&
      "border border-zinc-300 bg-surface text-zinc-800 shadow-[0_1px_1px_rgba(0,0,0,0.04)] hover:border-zinc-400 hover:bg-zinc-50 active:bg-zinc-100",
    variant === "ghost" && "text-zinc-700 hover:bg-zinc-200/60 hover:text-zinc-900",
    variant === "danger" && "bg-danger text-white shadow-[0_1px_2px_rgba(80,10,10,0.25)] hover:bg-danger-hover",
    variant === "danger-outline" && "border border-red-200 bg-surface text-red-700 hover:border-red-300 hover:bg-red-50",
    variant === "dark" && "border border-white/10 bg-white/5 text-zinc-200 hover:bg-white/10 hover:text-white",
    className,
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize };

export function Button({ variant, size, className, type = "button", ...props }: ButtonProps) {
  return <button type={type} className={buttonStyles({ variant, size, className })} {...props} />;
}

type ButtonLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
};

export function ButtonLink({ href, variant, size, className, children, ...rest }: ButtonLinkProps) {
  return (
    <Link href={href} className={buttonStyles({ variant, size, className })} {...rest}>
      {children}
    </Link>
  );
}
