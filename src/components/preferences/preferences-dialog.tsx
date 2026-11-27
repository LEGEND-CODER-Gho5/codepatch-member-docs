"use client";

import {
  ALargeSmall,
  Contrast,
  Eye,
  Keyboard,
  Monitor,
  Moon,
  MoveHorizontal,
  RotateCcw,
  Ruler,
  Sparkles,
  Sun,
  Type,
  Underline,
  Wind,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { cn } from "@/lib/cn";
import { DEFAULT_PREFERENCES, type Preferences } from "@/lib/preferences";
import { LiveClock } from "./live-clock";
import { usePreferences } from "./preferences-provider";

type Choice<K extends keyof Preferences> = { value: Preferences[K]; label: string; icon?: LucideIcon };

/** A row of mutually exclusive choices (a radio group drawn as segments). */
function Segmented<K extends keyof Preferences>({ name, label, choices }: { name: K; label: string; choices: Choice<K>[] }) {
  const { preferences, update } = usePreferences();
  return (
    <div role="radiogroup" aria-label={label} className="grid auto-cols-fr grid-flow-col gap-1 rounded-lg bg-zinc-100 p-1">
      {choices.map((choice) => {
        const selected = preferences[name] === choice.value;
        const Icon = choice.icon;
        return (
          <button
            key={String(choice.value)}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => update({ [name]: choice.value } as Partial<Preferences>)}
            className={cn(
              "flex min-h-9 items-center justify-center gap-1.5 rounded-md px-2 text-[13px] font-medium transition-colors",
              selected ? "bg-surface text-zinc-950 shadow-panel ring-1 ring-zinc-200" : "text-zinc-600 hover:text-zinc-900",
            )}
          >
            {Icon && <Icon className="size-4 shrink-0" aria-hidden />}
            {choice.label}
          </button>
        );
      })}
    </div>
  );
}

/** An on/off switch with a title and one line of explanation. */
function Toggle<K extends keyof Preferences>({
  name,
  on,
  off,
  icon: Icon,
  title,
  description,
}: {
  name: K;
  on: Preferences[K];
  off: Preferences[K];
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  const { preferences, update } = usePreferences();
  const checked = preferences[name] === on;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => update({ [name]: checked ? off : on } as Partial<Preferences>)}
      className="flex w-full items-start gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-zinc-50"
    >
      <Icon className={cn("mt-0.5 size-[18px] shrink-0", checked ? "text-brand-700" : "text-zinc-400")} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px] font-medium text-zinc-900">{title}</span>
        <span className="block text-[12.5px] leading-snug text-zinc-500">{description}</span>
      </span>
      <span
        aria-hidden
        className={cn(
          "relative mt-0.5 h-6 w-10 shrink-0 rounded-full transition-colors",
          checked ? "bg-accent" : "bg-zinc-300",
        )}
      >
        <span className={cn("absolute top-0.5 size-5 rounded-full bg-white shadow transition-transform", checked ? "translate-x-[18px]" : "translate-x-0.5")} />
      </span>
    </button>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="py-3 first:pt-0">
      <h3 className="mb-2 text-[12.5px] font-semibold text-zinc-500">{title}</h3>
      {children}
    </section>
  );
}

/**
 * Display & accessibility: theme, contrast, text size, font, spacing, motion,
 * focus, links, a reading guide, and seasonal decoration. Every change applies
 * at once and is remembered on this device.
 */
export function PreferencesDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { preferences, reset } = usePreferences();
  const changed = Object.entries(preferences).some(
    ([key, value]) => key !== "zone" && key !== "clock" && value !== (DEFAULT_PREFERENCES as Record<string, unknown>)[key],
  );

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Display & accessibility"
      description="Changes apply right away and are remembered on this device."
      footer={
        <>
          <Button size="sm" variant="ghost" onClick={reset} disabled={!changed} className="mr-auto">
            <RotateCcw />
            Reset to defaults
          </Button>
          <Button size="sm" variant="primary" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      <div className="divide-y divide-zinc-100">
        <Section title="Clock">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 rounded-lg border border-zinc-200 px-2 py-1.5">
            <LiveClock />
            <span className="px-2 pb-1 text-[12px] text-zinc-500 sm:p-0 sm:pr-1">Click the time to change the time zone</span>
          </div>
        </Section>

        <Section title="Appearance">
          <Segmented
            name="theme"
            label="Theme"
            choices={[
              { value: "system", label: "System", icon: Monitor },
              { value: "light", label: "Light", icon: Sun },
              { value: "dark", label: "Dark", icon: Moon },
            ]}
          />
          <div className="mt-2">
            <Toggle
              name="contrast"
              on="high"
              off="standard"
              icon={Contrast}
              title="High contrast"
              description="Darker secondary text and stronger borders (lighter on dark backgrounds)."
            />
          </div>
        </Section>

        <Section title="Text">
          <Segmented
            name="text"
            label="Text size"
            choices={[
              { value: "default", label: "Default", icon: Type },
              { value: "large", label: "Large", icon: ALargeSmall },
              { value: "xlarge", label: "Extra large", icon: ALargeSmall },
            ]}
          />
          <div className="mt-2 space-y-0.5">
            <Toggle
              name="font"
              on="readable"
              off="standard"
              icon={Eye}
              title="Easy-read font"
              description="Atkinson Hyperlegible, designed so similar letters (I, l, 1) are easy to tell apart."
            />
            <Toggle
              name="spacing"
              on="wide"
              off="standard"
              icon={MoveHorizontal}
              title="Wider spacing"
              description="More room between letters, words, and lines."
            />
          </div>
        </Section>

        <Section title="Reading and navigation">
          <div className="space-y-0.5">
            <Toggle
              name="guide"
              on="on"
              off="off"
              icon={Ruler}
              title="Reading guide"
              description="A soft band follows your pointer to help you keep your place."
            />
            <Toggle
              name="focus"
              on="bold"
              off="standard"
              icon={Keyboard}
              title="Bold focus outline"
              description="A thick ring around whatever the keyboard is on."
            />
            <Toggle
              name="links"
              on="underline"
              off="standard"
              icon={Underline}
              title="Underline links"
              description="Text links are always underlined, not only on hover."
            />
          </div>
        </Section>

        <Section title="Motion and decoration">
          <div className="space-y-0.5">
            <Toggle
              name="motion"
              on="reduce"
              off="system"
              icon={Wind}
              title="Reduce motion"
              description="Turns off animations and transitions everywhere."
            />
            <Toggle
              name="decor"
              on="on"
              off="off"
              icon={Sparkles}
              title="Seasonal decorations"
              description="Holiday banners and artwork, like the Thanksgiving and winter garlands."
            />
          </div>
        </Section>
      </div>
    </Dialog>
  );
}
