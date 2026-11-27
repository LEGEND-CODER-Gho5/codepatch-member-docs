import { PDF_TEXT } from "@/lib/document-text";
import { formatHours, formatPlainDate } from "@/lib/format";
import type { EntryKind, HeaderField, OrgInfo, WorkspaceMember } from "@/lib/types";

/**
 * A document as it appears on the printed form, with every value already
 * formatted. The PDF and Google Docs exports render only this, so both always
 * match the print layout in document-editor.tsx.
 */
export type ExportLine = {
  label: string;
  value: string;
  /** "plain": label and value without a fill-in line (Organization, Chapter). "signature": typed signature style. */
  style?: "line" | "plain" | "signature";
};

export type ExportModel = {
  kind: EntryKind;
  heading: string;
  title: string;
  /** The Member Documentation form sets its headings in bold; the Volunteer Hours Record does not. */
  boldHeadings: boolean;
  info: ExportLine[];
  contributions: { date: string; title: string; details: string }[];
  hoursSection: { title: string; columns: [string, string, string]; rows: { date: string; description: string; hours: string }[] } | null;
  total: ExportLine | null;
  verificationTitle: string;
  verification: ExportLine[];
  /** Lines below the rule after Verification (Member Documentation only). */
  confirmation: ExportLine[];
  certification: string;
  /** Used for the PDF title and file name. */
  fileTitle: string;
  author: string;
};

export type ExportRow = { values: Record<string, string> };

const isBlank = (values: Record<string, string>) => Object.values(values).every((value) => (value ?? "").trim() === "");

export function buildExportModel({
  kind,
  header,
  rows,
  member,
  org,
  totalHours,
}: {
  kind: EntryKind;
  header: Record<HeaderField, string>;
  rows: ExportRow[];
  member: Pick<WorkspaceMember, "fullName" | "positionName">;
  org: OrgInfo;
  totalHours: number;
}): ExportModel {
  const filled = rows.filter((row) => !isBlank(row.values));
  const period = header.period.trim();
  if (kind === "contribution") {
    const t = PDF_TEXT.memberDocumentation;
    return {
      kind,
      heading: PDF_TEXT.heading,
      title: t.title,
      boldHeadings: true,
      info: [
        { label: t.memberName, value: member.fullName },
        { label: t.chapter, value: org.chapterName, style: "plain" },
        { label: t.positionRole, value: member.positionName },
        { label: t.documentationPeriod, value: header.period },
      ],
      contributions: filled.map((row) => ({
        date: formatPlainDate(row.values.entry_date) || "Undated",
        title: row.values.title ?? "",
        details: row.values.details ?? "",
      })),
      hoursSection: null,
      total: null,
      verificationTitle: t.verification,
      verification: [
        { label: t.supervisorName, value: header.supervisor_name },
        { label: t.supervisorPosition, value: header.supervisor_position },
        { label: t.supervisorSignature, value: header.supervisor_signature, style: "signature" },
      ],
      confirmation: [
        { label: t.memberConfirmation, value: header.member_confirmation },
        { label: t.dateSubmitted, value: formatPlainDate(header.date_submitted) },
        { label: t.date, value: formatPlainDate(header.verification_date) },
      ],
      certification: PDF_TEXT.certification,
      fileTitle: [member.fullName, t.title, period].filter(Boolean).join(" - "),
      author: `${org.organizationName}, ${org.chapterName}`,
    };
  }
  const t = PDF_TEXT.volunteerHours;
  return {
    kind,
    heading: PDF_TEXT.heading,
    title: t.title,
    boldHeadings: false,
    info: [
      { label: t.volunteerName, value: member.fullName },
      { label: t.organization, value: org.organizationName, style: "plain" },
      { label: t.chapter, value: org.chapterName, style: "plain" },
      { label: t.positionRole, value: member.positionName },
      { label: t.servicePeriod, value: header.period },
    ],
    contributions: [],
    hoursSection: {
      title: t.sectionTitle,
      columns: [t.columnDate, t.columnDescription, t.columnHours],
      rows: filled.map((row) => ({
        date: formatPlainDate(row.values.service_date, "short"),
        description: row.values.description ?? "",
        hours: row.values.hours ?? "",
      })),
    },
    total: { label: t.total, value: formatHours(totalHours) },
    verificationTitle: t.verification,
    verification: [
      { label: t.supervisorName, value: header.supervisor_name },
      { label: t.supervisorPosition, value: header.supervisor_position },
      { label: t.supervisorSignature, value: header.supervisor_signature, style: "signature" },
      { label: t.date, value: formatPlainDate(header.verification_date) },
    ],
    confirmation: [],
    certification: PDF_TEXT.certification,
    fileTitle: [member.fullName, "Volunteer Hours Record", period].filter(Boolean).join(" - "),
    author: `${org.organizationName}, ${org.chapterName}`,
  };
}

/** A file name that is safe on Windows, macOS, and phones. */
export function exportFileName(title: string, extension: string): string {
  const base = title
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return `${base || "Document"}.${extension}`;
}
