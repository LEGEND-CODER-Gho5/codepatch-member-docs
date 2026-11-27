import type { ExportLine, ExportModel } from "./document-model";

/**
 * The document as formatted HTML (for pasting into Google Docs) and as plain
 * text (for apps that only accept text). Every value is escaped.
 */
const escape = (text: string) =>
  (text ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const multiline = (text: string) => escape(text).replace(/\r\n?|\n/g, "<br>");
const BLANK = "________________________";

const FONT = "font-family:'IBM Plex Sans',Arial,sans-serif;color:#000000;";
const P = `${FONT}font-size:11pt;line-height:1.35;margin:0 0 4pt 0;`;
const CELL = `${FONT}font-size:10.5pt;border:1px solid #71717a;padding:4pt 6pt;vertical-align:top;`;

function fieldHtml(item: ExportLine): string {
  const value = item.value
    ? item.style === "signature"
      ? `<span style="font-family:'IBM Plex Serif',Georgia,serif;font-style:italic;">${escape(item.value)}</span>`
      : escape(item.value)
    : item.style === "plain"
      ? ""
      : BLANK;
  return `<p style="${P}"><b>${escape(item.label)}</b> ${value}</p>`;
}

const fieldText = (item: ExportLine) => `${item.label} ${item.value || (item.style === "plain" ? "" : BLANK)}`.trimEnd();

export function renderDocumentHtml(model: ExportModel): { html: string; text: string } {
  const weight = model.boldHeadings ? "700" : "400";
  const sectionColor = model.boldHeadings ? "#000000" : "#52525b";
  const html: string[] = [
    `<h1 style="${FONT}font-size:22pt;font-weight:${weight};margin:0 0 10pt 0;">${escape(model.heading)}</h1>`,
    `<h2 style="${FONT}font-size:15pt;font-weight:${weight};margin:0 0 8pt 0;">${escape(model.title)}</h2>`,
    ...model.info.map(fieldHtml),
  ];
  const text: string[] = [model.heading, model.title, "", ...model.info.map(fieldText), ""];

  if (model.kind === "contribution") {
    html.push(`<p style="${P}">&nbsp;</p>`);
    for (const entry of model.contributions) {
      html.push(`<p style="${P}margin-top:6pt;"><b>${escape(entry.date)}</b>${entry.title ? ` — ${escape(entry.title)}` : ""}</p>`);
      if (entry.details) html.push(`<p style="${P}">${multiline(entry.details)}</p>`);
      text.push(`${entry.date}${entry.title ? ` — ${entry.title}` : ""}`);
      if (entry.details) text.push(entry.details);
      text.push("");
    }
  } else if (model.hoursSection) {
    const t = model.hoursSection;
    html.push(`<h3 style="${FONT}font-size:13pt;font-weight:400;color:${sectionColor};margin:12pt 0 6pt 0;">${escape(t.title)}</h3>`);
    const rows = [...t.rows];
    while (rows.length < 10) rows.push({ date: "", description: "", hours: "" });
    html.push(
      `<table style="border-collapse:collapse;width:100%;">`,
      `<tr><th style="${CELL}width:1.3in;text-align:left;">${escape(t.columns[0])}</th><th style="${CELL}text-align:left;">${escape(t.columns[1])}</th><th style="${CELL}width:0.8in;text-align:right;">${escape(t.columns[2])}</th></tr>`,
      ...rows.map(
        (row) =>
          `<tr><td style="${CELL}">${escape(row.date) || "&nbsp;"}</td><td style="${CELL}">${multiline(row.description) || "&nbsp;"}</td><td style="${CELL}text-align:right;">${escape(row.hours) || "&nbsp;"}</td></tr>`,
      ),
      `</table>`,
    );
    text.push(t.title, `${t.columns.join("\t")}`, ...t.rows.map((row) => [row.date, row.description.replace(/\s*\n\s*/g, " "), row.hours].join("\t")), "");
    if (model.total) {
      html.push(`<p style="${P}margin-top:10pt;"><b>${escape(model.total.label)}</b> ${escape(model.total.value)}</p>`);
      text.push(fieldText(model.total), "");
    }
  }

  html.push(
    `<h3 style="${FONT}font-size:13pt;font-weight:${weight};color:${sectionColor};margin:16pt 0 6pt 0;">${escape(model.verificationTitle)}</h3>`,
    ...model.verification.map(fieldHtml),
  );
  text.push(model.verificationTitle, ...model.verification.map(fieldText), "");
  if (model.confirmation.length) {
    html.push(`<hr>`, ...model.confirmation.map(fieldHtml));
    text.push(...model.confirmation.map(fieldText), "");
  }
  html.push(`<p style="${P}margin-top:14pt;">${escape(model.certification)}</p>`);
  text.push(model.certification);

  return {
    html: `<meta charset="utf-8"><div style="${FONT}">${html.join("")}</div>`,
    text: text.join("\n"),
  };
}
