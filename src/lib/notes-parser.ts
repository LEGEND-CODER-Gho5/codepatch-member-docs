/**
 * Paste-to-fill: turns a member's own notes (a Google Doc, a list, a table
 * copied from Sheets, a few paragraphs) into rows for their Volunteer Hours
 * Record or Member Documentation. It runs entirely in the browser: nothing
 * pasted leaves the device until the member checks the rows and adds them.
 *
 * It never guesses. A date or a number of hours is filled in only when the
 * text states it; anything it cannot find is left blank and flagged for the
 * member to fill in.
 *
 * Pure functions with no imports, so scripts/test-notes-parser.mjs can run them.
 */

export type NotesKind = "hours" | "contribution";

export type ParsedRow = {
  /** YYYY-MM-DD, or "" when the text gives no date. */
  date: string;
  /** Hours record: the description. Contribution: the short summary (title). */
  text: string;
  /** Contribution only: the full details. */
  details: string;
  /** Hours record only: a decimal number as text, or "" when the text gives none. */
  hours: string;
};

export type ParseResult = { rows: ParsedRow[]; truncated: boolean };

export const MAX_PASTE_CHARACTERS = 60_000;
export const MAX_PARSED_ROWS = 200;
const MAX_TITLE = 200;
const MAX_DESCRIPTION = 2000;
const MAX_DETAILS = 20_000;
const TITLE_TARGET = 90;

/* ------------------------------------ Dates ------------------------------------ */

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
};
const MONTH = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const ORDINAL = "(?:st|nd|rd|th)?";
const WEEKDAY = "(?:mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\\.?,?\\s*";

type Found = { iso: string; index: number; length: number };

const DATE_PATTERNS: { regex: RegExp; read: (match: RegExpExecArray) => [number | null, number, number] }[] = [
  // 2026-10-12
  { regex: /\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/gi, read: (m) => [Number(m[1]), Number(m[2]), Number(m[3])] },
  // October 12, 2026 · Oct. 12th · Sat, Oct 12-14 (a range keeps its first day)
  {
    regex: new RegExp(`(?:${WEEKDAY})?\\b${MONTH}\\.?\\s+(\\d{1,2})${ORDINAL}(?![a-z])(?:\\s*(?:-|to|through|&|and)\\s*(?:${MONTH}\\.?\\s+)?\\d{1,2}${ORDINAL}(?![a-z]))?(?:,?\\s+(\\d{4}))?(?!\\d|:\\d)`, "gi"),
    read: (m) => [m[4] ? Number(m[4]) : null, MONTHS[m[1].toLowerCase()], Number(m[2])],
  },
  // 12 October 2026 · 12th of Oct
  {
    regex: new RegExp(`(?:${WEEKDAY})?\\b(\\d{1,2})${ORDINAL}\\s+(?:of\\s+)?${MONTH}\\b\\.?(?:,?\\s+(\\d{4}))?`, "gi"),
    read: (m) => [m[3] ? Number(m[3]) : null, MONTHS[m[2].toLowerCase()], Number(m[1])],
  },
  // 10/12/2026 · 10/12/26 · 10.12.2026 · 10-12-2026
  {
    regex: /(?:\b|^)(\d{1,2})([/.-])(\d{1,2})\2(\d{4}|\d{2})\b/g,
    read: (m) => [Number(m[4].length === 2 ? `20${m[4]}` : m[4]), Number(m[1]), Number(m[3])],
  },
  // 10/12 (a fraction such as "1/2 hour" is not a date)
  {
    regex: /(?:\b|^)(\d{1,2})\/(\d{1,2})\b(?!\s*(?:hours?|hrs?|h\b|of an hour)|\/|\.\d)/gi,
    read: (m) => [null, Number(m[1]), Number(m[2])],
  },
];

function isoDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 2000 || year > 2100) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** A date with no year is the most recent one: this year's, unless that is more than a month ahead. */
function withYear(year: number | null, month: number, day: number, today: string): string | null {
  if (year !== null) return isoDate(year, month, day);
  const currentYear = Number(today.slice(0, 4));
  const thisYear = isoDate(currentYear, month, day);
  if (!thisYear) return isoDate(currentYear - 1, month, day);
  const limit = new Date(`${today}T00:00:00Z`);
  limit.setUTCDate(limit.getUTCDate() + 31);
  return new Date(`${thisYear}T00:00:00Z`) > limit ? isoDate(currentYear - 1, month, day) : thisYear;
}

/** The first date written in a line. */
export function findDate(line: string, today: string): Found | null {
  let best: Found | null = null;
  for (const pattern of DATE_PATTERNS) {
    pattern.regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.regex.exec(line))) {
      const [year, month, day] = pattern.read(match);
      const iso = withYear(year, month, day, today);
      if (iso && (!best || match.index < best.index)) best = { iso, index: match.index, length: match[0].length };
      if (iso) break;
    }
  }
  return best;
}

/* ------------------------------------ Hours ------------------------------------ */

const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12,
};
const HOUR_UNIT = "(?:hours?|hrs?\\.?|hr\\.?|h)(?![a-z])";
const MINUTE_UNIT = "(?:minutes?|mins?\\.?|m)(?![a-z])";
const NUM = "(\\d+(?:\\.\\d+)?|\\.\\d+)";

const HOUR_PATTERNS: { regex: RegExp; read: (match: RegExpExecArray) => number | null }[] = [
  // A range ("1-2 hours") says no single number: matched so it is removed, but gives no hours.
  { regex: new RegExp(`${NUM}\\s*(?:-|to)\\s*${NUM}\\s*${HOUR_UNIT}`, "i"), read: () => null },
  // 1 hour 30 minutes · 2h 15m · 1 hr and 45 mins
  {
    regex: new RegExp(`(\\d+)\\s*${HOUR_UNIT}\\s*(?:and\\s*|,\\s*)?(\\d+)\\s*${MINUTE_UNIT}`, "i"),
    read: (m) => Number(m[1]) + Number(m[2]) / 60,
  },
  // 1 1/2 hours · 1½ hours
  {
    regex: new RegExp(`(\\d+)\\s*(?:1/2|½)\\s*${HOUR_UNIT}`, "i"),
    read: (m) => Number(m[1]) + 0.5,
  },
  // half an hour · half hour · 1/2 hour
  { regex: new RegExp(`(?:half\\s+(?:an\\s+)?hour|(?:^|\\s)(?:1/2|½)\\s*${HOUR_UNIT})`, "i"), read: () => 0.5 },
  // Hours: 2 · hrs - 1.5
  { regex: new RegExp(`\\b(?:hours?|hrs?)\\s*[:=-]\\s*${NUM}(?![\\d/])`, "i"), read: (m) => Number(m[1]) },
  // 2 hours · 1.5 hrs · 3h
  { regex: new RegExp(`${NUM}\\s*${HOUR_UNIT}`, "i"), read: (m) => Number(m[1]) },
  // two hours · an hour
  {
    regex: new RegExp(`\\b(a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\\s+${HOUR_UNIT}`, "i"),
    read: (m) => NUMBER_WORDS[m[1].toLowerCase()],
  },
  // 90 minutes · 45 mins
  { regex: new RegExp(`(\\d+)\\s*${MINUTE_UNIT}`, "i"), read: (m) => Number(m[1]) / 60 },
];

/** Hours written in a line, and where they are (to take them out of the description). */
export function findHours(line: string): { hours: number | null; index: number; length: number } | null {
  for (const pattern of HOUR_PATTERNS) {
    const match = pattern.regex.exec(line);
    if (!match) continue;
    const raw = pattern.read(match);
    const hours = raw === null || !Number.isFinite(raw) || raw <= 0 || raw > 1000 ? null : Math.round(raw * 100) / 100;
    const leading = match[0].length - match[0].trimStart().length;
    return { hours, index: match.index + leading, length: match[0].length - leading };
  }
  return null;
}

