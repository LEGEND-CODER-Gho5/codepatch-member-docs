/**
 * Date order for a record's entries (contributions and volunteer-hours rows).
 * The order comes from each entry's date, so nothing extra is stored: oldest
 * or newest first, entries without a date last, and entries on the same date
 * in the order they were added. Each person's choice is remembered on their
 * device (the "order" display preference).
 */

export type EntryOrder = "oldest" | "newest";

export function compareDates(a: string, b: string, order: EntryOrder): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return order === "oldest" ? a.localeCompare(b) : b.localeCompare(a);
}

/** A sorted copy (stable: entries on the same date keep their order). */
export function sortByDate<T>(items: readonly T[], dateOf: (item: T) => string, order: EntryOrder): T[] {
  return [...items].sort((left, right) => compareDates(dateOf(left), dateOf(right), order));
}

export function isInDateOrder<T>(items: readonly T[], dateOf: (item: T) => string, order: EntryOrder): boolean {
  for (let index = 1; index < items.length; index++) {
    if (compareDates(dateOf(items[index - 1]), dateOf(items[index]), order) > 0) return false;
  }
  return true;
}
