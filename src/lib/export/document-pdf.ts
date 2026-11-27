import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { ExportLine, ExportModel } from "./document-model";

/**
 * Renders a document as a US Letter PDF that mirrors the print layout in
 * document-editor.tsx (PrintableDocument). Runs in the browser; only the
 * fonts are fetched, and nothing is sent to a server.
 */
export type PdfFonts = { regular: ArrayBuffer | Uint8Array; bold: ArrayBuffer | Uint8Array; signature: ArrayBuffer | Uint8Array };

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 54; // 0.75 in
const RIGHT = PAGE_W - MARGIN;
const CONTENT_W = RIGHT - MARGIN;
const BODY = 11;
const LEADING = 14.5;
const FIELD_STEP = 18.5;
const INK = rgb(0, 0, 0);
const MUTED = rgb(0.32, 0.32, 0.36); // zinc-600
const RULE = rgb(0.63, 0.63, 0.67); // zinc-400 (.doc-line)
const GRID = rgb(0.44, 0.44, 0.48); // zinc-500 (table borders)

let fontsPromise: Promise<PdfFonts> | null = null;
/** Fetches the bundled IBM Plex fonts once per page load. */
export function loadPdfFonts(): Promise<PdfFonts> {
  if (!fontsPromise) {
    const get = async (file: string) => {
      const response = await fetch(`/fonts/${file}`);
      if (!response.ok) throw new Error(`Could not load the font ${file}.`);
      return response.arrayBuffer();
    };
    fontsPromise = Promise.all([get("IBMPlexSans-Regular.woff"), get("IBMPlexSans-Bold.woff"), get("IBMPlexSerif-Italic.woff")])
      .then(([regular, bold, signature]) => ({ regular, bold, signature }))
      .catch((error) => {
        fontsPromise = null;
        throw error;
      });
  }
  return fontsPromise;
}

const clean = (text: string) => (text ?? "").replace(/\r\n?/g, "\n").replace(/\t/g, "    ");

/** Word-wraps text (keeping its line breaks); words longer than a line are split. */
function wrap(text: string, font: PDFFont, size: number, firstWidth: number, width = firstWidth): string[] {
  const out: string[] = [];
  const max = () => (out.length === 0 ? firstWidth : width);
  for (const paragraph of clean(text).split("\n")) {
    let line = "";
    for (const word of paragraph.split(/ +/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= max()) {
        line = candidate;
        continue;
      }
      if (line) out.push(line);
      line = "";
      let rest = word;
      while (font.widthOfTextAtSize(rest, size) > max()) {
        let cut = rest.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > max()) cut--;
        out.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
    }
    out.push(line);
  }
  return out;
}

type Fonts = { regular: PDFFont; bold: PDFFont; signature: PDFFont };

