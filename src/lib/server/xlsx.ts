/**
 * A small writer for Excel workbooks (.xlsx) — enough for data exports that
 * open in Excel, Google Sheets, Numbers, and LibreOffice: several sheets, a
 * bold frozen header row with filters, column widths, text, numbers, dates,
 * and date-times (shown in the chapter's time zone).
 *
 * Text is always written as text (never as a formula), so a value such as
 * "=1+1" typed by a member stays exactly that in the spreadsheet.
 *
 * Imports only node:zlib (for compression), so the command-line tests can load
 * it directly.
 */
import { deflateRawSync } from "node:zlib";

export type CellValue =
  | string
  | number
  | null
  | undefined
  /** A calendar date stored as YYYY-MM-DD. */
  | { date: string | null }
  /** A moment in time, shown in America/New_York. */
  | { time: string | Date | null };

export type Column = { header: string; width?: number };
export type SheetSpec = { name: string; columns: Column[]; rows: CellValue[][] };

const TIME_ZONE = "America/New_York";
const MAX_CELL_TEXT = 32_767;
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);

const STYLE = { normal: 0, header: 1, date: 2, dateTime: 3 } as const;

const localParts = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function escapeXml(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function columnLetters(index: number): string {
  let letters = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  return letters;
}

function plainDateSerial(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  return (Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) - EXCEL_EPOCH) / 86_400_000;
}

function dateTimeSerial(value: string | Date): number | null {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = Object.fromEntries(localParts.formatToParts(date).map((part) => [part.type, Number(part.value)]));
  const local = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return (local - EXCEL_EPOCH) / 86_400_000;
}

function textCell(ref: string, text: string, style: number): string {
  const value = escapeXml(text.length > MAX_CELL_TEXT ? text.slice(0, MAX_CELL_TEXT) : text);
  const styleAttr = style ? ` s="${style}"` : "";
  return `<c r="${ref}" t="inlineStr"${styleAttr}><is><t xml:space="preserve">${value}</t></is></c>`;
}

function numberCell(ref: string, value: number, style: number): string {
  const styleAttr = style ? ` s="${style}"` : "";
  return `<c r="${ref}"${styleAttr}><v>${value}</v></c>`;
}

function cellXml(ref: string, value: CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value === "" ? "" : textCell(ref, value, STYLE.normal);
  if (typeof value === "number") return Number.isFinite(value) ? numberCell(ref, value, STYLE.normal) : "";
  if ("date" in value) {
    if (!value.date) return "";
    const serial = plainDateSerial(value.date);
    return serial === null ? textCell(ref, value.date, STYLE.normal) : numberCell(ref, serial, STYLE.date);
  }
  if (!value.time) return "";
  const serial = dateTimeSerial(value.time);
  return serial === null ? "" : numberCell(ref, Number(serial.toFixed(8)), STYLE.dateTime);
}

function sheetXml(sheet: SheetSpec, selected: boolean): string {
  const lastColumn = columnLetters(Math.max(sheet.columns.length, 1) - 1);
  const lastRow = sheet.rows.length + 1;
  const header = sheet.columns.map((column, index) => textCell(`${columnLetters(index)}1`, column.header, STYLE.header)).join("");
  const body = sheet.rows
    .map((row, rowIndex) => {
      const r = rowIndex + 2;
      const cells = sheet.columns.map((_, index) => cellXml(`${columnLetters(index)}${r}`, row[index])).join("");
      return `<row r="${r}">${cells}</row>`;
    })
    .join("");
  const cols = sheet.columns
    .map((column, index) => `<col min="${index + 1}" max="${index + 1}" width="${column.width ?? 16}" customWidth="1"/>`)
    .join("");
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<dimension ref="A1:${lastColumn}${lastRow}"/>` +
    `<sheetViews><sheetView${selected ? ' tabSelected="1"' : ""} workbookViewId="0">` +
    `<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>` +
    `<selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="15"/>` +
    `<cols>${cols}</cols>` +
    `<sheetData><row r="1">${header}</row>${body}</sheetData>` +
    `<autoFilter ref="A1:${lastColumn}${lastRow}"/>` +
    `</worksheet>`
  );
}

const STYLES_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
  `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
  `<numFmts count="1"><numFmt numFmtId="164" formatCode="mmm d, yyyy h:mm AM/PM"/></numFmts>` +
  `<fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font>` +
  `<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts>` +
  `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
  `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
  `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
  `<cellXfs count="4">` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
  `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
  `<xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
  `<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
  `</cellXfs>` +
  `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
  `</styleSheet>`;

/** Excel sheet names: at most 31 characters, none of : \ / ? * [ ], unique. */
function sheetNames(sheets: SheetSpec[]): string[] {
  const used = new Set<string>();
  return sheets.map((sheet, index) => {
    let name = sheet.name.replace(/[:\\/?*[\]]/g, " ").trim().slice(0, 31) || `Sheet${index + 1}`;
    while (used.has(name.toLowerCase())) name = `${name.slice(0, 28)} ${index + 1}`;
    used.add(name.toLowerCase());
    return name;
  });
}

/** Builds the .xlsx file for the given sheets. */
export function buildWorkbook(sheets: SheetSpec[], options: { now?: Date } = {}): Buffer {
  if (sheets.length === 0) throw new Error("A workbook needs at least one sheet.");
  const names = sheetNames(sheets);
  const files: [string, string][] = [
    [
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
        sheets
          .map(
            (_, index) =>
              `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
          )
          .join("") +
        `</Types>`,
    ],
    [
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
        `</Relationships>`,
    ],
    [
      "xl/workbook.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
        `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
        `<bookViews><workbookView activeTab="0"/></bookViews>` +
        `<sheets>${names.map((name, index) => `<sheet name="${escapeXml(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("")}</sheets>` +
        `<definedNames>${sheets
          .map((sheet, index) => {
            const range = `$A$1:$${columnLetters(Math.max(sheet.columns.length, 1) - 1)}$${sheet.rows.length + 1}`;
            return `<definedName name="_xlnm._FilterDatabase" localSheetId="${index}" hidden="1">'${escapeXml(names[index].replace(/'/g, "''"))}'!${range}</definedName>`;
          })
          .join("")}</definedNames>` +
        `</workbook>`,
    ],
    [
      "xl/_rels/workbook.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        sheets
          .map(
            (_, index) =>
              `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
          )
          .join("") +
        `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
        `</Relationships>`,
    ],
    ["xl/styles.xml", STYLES_XML],
    ...sheets.map((sheet, index): [string, string] => [`xl/worksheets/sheet${index + 1}.xml`, sheetXml(sheet, index === 0)]),
  ];
  return zip(files.map(([name, text]) => ({ name, data: Buffer.from(text, "utf8") })), options.now ?? new Date());
}

/* ------------------------------------ ZIP ------------------------------------ */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 (the checksum ZIP stores for every file). */
export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date: Date): { time: number; day: number } {
  const year = Math.max(date.getUTCFullYear(), 1980);
  return {
    time: (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | Math.floor(date.getUTCSeconds() / 2),
    day: ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate(),
  };
}

/** A minimal ZIP archive writer (deflate, UTF-8 names, no ZIP64: exports are far below 4 GB). */
export function zip(entries: { name: string; data: Buffer }[], date: Date): Buffer {
  const { time, day } = dosDateTime(date);
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const compressed = deflateRawSync(entry.data);
    const checksum = crc32(entry.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(day, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    // extra length, comment length, disk number, internal attributes: 0
    central.writeUInt32LE(0, 38); // external attributes
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + compressed.length;
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}
