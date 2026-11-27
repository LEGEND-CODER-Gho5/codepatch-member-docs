import { todayInAppTimeZone } from "./format";

/**
 * Seasonal decoration, by the calendar in America/New_York:
 * - Thanksgiving: November 15 through November 30
 * - Winter holidays: December 1 through December 31
 * Each turns itself off when its dates end and returns the next year.
 * SEASONAL_THEME=off hides decoration; SEASONAL_THEME=thanksgiving or
 * SEASONAL_THEME=winter shows that season on any date (for previewing).
 */
export type SeasonId = "thanksgiving" | "winter";
export type Season = { id: SeasonId; key: string; title: string };

export const SEASON_COOKIE = "cps_season_hidden";

const TITLES: Record<SeasonId, string> = {
  thanksgiving: "Happy Thanksgiving",
  winter: "Happy holidays",
};

export function currentSeason(env: Record<string, string | undefined> = process.env, today = todayInAppTimeZone()): Season | null {
  const setting = env.SEASONAL_THEME?.trim().toLowerCase();
  if (setting === "off") return null;
  const [year, month, day] = today.split("-").map(Number);
  let id: SeasonId | null = null;
  if (setting === "thanksgiving" || setting === "winter") id = setting;
  else if (month === 11 && day >= 15) id = "thanksgiving";
  else if (month === 12) id = "winter";
  if (!id) return null;
  return { id, key: `${id}-${year}`, title: TITLES[id] };
}