function formatHours(hours: number | null): string {
  return hours === null ? "" : String(hours);
}

/* ------------------------------------ Lines ------------------------------------ */

const BULLET = /^\s*(?:[-*•◦▪‣·●○■□➤>]+|\(?\d{1,3}[.)]|\(?[a-z][.)])\s+/i;
/** Lines that are about the document, not an activity: headings, totals, names, signatures. */
const META_LINE =
  /^\s*(?:total(?:\s+volunteer)?(?:\s+hours)?|grand total|sum|name|member(?:\s+name)?|volunteer name|organi[sz]ation|chapter|position(?:\s*\/\s*role)?|role|(?:documentation|volunteer service|service)?\s*period|supervisor(?:\s+\w+)?|signature|member confirmation|date submitted)\b\s*[:\-–]/i;
const TOTAL_LINE = /^\s*(?:grand\s+)?(?:total|sum)\b/i;
const HEADER_CELL = /^\s*(?:date|day|when|description(?: of volunteer work)?|activity|activities|what i did|task|event|hours?|hrs|time|duration|notes?|details?|contribution|title)\s*$/i;

function cleanText(value: string): string {
  return value
    .replace(/\(\s*\)|\[\s*\]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s\-–—:|,;.]+/, "")
    .replace(/[\s\-–—:|,;]+$/, "")
    .trim();
}

function removeSpan(line: string, index: number, length: number): string {
  return `${line.slice(0, index)} ${line.slice(index + length)}`;
}

const LEAD_IN = /^(?:on|from|date|when)\s*:?$/i;

/**
 * Takes a date or hours out of a line when it stands apart (at the start or
 * end, in brackets, or after a dash or colon). In the middle of a sentence it
 * stays, so the wording still reads as the member wrote it.
 */
function stripSpan(line: string, index: number, length: number): string {
  const before = line.slice(0, index);
  const after = line.slice(index + length);
  const head = before.trimEnd();
  const tail = after.trim();
  const apart =
    head === "" ||
    LEAD_IN.test(head) ||
    /[-–—:,;|([•]$/.test(head) ||
    tail === "" ||
    /^[)\].,;:|\-–—]/.test(tail) ||
    /^(?:each|total|in total|per\s+\w+)\b/i.test(tail);
  if (!apart) return line;
  return `${LEAD_IN.test(head) ? "" : before} ${after}`;
}

/** Words left dangling once the hours are taken out ("for two hours" → "for"), and bare labels ("Time:"). */
const TRAILING_WORDS = /\s*\b(?:for|for about|for around|about|around|approx\.?|approximately|roughly|each|in total|total|spent|on|of|lasting)\s*$/i;
const LABEL_ONLY = /^(?:time|duration|hours?|hrs|total|spent|length|date|when|activity|description)$/i;

function tidy(rest: string, removedSomething: boolean): string {
  let text = cleanText(rest);
  for (let pass = 0; removedSomething && pass < 3 && TRAILING_WORDS.test(text); pass++) text = cleanText(text.replace(TRAILING_WORDS, ""));
  return LABEL_ONLY.test(text) ? "" : text;
}

/** Joins a row's lines: a sentence that already ends is followed by a space, anything else by a semicolon. */
function joinParts(parts: string[]): string {
  return parts.reduce((text, part) => (text ? `${text}${/[.!?]$/.test(text) ? " " : "; "}${part}` : part), "");
}

function splitCells(line: string): string[] | null {
  if (line.includes("\t")) return line.split("\t").map((cell) => cell.trim());
  const pipes = line.split("|");
  if (pipes.length >= 3) return pipes.map((cell) => cell.trim()).filter((cell, index, all) => cell || (index > 0 && index < all.length - 1));
  return null;
}

