import { cookies } from "next/headers";
import { currentSeason, SEASON_COOKIE } from "@/lib/season";
import { SeasonalBanner } from "./seasonal-banner";

/**
 * The seasonal message for a page, when a season is on (Thanksgiving:
 * November 15-30; winter holidays: December) and this device has not closed it.
 */
export async function SeasonBanner({ message }: { message: string }) {
  const season = currentSeason();
  if (!season) return null;
  if ((await cookies()).get(SEASON_COOKIE)?.value === season.key) return null;
  return <SeasonalBanner season={season} message={message} />;
}
