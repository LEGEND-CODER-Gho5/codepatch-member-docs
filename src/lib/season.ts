import { todayInAppTimeZone } from "./format";

/**
 * Seasonal decoration. Thanksgiving runs from November 15 through November 30
 * (America/New_York) every year, then turns itself off until next November.
 * SEASONAL_THEME=off hides it, and SEASONAL_THEME=thanksgiving shows it on any
 * date (for previewing), without changing any code.
 */
export type Season = { id: "thanksgiving"; key: string };

export const SEASON_COOKIE = "cps_season_hidden";

export function currentSeason(env: Record<string, string | undefined> = process.env, today = todayInAppTimeZone()): Season | null {
  const setting = env.SEASONAL_THEME?.trim().toLowerCase();
  if (setting === "off") return null;
  const [year, month, day] = today.split("-").map(Number);
  const inWindow = month === 11 && day >= 15;
  if (!inWindow && setting !== "thanksgiving") return null;
  return { id: "thanksgiving", key: `thanksgiving-${year}` };
}
