"use client";

import { Check, Clock, Globe, Home, MapPin, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import { usePreferences } from "./preferences-provider";

/** The chapter's own time zone (the times the portal records use). */
const CHAPTER_ZONE = "America/New_York";

/* ------------------------------ A ticking second ------------------------------ */

let second = 0;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!timer) {
    second = Math.floor(Date.now() / 1000);
    timer = setInterval(() => {
      second = Math.floor(Date.now() / 1000);
      for (const notify of listeners) notify();
    }, 1000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

/** The current second on this device, or 0 while the page is still on the server (nothing to show yet). */
function useSecond(): number {
  return useSyncExternalStore(
    subscribe,
    () => second || Math.floor(Date.now() / 1000),
    () => 0,
  );
}

/* --------------------------------- Time zones --------------------------------- */

/** Everyday words people search for, pointing at a representative zone. */
const ALIASES: Record<string, string> = {
  "America/New_York": "eastern et est edt new york usa us",
  "America/Chicago": "central ct cst cdt chicago usa us",
  "America/Denver": "mountain mt mst mdt denver usa us",
  "America/Phoenix": "arizona mst",
  "America/Los_Angeles": "pacific pt pst pdt california los angeles san francisco seattle usa us",
  "America/Anchorage": "alaska akst akdt",
  "Pacific/Honolulu": "hawaii hst",
  "America/Toronto": "canada toronto ontario",
  "America/Vancouver": "canada vancouver",
  "America/Mexico_City": "mexico",
  "America/Sao_Paulo": "brazil brasil",
  "America/Argentina/Buenos_Aires": "argentina",
  "Europe/London": "uk united kingdom england britain gmt bst",
  "Europe/Dublin": "ireland",
  "Europe/Paris": "france cet cest",
  "Europe/Berlin": "germany deutschland cet cest",
  "Europe/Madrid": "spain",
  "Europe/Rome": "italy",
  "Europe/Amsterdam": "netherlands holland",
  "Europe/Moscow": "russia msk",
  "Africa/Cairo": "egypt",
  "Africa/Lagos": "nigeria",
  "Africa/Johannesburg": "south africa",
  "Africa/Nairobi": "kenya",
  "Asia/Dubai": "uae emirates gulf",
  "Asia/Karachi": "pakistan pkt",
  "Asia/Kolkata": "india ist calcutta kolkata mumbai delhi bangalore",
  "Asia/Calcutta": "india ist calcutta kolkata mumbai delhi bangalore",
  "Asia/Ho_Chi_Minh": "vietnam saigon",
  "Asia/Saigon": "vietnam ho chi minh",
  "Asia/Katmandu": "nepal kathmandu",
  "Europe/Kyiv": "ukraine kiev",
  "Europe/Kiev": "ukraine kyiv",
  "Asia/Riyadh": "saudi arabia",
  "Asia/Jerusalem": "israel",
  "Europe/Istanbul": "turkey turkiye",
  "Asia/Kuala_Lumpur": "malaysia",
  "Asia/Colombo": "sri lanka",
  "America/Bogota": "colombia",
  "America/Lima": "peru",
  "America/Santiago": "chile",
  "America/Halifax": "atlantic ast canada",
  "America/St_Johns": "newfoundland",
  "Europe/Stockholm": "sweden",
  "Europe/Oslo": "norway",
  "Europe/Warsaw": "poland",
  "Europe/Athens": "greece",
  "Europe/Lisbon": "portugal",
  "Europe/Zurich": "switzerland",
  "Asia/Dhaka": "bangladesh",
  "Asia/Kathmandu": "nepal",
  "Asia/Bangkok": "thailand",
  "Asia/Jakarta": "indonesia",
  "Asia/Singapore": "singapore sgt",
  "Asia/Manila": "philippines",
  "Asia/Shanghai": "china beijing cst",
  "Asia/Hong_Kong": "hong kong hkt",
  "Asia/Taipei": "taiwan",
  "Asia/Seoul": "korea south korea kst",
  "Asia/Tokyo": "japan jst",
  "Australia/Sydney": "australia aest aedt sydney melbourne",
  "Australia/Perth": "australia awst perth",
  "Pacific/Auckland": "new zealand nzst nzdt",
  UTC: "utc gmt coordinated universal time zulu",
};

type Zone = { id: string; city: string; region: string; offset: string; minutes: number; search: string };

function cityOf(id: string) {
  const parts = id.split("/");
  return parts[parts.length - 1].replace(/_/g, " ");
}

function offsetOf(id: string, at: Date): { label: string; minutes: number } {
  const part = new Intl.DateTimeFormat("en-US", { timeZone: id, timeZoneName: "shortOffset" })
    .formatToParts(at)
    .find((entry) => entry.type === "timeZoneName")?.value;
  const label = !part || part === "GMT" ? "GMT+0" : part;
  const match = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(label);
  const minutes = match ? (match[1] === "-" ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3] ?? 0)) : 0;
  return { label, minutes };
}

