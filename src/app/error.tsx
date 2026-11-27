"use client";

import { RotateCcw } from "lucide-react";
import { BrandMark } from "@/components/brand";
import { Button } from "@/components/ui/button";

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <BrandMark />
      <h1 className="mt-6 text-[20px] font-semibold text-zinc-950">Something went wrong</h1>
      <p className="mt-2 max-w-sm text-[13.5px] text-zinc-600">
        The page could not be loaded. No changes were lost — saved documentation is stored on the server.
      </p>
      {error.digest && <p className="mt-2 font-mono text-[11.5px] text-zinc-400">Reference: {error.digest}</p>}
      <Button className="mt-6" onClick={reset}>
        <RotateCcw />
        Try again
      </Button>
    </main>
  );
}
