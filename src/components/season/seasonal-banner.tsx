"use client";

import { X } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { SEASON_COOKIE, type Season } from "@/lib/season";
import { SeasonGarland } from "./season-garland";

/**
 * The seasonal message with its garland (Thanksgiving or winter holidays).
 * Closing it hides it on this device for the rest of the season (a cookie,
 * so the page never shows it again for a moment before hiding it).
 */
export function SeasonalBanner({ season, message }: { season: Season; message: string }) {
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;

  function hide() {
    document.cookie = `${SEASON_COOKIE}=${season.key}; path=/; max-age=${60 * 60 * 24 * 60}; samesite=lax`;
    setHidden(true);
  }

  return (
    <section
      data-season=""
      aria-label={season.title}
      className={cn(
        "relative mb-6 overflow-hidden rounded-lg border bg-surface shadow-panel print:hidden",
        season.id === "winter" ? "border-sky-200" : "border-amber-200",
      )}
    >
      <div className="flex flex-col-reverse sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1 px-5 pt-1 pb-5 sm:py-5">
          <p className="font-serif text-[24px] leading-tight font-medium tracking-[-0.01em] text-zinc-950">{season.title}</p>
          <p className="mt-1.5 max-w-xl text-[14px] leading-relaxed text-zinc-600">{message}</p>
        </div>
        <SeasonGarland
          id={season.id}
          className="mx-auto h-[92px] w-auto max-w-full shrink-0 px-6 pt-4 sm:mx-0 sm:h-[118px] sm:pt-0 sm:pr-12 sm:pl-0"
        />
      </div>
      <button
        type="button"
        onClick={hide}
        aria-label={`Hide the ${season.title} message`}
        title="Hide"
        className="absolute top-2 right-2 rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
      >
        <X className="size-4" />
      </button>
    </section>
  );
}