/** Every time zone this browser knows, with names and offsets to search by. */
function buildZones(): Zone[] {
  const now = new Date();
  const ids = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [CHAPTER_ZONE];
  const all = Array.from(new Set(["UTC", ...ids]));
  return all
    .map((id) => {
      const { label, minutes } = offsetOf(id, now);
      const region = id === "UTC" ? "Coordinated Universal Time" : id.split("/")[0].replace(/_/g, " ");
      const city = id === "UTC" ? "UTC" : cityOf(id);
      return {
        id,
        city,
        region,
        offset: label,
        minutes,
        search: `${city} ${id.replace(/[/_]/g, " ")} ${label} ${ALIASES[id] ?? ""}`.toLowerCase(),
      };
    })
    .sort((a, b) => a.minutes - b.minutes || a.city.localeCompare(b.city));
}

function deviceZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || CHAPTER_ZONE;
  } catch {
    return CHAPTER_ZONE;
  }
}

function formatClock(at: Date, zone: string, hour24: boolean, seconds: boolean) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hour: "numeric",
    minute: "2-digit",
    second: seconds ? "2-digit" : undefined,
    hourCycle: hour24 ? "h23" : "h12",
  }).format(at);
}

/* ---------------------------------- The clock ---------------------------------- */

/**
 * A live clock for any time zone. Click it to search by city, country,
 * region, abbreviation (PST, IST), or offset (GMT+5:30); the choice and the
 * 12/24-hour format are remembered on this device.
 */
