export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export const LIMITS = {
  fullName: 120,
  email: 200,
  period: 160,
  shortField: 160,
  title: 200,
  details: 20000,
  description: 2000,
  departmentName: 80,
  departmentDescription: 300,
  positionName: 80,
  organizationName: 120,
  chapterName: 160,
} as const;

/** The shortest documentation password a member may choose for themselves. */
export const MEMBER_PASSWORD_MIN_LENGTH = 8;

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

// Strips control characters other than tab/newline so stored text stays printable.
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** Free text that is autosaved while typing: never trimmed, only length-limited. */
export function cleanFreeText(value: unknown, max: number, label: string): Result<string> {
  if (value === null || value === undefined) return { ok: true, value: "" };
  if (typeof value !== "string") return { ok: false, error: `${label} must be text.` };
  const cleaned = value.replace(/\r\n?/g, "\n").replace(CONTROL_CHARS, "");
  if (cleaned.length > max) return { ok: false, error: `${label} must be ${max.toLocaleString()} characters or fewer.` };
  return { ok: true, value: cleaned };
}

/** Single-line values such as names: trimmed with internal whitespace collapsed. */
export function cleanLine(value: unknown, max: number, label: string, required = false): Result<string> {
  if (value === null || value === undefined) value = "";
  if (typeof value !== "string") return { ok: false, error: `${label} must be text.` };
  const cleaned = value.replace(CONTROL_CHARS, "").replace(/\s+/g, " ").trim();
  if (required && cleaned.length === 0) return { ok: false, error: `${label} is required.` };
  if (cleaned.length > max) return { ok: false, error: `${label} must be ${max} characters or fewer.` };
  return { ok: true, value: cleaned };
}

export function cleanDate(value: unknown, label: string): Result<string | null> {
  if (value === null || value === undefined || value === "") return { ok: true, value: null };
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return { ok: false, error: `${label} must be a valid date.` };
  }
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d || y < 2000 || y > 2100) {
    return { ok: false, error: `${label} must be a valid date.` };
  }
  return { ok: true, value };
}

export function cleanHours(value: unknown): Result<number | null> {
  if (value === null || value === undefined || value === "") return { ok: true, value: null };
  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!/^\d{1,4}(\.\d{1,2})?$|^\.\d{1,2}$/.test(text)) {
    return { ok: false, error: "Hours must be a number with up to two decimal places." };
  }
  const amount = Number(text);
  if (!Number.isFinite(amount) || amount < 0 || amount > 1000) {
    return { ok: false, error: "Hours must be between 0 and 1000." };
  }
  return { ok: true, value: Math.round(amount * 100) / 100 };
}

export function cleanEmail(value: unknown): Result<string | null> {
  const line = cleanLine(value, LIMITS.email, "Email address");
  if (!line.ok) return line;
  if (!line.value) return { ok: true, value: null };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(line.value)) return { ok: false, error: "Enter a valid email address." };
  return { ok: true, value: line.value.toLowerCase() };
}

export function cleanInteger(value: unknown, min: number, max: number, label: string): Result<number> {
  const amount = typeof value === "number" ? value : Number(String(value ?? "").trim());
  if (!Number.isInteger(amount) || amount < min || amount > max) {
    return { ok: false, error: `${label} must be a whole number between ${min} and ${max}.` };
  }
  return { ok: true, value: amount };
}
