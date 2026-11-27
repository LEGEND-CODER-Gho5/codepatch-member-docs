"use client";

import { Accessibility, Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";
import { cn } from "@/lib/cn";
import { LiveClock } from "./live-clock";
import { usePreferences } from "./preferences-provider";

const DARK_QUERY = "(prefers-color-scheme: dark)";

function subscribeToScheme(onChange: () => void) {
  const media = window.matchMedia(DARK_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

/** Whether the page is showing dark right now (a chosen theme, or the device's). */
function useDarkShown(): boolean {
  const { preferences } = usePreferences();
  const deviceDark = useSyncExternalStore(subscribeToScheme, () => window.matchMedia(DARK_QUERY).matches, () => false);
  return preferences.theme === "dark" || (preferences.theme === "system" && deviceDark);
}

function iconButton(tone: "light" | "dark") {
  return cn(
    "inline-flex size-8 items-center justify-center rounded-md transition-colors [&_svg]:size-[18px]",
    tone === "dark" ? "text-zinc-300 hover:bg-white/5 hover:text-white" : "text-zinc-600 hover:bg-zinc-200/60 hover:text-zinc-900",
  );
}

/** One click between light and dark (System, and everything else, is in Display & accessibility). */
export function ThemeToggle({ tone = "light", className }: { tone?: "light" | "dark"; className?: string }) {
  const { update } = usePreferences();
  const dark = useDarkShown();
  return (
    <button
      type="button"
      onClick={() => update({ theme: dark ? "light" : "dark" })}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Light mode" : "Dark mode"}
      className={cn(iconButton(tone), className)}
    >
      {dark ? <Sun /> : <Moon />}
    </button>
  );
}

export function DisplaySettingsButton({ tone = "light", className }: { tone?: "light" | "dark"; className?: string }) {
  const { openPanel } = usePreferences();
  return (
    <button
      type="button"
      onClick={openPanel}
      aria-label="Display and accessibility settings"
      title="Display & accessibility"
      className={cn(iconButton(tone), className)}
    >
      <Accessibility />
    </button>
  );
}

/** The clock, the light/dark switch, and the Display & accessibility button, for a top bar. */
export function HeaderTools({ tone = "light", showClock = true }: { tone?: "light" | "dark"; showClock?: boolean }) {
  return (
    <div className="flex items-center gap-0.5">
      {showClock && <LiveClock tone={tone} className="hidden lg:block" />}
      <ThemeToggle tone={tone} className="hidden sm:inline-flex" />
      <DisplaySettingsButton tone={tone} />
    </div>
  );
}