type Draft = { date: string; parts: string[]; hours: number | null; hoursSeen: boolean };

/** One line of a table (Google Sheets, Docs, Word, or a Markdown table): date, description, hours by column. */
function readCells(cells: string[], today: string, kind: NotesKind): Draft | "header" | null {
  const filled = cells.filter(Boolean);
  if (filled.length === 0) return null;
  if (filled.every((cell) => HEADER_CELL.test(cell) || /^:?-{2,}:?$/.test(cell))) return "header";
  if (META_LINE.test(filled[0]) || TOTAL_LINE.test(filled[0])) return null;
  let date = "";
  let hours: number | null = null;
  let hoursSeen = false;
  const parts: string[] = [];
  for (const cell of filled) {
    if (!date) {
      const found = findDate(cell, today);
      if (found && cleanText(removeSpan(cell, found.index, found.length)) === "") {
        date = found.iso;
        continue;
      }
    }
    if (!hoursSeen) {
      if (/^\d{1,4}(?:\.\d{1,2})?$|^\.\d{1,2}$/.test(cell)) {
        hours = Math.round(Number(cell) * 100) / 100;
        hoursSeen = true;
        // A contribution has no hours column: the number stays in its text.
        if (kind === "contribution") parts.push(`${cell} hours`);
        continue;
      }
      const found = findHours(cell);
      if (found && cleanText(removeSpan(cell, found.index, found.length)) === "") {
        hours = found.hours;
        hoursSeen = true;
        if (kind === "contribution") parts.push(cell);
        continue;
      }
    }
    parts.push(cell);
  }
  if (!date && parts.length === 0) return null;
  return { date, parts: parts.length ? [parts.join(" — ")] : [], hours, hoursSeen };
}

/* ------------------------------------ Rows ------------------------------------ */

function firstSentence(text: string): string {
  const line = text.split("\n")[0];
  const stop = line.search(/(?<=[a-z0-9)])[.!?](?:\s|$)|:\s|\s[-–—]\s/i);
  const head = (stop > 0 ? line.slice(0, stop) : line).trim();
  if (head.length <= TITLE_TARGET) return head;
  const cut = head.slice(0, TITLE_TARGET);
  const space = cut.lastIndexOf(" ");
  return `${(space > 40 ? cut.slice(0, space) : cut).trim()}…`;
}

function toRow(kind: NotesKind, draft: Draft): ParsedRow | null {
  const lines = draft.parts.map(cleanText).filter(Boolean);
  if (!draft.date && lines.length === 0 && draft.hours === null) return null;
  if (kind === "hours") {
    return {
      date: draft.date,
      text: joinParts(lines).slice(0, MAX_DESCRIPTION),
      details: "",
      hours: formatHours(draft.hours),
    };
  }
  const full = lines.join("\n");
  const title = firstSentence(full).slice(0, MAX_TITLE);
  // A one-sentence entry needs no details: they would only repeat the summary.
  const rest = full.replace(/[.!?]+$/, "") === title ? "" : full;
  return { date: draft.date, text: title, details: rest.slice(0, MAX_DETAILS), hours: "" };
}

/**
 * Reads pasted notes into rows. A line with a date starts a new row; the lines
 * after it (until the next date) add to that row. When the notes have no dates
 * at all, each list item or paragraph becomes its own row.
 */
