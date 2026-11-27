import Link from "next/link";
import { BrandMark } from "@/components/brand";
import { buttonStyles } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <BrandMark />
      <p className="mt-6 font-mono text-[12px] text-zinc-500">404</p>
      <h1 className="mt-1 text-[20px] font-semibold text-zinc-950">This page could not be found</h1>
      <p className="mt-2 max-w-sm text-[13.5px] text-zinc-600">The member or record may have been removed, or the link is incorrect.</p>
      <Link href="/" className={buttonStyles({ variant: "secondary", className: "mt-6" })}>
        Return to the directory
      </Link>
    </main>
  );
}