export function LiveClock({ tone = "light", className }: { tone?: "light" | "dark"; className?: string }) {
  const { preferences, update } = usePreferences();
  const now = useSecond();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; right: number }>({ top: 0, right: 0 });
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  const hour24 = preferences.clock === "24";
  const zone = preferences.zone ?? (now ? deviceZone() : CHAPTER_ZONE);
  const zones = useMemo(() => (open ? buildZones() : []), [open]);

  // Whole-word matches (a city, a country, an abbreviation) rank above partial ones, so "india" finds
  // India before Indiana.
  const results = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return zones.slice(0, 80);
    const scored: { entry: Zone; score: number }[] = [];
    for (const entry of zones) {
      const tokens = entry.search.split(/\s+/);
      let score = 0;
      for (const word of words) {
        const points = tokens.includes(word)
          ? 5
          : entry.city.toLowerCase().startsWith(word)
            ? 4
            : tokens.some((token) => token.startsWith(word))
              ? 2
              : entry.search.includes(word)
                ? 1
                : 0;
        if (points === 0) {
          score = 0;
          break;
        }
        score += points;
      }
      if (score > 0) scored.push({ entry, score });
    }
    return scored
      .sort((a, b) => b.score - a.score || a.entry.minutes - b.entry.minutes)
      .slice(0, 80)
      .map((item) => item.entry);
  }, [zones, query]);
  const activeIndex = results.length ? Math.min(active, results.length - 1) : -1;

  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!root.current?.contains(target) && !panel.current?.contains(target)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  function choose(id: string | null) {
    update({ zone: id });
    setOpen(false);
    setQuery("");
  }

  const at = new Date((now || 0) * 1000);
  const label = zone === "UTC" ? "UTC" : cityOf(zone);

  return (
    <div ref={root} className={cn("relative", className)}>
      <button
        type="button"
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          setPosition({ top: rect.bottom + 8, right: Math.max(12, window.innerWidth - rect.right) });
          setActive(0);
          setOpen((value) => !value);
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={now ? `Time in ${label}: ${formatClock(at, zone, hour24, false)}. Change time zone` : "Clock. Change time zone"}
        className={cn(
          "flex h-8 items-center gap-2 rounded-md px-2 text-[13px] transition-colors",
          tone === "dark" ? "text-zinc-300 hover:bg-white/5 hover:text-white" : "text-zinc-600 hover:bg-zinc-200/60 hover:text-zinc-900",
        )}
      >
        <Clock className="size-4 shrink-0" aria-hidden />
        <span className="tabular font-medium whitespace-nowrap" aria-hidden>
          {now ? formatClock(at, zone, hour24, true) : "--:--:--"}
        </span>
        <span className={cn("max-w-28 truncate text-[12px]", tone === "dark" ? "text-zinc-500" : "text-zinc-400")} aria-hidden>
          {label}
        </span>
      </button>

      {open &&
        createPortal(
        <div
          ref={panel}
          role="dialog"
          aria-label="Choose a time zone"
          style={{ top: position.top, right: position.right }}
          className="fixed z-50 w-[min(360px,calc(100vw-1.5rem))] origin-top-right animate-[menu-in_140ms_ease-out] overflow-hidden rounded-xl border border-zinc-200 bg-surface text-zinc-900 shadow-raised motion-reduce:animate-none"
        >
          <div className="border-b border-zinc-200 px-3 pt-3 pb-2">
            <p className="font-serif text-[26px] leading-none font-medium text-zinc-950 tabular">{now ? formatClock(at, zone, hour24, true) : "--:--"}</p>
            <p className="mt-1 text-[12.5px] text-zinc-500">
              {label} · {now ? new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "long", month: "long", day: "numeric" }).format(at) : ""}
            </p>
            <div className="relative mt-3">
              <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-zinc-400" />
              <input
                ref={input}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActive(0);
                }}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                    event.preventDefault();
                    if (!results.length) return;
                    setActive((activeIndex + (event.key === "ArrowDown" ? 1 : -1) + results.length) % results.length);
                  } else if (event.key === "Enter" && results[activeIndex]) {
                    event.preventDefault();
                    choose(results[activeIndex].id);
                  }
                }}
                placeholder="City, country, PST, GMT+5:30…"
                aria-label="Search time zones"
                role="combobox"
                aria-expanded="true"
                aria-controls="clock-zone-results"
                aria-activedescendant={activeIndex >= 0 ? `clock-zone-${activeIndex}` : undefined}
                className="h-9 w-full rounded-md border border-zinc-300 bg-surface pr-3 pl-8 text-[13.5px] placeholder:text-zinc-400 focus:border-brand-500 focus:ring-3 focus:ring-brand-500/15 focus:outline-none"
              />
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => choose(null)}
                className="flex items-center gap-1 rounded-full border border-zinc-200 px-2.5 py-1 text-[12px] text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50"
              >
                <MapPin className="size-3.5" aria-hidden />
                This device
              </button>
              <button
                type="button"
                onClick={() => choose(CHAPTER_ZONE)}
                className="flex items-center gap-1 rounded-full border border-zinc-200 px-2.5 py-1 text-[12px] text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50"
              >
                <Home className="size-3.5" aria-hidden />
                Chapter (New York)
              </button>
              <button
                type="button"
                onClick={() => choose("UTC")}
                className="flex items-center gap-1 rounded-full border border-zinc-200 px-2.5 py-1 text-[12px] text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50"
              >
                <Globe className="size-3.5" aria-hidden />
                UTC
              </button>
            </div>
          </div>

          <ul ref={list} id="clock-zone-results" role="listbox" aria-label="Time zones" className="max-h-[min(320px,50vh)] overflow-y-auto py-1">
            {results.length === 0 ? (
              <li className="px-4 py-6 text-center text-[13px] text-zinc-500">No time zone matches “{query.trim()}”. Try a city or a country.</li>
            ) : (
              results.map((entry, index) => {
                const selected = entry.id === zone;
                return (
                  <li
                    key={entry.id}
                    id={`clock-zone-${index}`}
                    data-index={index}
                    role="option"
                    aria-selected={index === activeIndex}
                    onMouseMove={() => setActive(index)}
                    onClick={() => choose(entry.id)}
                    className={cn(
                      "mx-1 flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-1.5 text-[13px]",
                      index === activeIndex ? "bg-zinc-100" : "",
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-zinc-900">{entry.city}</span>
                      <span className="block truncate text-[11.5px] text-zinc-500">
                        {entry.region} · {entry.offset}
                      </span>
                    </span>
                    <span className="tabular text-[12.5px] text-zinc-600">{now ? formatClock(at, entry.id, hour24, false) : ""}</span>
                    <Check className={cn("size-4 shrink-0 text-brand-700", selected ? "opacity-100" : "opacity-0")} aria-hidden />
                  </li>
                );
              })
            )}
          </ul>

          <div className="flex items-center justify-between border-t border-zinc-200 bg-zinc-50 px-3 py-2 text-[12.5px] text-zinc-600">
            <span>{results.length === 80 ? "Showing 80 matches. Type to narrow." : `${results.length} time zone${results.length === 1 ? "" : "s"}`}</span>
            <button
              type="button"
              role="switch"
              aria-checked={hour24}
              onClick={() => update({ clock: hour24 ? "12" : "24" })}
              className="flex items-center gap-2 rounded px-1 font-medium text-zinc-700 hover:text-zinc-950"
            >
              24-hour
              <span aria-hidden className={cn("relative h-5 w-8 rounded-full transition-colors", hour24 ? "bg-accent" : "bg-zinc-300")}>
                <span className={cn("absolute top-0.5 size-4 rounded-full bg-white shadow transition-transform", hour24 ? "translate-x-3.5" : "translate-x-0.5")} />
              </span>
            </button>
          </div>
        </div>,
          document.body,
        )}
    </div>
  );
}