class Sheet {
  page!: PDFPage;
  y = 0;
  private doc: PDFDocument;
  readonly f: Fonts;
  constructor(doc: PDFDocument, f: Fonts) {
    this.doc = doc;
    this.f = f;
    this.newPage();
  }
  newPage() {
    this.page = this.doc.addPage([PAGE_W, PAGE_H]);
    this.y = PAGE_H - MARGIN;
  }
  room() {
    return this.y - MARGIN;
  }
  ensure(height: number) {
    if (height > this.room()) this.newPage();
  }
  gap(points: number) {
    this.y -= points;
  }
  /** One line of text whose top is at the current position. */
  line(text: string, { font = this.f.regular, size = BODY, color = INK, x = MARGIN, step = LEADING } = {}) {
    this.ensure(step);
    if (text) this.page.drawText(text, { x, y: this.y - size * 0.82, size, font, color });
    this.y -= step;
  }
  paragraph(text: string, options: { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb>; step?: number } = {}) {
    const font = options.font ?? this.f.regular;
    const size = options.size ?? BODY;
    for (const text_ of wrap(text, font, size, CONTENT_W)) this.line(text_, { ...options, font, size });
  }
  rule() {
    this.page.drawLine({ start: { x: MARGIN, y: this.y }, end: { x: RIGHT, y: this.y }, thickness: 0.75, color: RULE });
  }
  /** "Label: value" with a fill-in line under the value, like .doc-line in the print view. */
  field(item: ExportLine, { minLine = 194.4, step = FIELD_STEP } = {}) {
    const labelWidth = this.f.bold.widthOfTextAtSize(item.label, BODY);
    const valueX = MARGIN + labelWidth + 6;
    const font = item.style === "signature" ? this.f.signature : this.f.regular;
    const values = item.value ? wrap(item.value, font, BODY, RIGHT - valueX - 6) : [""];
    values.forEach((value, index) => {
      this.ensure(step);
      const baseline = this.y - BODY * 0.82 - 2;
      if (index === 0) this.page.drawText(item.label, { x: MARGIN, y: baseline, size: BODY, font: this.f.bold, color: INK });
      if (value) this.page.drawText(value, { x: valueX + 3, y: baseline, size: BODY, font, color: INK });
      if (item.style !== "plain") {
        const end = Math.min(RIGHT, Math.max(valueX + minLine, valueX + font.widthOfTextAtSize(value, BODY) + 9));
        this.page.drawLine({ start: { x: valueX, y: baseline - 3.5 }, end: { x: end, y: baseline - 3.5 }, thickness: 0.75, color: RULE });
      }
      this.y -= step;
    });
  }
}

function fieldsHeight(items: ExportLine[], step = FIELD_STEP) {
  return items.length * step;
}

