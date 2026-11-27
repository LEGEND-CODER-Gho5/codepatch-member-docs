import type { SeasonId } from "@/lib/season";
import { AutumnGarland } from "./autumn-art";
import { WinterGarland } from "./winter-art";

/** The garland for a season. */
export function SeasonGarland({ id, className }: { id: SeasonId; className?: string }) {
  return id === "winter" ? <WinterGarland className={className} /> : <AutumnGarland className={className} />;
}
