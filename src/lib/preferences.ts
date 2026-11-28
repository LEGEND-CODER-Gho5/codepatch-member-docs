/**
 * Display and accessibility preferences, chosen by each person for their own
 * device (Display & accessibility panel). Stored in a cookie so the server can
 * apply them before the page draws (no flash of the wrong theme or size), and
 * read back defensively: anything unexpected falls back to the default.
 */

export const PREFERENCES_COOKIE = "cps_prefs";

export const PREFERENCE_OPTIONS = {
  theme: ["system", "light", "dark"],
  contrast: ["standard", "high"],
  text: ["default", "large", "xlarge"],
  font: ["standard", "readable"],
  spacing: ["standard", "wide"],
  motion: ["system", "reduce"],
  focus: ["standard", "bold"],
  links: ["standard", "underline"],
  guide: ["off", "on"],
  decor: ["on", "off"],
  clock: ["12", "24"],
  /** Date order of the entries in a record (src/lib/entry-order.ts). */
  order: ["oldest", "newest"],
} as const;

type Options = typeof PREFERENCE_OPTIONS;
export type Preferences = { [K in keyof Options]: Options[K][number] } & { zone: string | null };

export const DEFAULT_PREFERENCES: Preferences = {
  theme: "system",
  contrast: "standard",
  text: "default",
  font: "standard",
  spacing: "standard",
  motion: "system",
  focus: "standard",
  links: "standard",
  guide: "off",
  decor: "on",
  clock: "12",
  order: "oldest",
  zone: null,
};

const ZONE_PATTERN = /^[A-Za-z][A-Za-z0-9_+\-/]{1,63}$/;

/** Parses the cookie value; unknown keys and values are ignored. */
export function parsePreferences(raw: string | undefined | null): Preferences {
  const result: Preferences = { ...DEFAULT_PREFERENCES };
  if (!raw) return result;
  let data: unknown;
  try {
    data = JSON.parse(decodeURIComponent(raw));
  } catch {
    return result;
  }
  if (!data || typeof data !== "object") return result;
  const input = data as Record<string, unknown>;
  for (const key of Object.keys(PREFERENCE_OPTIONS) as (keyof Options)[]) {
    const value = input[key];
    if (typeof value === "string" && (PREFERENCE_OPTIONS[key] as readonly string[]).includes(value)) {
      (result as Record<string, unknown>)[key] = value;
    }
  }
  if (typeof input.zone === "string" && ZONE_PATTERN.test(input.zone)) result.zone = input.zone;
  return result;
}

/** Only the choices that differ from the defaults, to keep the cookie small. */
export function serializePreferences(preferences: Preferences): string {
  const changed: Record<string, string> = {};
  for (const [key, value] of Object.entries(preferences)) {
    if (value !== null && value !== (DEFAULT_PREFERENCES as Record<string, unknown>)[key]) changed[key] = value as string;
  }
  return encodeURIComponent(JSON.stringify(changed));
}

/** The data-* attributes on <html> that the stylesheet uses (globals.css, "Accessibility"). */
export function preferenceAttributes(preferences: Preferences): Record<string, string> {
  return {
    "data-theme": preferences.theme,
    "data-contrast": preferences.contrast,
    "data-text": preferences.text,
    "data-font": preferences.font,
    "data-spacing": preferences.spacing,
    "data-motion": preferences.motion,
    "data-focus": preferences.focus,
    "data-links": preferences.links,
    "data-decor": preferences.decor,
  };
}