export async function renderDocumentPdf(model: ExportModel, fonts: PdfFonts): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const f = {
    regular: await doc.embedFont(fonts.regular, { subset: true }),
    bold: await doc.embedFont(fonts.bold, { subset: true }),
    signature: await doc.embedFont(fonts.signature, { subset: true }),
  };
  doc.setTitle(model.fileTitle);
  doc.setAuthor(model.author);
  doc.setSubject(model.title);
  doc.setCreator("Code Patch STEM member portal");
  doc.setProducer("Code Patch STEM member portal");
  doc.setCreationDate(new Date());

  const s = new Sheet(doc, f);
  const headingFont = model.boldHeadings ? f.bold : f.regular;
  s.line(model.heading, { font: headingFont, size: 22, step: 26 });
  s.gap(10);
  s.line(model.title, { font: headingFont, size: 15, step: 19 });
  s.gap(8);
  for (const item of model.info) s.field(item);

  if (model.kind === "contribution") {
    s.gap(18);
    const top = s.y;
    const topPage = s.page;
    model.contributions.forEach((entry, index) => {
      if (index > 0) s.gap(9);
      // "<date> — <title>": the space before the dash is part of the offset, since wrap() drops leading spaces.
      const dateWidth = f.bold.widthOfTextAtSize(entry.date, BODY) + f.regular.widthOfTextAtSize(" ", BODY);
      const rest = entry.title ? `— ${entry.title}` : "";
      const titleLines = rest ? wrap(rest, f.regular, BODY, CONTENT_W - dateWidth, CONTENT_W) : [""];
      s.ensure(LEADING * Math.min(2, titleLines.length + (entry.details ? 1 : 0)));
      titleLines.forEach((text, i) => {
        s.ensure(LEADING);
        const baseline = s.y - BODY * 0.82;
        if (i === 0) {
          s.page.drawText(entry.date, { x: MARGIN, y: baseline, size: BODY, font: f.bold, color: INK });
          if (text) s.page.drawText(text, { x: MARGIN + dateWidth, y: baseline, size: BODY, font: f.regular, color: INK });
        } else {
          s.page.drawText(text.trimStart(), { x: MARGIN, y: baseline, size: BODY, font: f.regular, color: INK });
        }
        s.y -= LEADING;
      });
      if (entry.details) {
        s.gap(1.5);
        s.paragraph(entry.details);
      }
    });
    // The form leaves room for entries (2.5 in) before the verification block.
    if (s.page === topPage && top - s.y < 180) s.y = top - 180;

    const certificationLines = wrap(model.certification, f.regular, BODY, CONTENT_W).length;
    const blockHeight =
      18 + 19 + 6 + fieldsHeight(model.verification, FIELD_STEP + 4) + 24 + fieldsHeight(model.confirmation, FIELD_STEP + 4) + 18 + certificationLines * LEADING;
    s.gap(18);
    s.ensure(blockHeight - 18);
    s.line(model.verificationTitle, { font: f.bold, size: 13, step: 18 });
    s.gap(6);
    for (const item of model.verification) s.field(item, { step: FIELD_STEP + 4 });
    s.gap(10);
    s.rule();
    s.gap(14);
    for (const item of model.confirmation) s.field(item, { step: FIELD_STEP + 4 });
    s.gap(16);
    s.paragraph(model.certification);
    return doc.save();
  }

  // Volunteer Hours Record
  const table = model.hoursSection;
  if (!table) return doc.save();
  s.gap(15);
  s.line(table.title, { size: 13, color: MUTED, step: 18 });
  s.gap(6);
  const SIZE = 10.5;
  const LINE = 13;
  const widths = [93.6, CONTENT_W - 93.6 - 57.6, 57.6];
  const xs = [MARGIN, MARGIN + widths[0], MARGIN + widths[0] + widths[1], RIGHT];
  const drawRow = (cells: [string[], string[], string[]], height: number, font: PDFFont) => {
    const top = s.y;
    for (let c = 0; c < 3; c++) {
      cells[c].forEach((text, i) => {
        const width = font.widthOfTextAtSize(text, SIZE);
        const x = c === 2 ? xs[3] - 6 - width : xs[c] + 6;
        s.page.drawText(text, { x, y: top - 3 - SIZE * 0.82 - i * LINE, size: SIZE, font, color: INK });
      });
    }
    const bottom = top - height;
    for (const x of xs) s.page.drawLine({ start: { x, y: top }, end: { x, y: bottom }, thickness: 0.75, color: GRID });
    s.page.drawLine({ start: { x: MARGIN, y: top }, end: { x: RIGHT, y: top }, thickness: 0.75, color: GRID });
    s.page.drawLine({ start: { x: MARGIN, y: bottom }, end: { x: RIGHT, y: bottom }, thickness: 0.75, color: GRID });
    s.y = bottom;
  };
  const headerRow = () => drawRow([[table.columns[0]], [table.columns[1]], [table.columns[2]]], LINE + 6, f.bold);
  s.ensure((LINE + 6) * 2);
  headerRow();
  const rows = table.rows.map((row) => {
    const description = wrap(row.description, f.regular, SIZE, widths[1] - 12);
    return { cells: [[row.date], description, [row.hours]] as [string[], string[], string[]], height: Math.max(21.6, description.length * LINE + 6) };
  });
  const padding = Math.max(0, 10 - rows.length);
  for (let i = 0; i < padding; i++) rows.push({ cells: [[""], [""], [""]], height: 21.6 });
  for (const row of rows) {
    if (row.height > s.room()) {
      s.newPage();
      headerRow();
    }
    drawRow(row.cells, row.height, f.regular);
  }
  s.gap(12);
  if (model.total) s.field(model.total, { minLine: 86.4 });
  s.gap(4);
  s.ensure(24);
  s.gap(10);
  s.rule();
  s.gap(15);
  const certificationLines = wrap(model.certification, f.regular, BODY, CONTENT_W).length;
  s.ensure(18 + 6 + fieldsHeight(model.verification, FIELD_STEP + 4) + 18 + certificationLines * LEADING);
  s.line(model.verificationTitle, { size: 13, color: MUTED, step: 18 });
  s.gap(6);
  for (const item of model.verification) s.field(item, { step: FIELD_STEP + 4 });
  s.gap(16);
  s.paragraph(model.certification);
  return doc.save();
}
