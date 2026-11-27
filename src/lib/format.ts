export const APP_TIME_ZONE = "America/New_York";

type DateInput = string | Date | null | undefined;

const longDate = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIME_ZONE,
  month: "long",
  day: "numeric",
  year: "numeric",
});
const shortDate = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIME_ZONE,
  month: "short",
  day: "numeric",
  year: "numeric",
});
const timeOnly = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIME_ZONE,
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});
const timeWithSeconds = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIME_ZONE,
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
  timeZoneName: "short",
});
const isoDayInZone = new Intl.DateTimeFormat("en-CA", {
  timeZone: APP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const partsInZone = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const plainLong = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "long",
  day: "numeric",
  year: "numeric",
});
const plainShort = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "short",
  day: "numeric",
  year: "numeric",
});

function toDate(value: DateInput): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "November 24, 2026 — 6:42 PM EST" */
export function formatDateTime(value: DateInput): string {
  const date = toDate(value);
  if (!date) return "—";
  return `${longDate.format(date)} — ${timeOnly.format(date)}`;
}

/** "Nov 24, 2026, 6:42 PM EST" */
export function formatDateTimeShort(value: DateInput): string {
  const date = toDate(value);
  if (!date) return "—";
  return `${shortDate.format(date)}, ${timeOnly.format(date)}`;
}

export function formatDateLong(value: DateInput): string {
  const date = toDate(value);
  return date ? longDate.format(date) : "—";
}

export function formatDateShort(value: DateInput): string {
  const date = toDate(value);
  return date ? shortDate.format(date) : "—";
}

/** "6:42 PM EST" */
export function formatTime(value: DateInput): string {
  const date = toDate(value);
  return date ? timeOnly.format(date) : "—";
}

/** "6:42:13 PM EST" */
export function formatTimeWithSeconds(value: DateInput): string {
  const date = toDate(value);
  return date ? timeWithSeconds.format(date) : "—";
}

export function timeZoneAbbreviation(value: DateInput): string {
  const date = toDate(value) ?? new Date();
  return timeOnly.formatToParts(date).find((part) => part.type === "timeZoneName")?.value ?? "ET";
}

/** Formats a calendar date stored as YYYY-MM-DD without shifting it across time zones. */
export function formatPlainDate(value: string | null | undefined, style: "long" | "short" = "long"): string {
  if (!value) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return (style === "long" ? plainLong : plainShort).format(date);
}

/** Today's calendar date in America/New_York as YYYY-MM-DD. */
export function todayInAppTimeZone(): string {
  return isoDayInZone.format(new Date());
}

/** The UTC instant at which the given America/New_York calendar day begins. */
export function startOfDayInAppTimeZone(day: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return null;
  const [year, month, date] = [Number(match[1]), Number(match[2]), Number(match[3])];
  for (const offsetHours of [5, 4, 6, 3]) {
    const candidate = new Date(Date.UTC(year, month - 1, date, offsetHours));
    const parts = Object.fromEntries(partsInZone.formatToParts(candidate).map((p) => [p.type, p.value]));
    if (
      Number(parts.year) === year &&
      Number(parts.month) === month &&
      Number(parts.day) === date &&
      Number(parts.hour) === 0 &&
      Number(parts.minute) === 0
    ) {
      return candidate;
    }
  }
  return null;
}

export function addDays(day: string, amount: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return day;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + amount));
  return date.toISOString().slice(0, 10);
}

export function formatHours(value: number | null | undefined): string {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return "0";
  return (Math.round(amount * 100) / 100).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

export function formatCount(value: number | null | undefined): string {
  return Number(value ?? 0).toLocaleString("en-US");
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function memberCode(memberNumber: number | string): string {
  return `CPS-${memberNumber}`;
}