export function parseNotes(input: string, kind: NotesKind, today: string): ParseResult {
  const text = input.slice(0, MAX_PASTE_CHARACTERS).replace(/\r\n?/g, "\n").replace(/[   ]/g, " ");
  const lines = text.split("\n");
  const drafts: Draft[] = [];
  let current = null as Draft | null;
  const preamble: string[] = [];
  const anyDate = lines.some((line) => findDate(line, today));

  const start = (draft: Draft) => {
    if (current) drafts.push(current);
    current = draft;
  };

  for (const rawLine of lines) {
    if (!rawLine.trim()) {
      if (!anyDate && current) {
        drafts.push(current);
        current = null;
      }
      continue;
    }

    // A table row is always its own row.
    const cells = splitCells(rawLine);
    if (cells) {
      const row = readCells(cells, today, kind);
      if (row !== "header" && row !== null) start(row);
      continue;
    }

    const isBullet = BULLET.test(rawLine);
    let line = rawLine.replace(BULLET, "").trim();
    if (META_LINE.test(line) || TOTAL_LINE.test(line)) continue;

    const date = findDate(line, today);
    let hours: number | null = null;
    let hoursSeen = false;
    if (date) line = stripSpan(line, date.index, date.length);
    // Hours come out of the wording only for the hours record; a contribution keeps them as written.
    const foundHours = kind === "hours" ? findHours(line) : null;
    if (foundHours) {
      hours = foundHours.hours;
      hoursSeen = true;
      line = stripSpan(line, foundHours.index, foundHours.length);
    }
    const rest = tidy(line, Boolean(date || foundHours));

    if (date) {
      start({ date: date.iso, parts: rest ? [rest] : [], hours, hoursSeen });
      continue;
    }
    if (!anyDate && (isBullet || !current)) {
      // Notes without dates: each list item or paragraph is its own row.
      start({ date: "", parts: rest ? [rest] : [], hours, hoursSeen });
      continue;
    }
    if (!current) {
      // Before the first date: a heading is dropped; anything longer is kept for the first row.
      if (rest && (rest.length > 60 || hoursSeen)) preamble.push(rest);
      continue;
    }
    const draft: Draft = current;
    if (rest) draft.parts.push(rest);
    if (hoursSeen && !draft.hoursSeen) {
      draft.hours = hours;
      draft.hoursSeen = true;
    }
  }
  if (current) drafts.push(current);

  if (preamble.length && drafts[0]) drafts[0].parts.unshift(...preamble);

  const rows = drafts.map((draft) => toRow(kind, draft)).filter((row): row is ParsedRow => row !== null);
  return { rows: rows.slice(0, MAX_PARSED_ROWS), truncated: rows.length > MAX_PARSED_ROWS || input.length > MAX_PASTE_CHARACTERS };
}

/**
 * Turns HTML copied from Google Docs, Word, or a web page into plain lines,
 * with each table row on one line and its cells separated by tabs, so tables
 * keep their columns when pasted.
 */
export function htmlToNotes(root: ParentNode): string {
  const out: string[] = [];
  let line = "";
  const BLOCKS = new Set(["P", "DIV", "LI", "H1", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE", "PRE", "SECTION", "ARTICLE", "UL", "OL"]);
  const breakLine = () => {
    out.push(line);
    line = "";
  };
  const walk = (node: Node) => {
    if (node.nodeType === 3) {
      line += (node.textContent ?? "").replace(/\s+/g, " ");
      return;
    }
    if (node.nodeType !== 1) return;
    const element = node as Element;
    const tag = element.tagName;
    if (tag === "STYLE" || tag === "SCRIPT" || tag === "META" || tag === "TITLE") return;
    if (tag === "BR") return breakLine();
    if (tag === "TABLE") {
      if (line.trim()) breakLine();
      for (const row of Array.from(element.querySelectorAll("tr"))) {
        const cells = Array.from(row.querySelectorAll("th, td")).map((cell) => (cell.textContent ?? "").replace(/\s+/g, " ").trim());
        out.push(cells.join("\t"));
      }
      return;
    }
    const block = BLOCKS.has(tag);
    if (block && line.trim()) breakLine();
    if (tag === "LI") line += "- ";
    element.childNodes.forEach(walk);
    if (block) breakLine();
  };
  root.childNodes.forEach(walk);
  if (line) out.push(line);
  return out
    .map((value) => value.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
