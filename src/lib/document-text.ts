import type { DocumentType } from "./types";

/**
 * Wording reproduced verbatim from "CODE PATCH STEM- Member Documentation.pdf".
 * The PDF is the source of truth — do not edit these strings.
 */
export const PDF_TEXT = {
  heading: "CODE PATCH STEM",
  certification:
    "I certify that the volunteer activities and hours listed above accurately represent the member's contributions to Code Patch STEM, subject to supervisor verification.",
  memberDocumentation: {
    title: "Member Documentation",
    memberName: "Member Name:",
    chapter: "Chapter:",
    positionRole: "Position/Role:",
    documentationPeriod: "Documentation Period:",
    verification: "Verification",
    supervisorName: "Supervisor Name:",
    supervisorPosition: "Supervisor Position:",
    supervisorSignature: "Supervisor Signature:",
    memberConfirmation: "Member Confirmation:",
    dateSubmitted: "Date Submitted:",
    date: "Date:",
  },
  volunteerHours: {
    title: "Member — Volunteer Hours Record",
    volunteerName: "Volunteer Name:",
    organization: "Organization:",
    chapter: "Chapter:",
    positionRole: "Position/Role:",
    servicePeriod: "Volunteer Service Period:",
    sectionTitle: "Volunteer Hours",
    columnDate: "Date",
    columnDescription: "Description of Volunteer Work",
    columnHours: "Hours",
    total: "Total Volunteer Hours:",
    verification: "Verification",
    supervisorName: "Supervisor Name:",
    supervisorPosition: "Supervisor Position:",
    supervisorSignature: "Supervisor Signature:",
    date: "Date:",
  },
} as const;

/** Default organization values exactly as printed in the PDF. */
export const DEFAULT_ORGANIZATION_NAME = "Code Patch STEM";
export const DEFAULT_CHAPTER_NAME = "South Brunswick High School (SBHS)";

/**
 * The PDF's temporary editing instruction, used only as on-screen guidance in the
 * editor (never stored or printed as document content). The trailing
 * "Please delete this line" directive is intentionally dropped because the
 * guidance disappears on its own.
 */
export const CONTRIBUTION_GUIDANCE =
  "Please jot down how you contributed here, and please remember to put the date of when you did it.";

export const DOCUMENT_TYPE_LABEL: Record<DocumentType, string> = {
  member_documentation: "Member Documentation",
  volunteer_hours_record: "Volunteer Hours Record",
};

export const DOCUMENT_TITLE: Record<DocumentType, string> = {
  member_documentation: PDF_TEXT.memberDocumentation.title,
  volunteer_hours_record: PDF_TEXT.volunteerHours.title,
};

export const PERIOD_LABEL: Record<DocumentType, string> = {
  member_documentation: "Documentation Period",
  volunteer_hours_record: "Volunteer Service Period",
};

/** Human-readable labels for values stored in audit snapshots. */
export const FIELD_LABELS: Record<string, string> = {
  period: "Period",
  supervisor_name: "Supervisor Name",
  supervisor_position: "Supervisor Position",
  supervisor_signature: "Supervisor Signature",
  member_confirmation: "Member Confirmation",
  date_submitted: "Date Submitted",
  verification_date: "Date",
  entry_date: "Date",
  title: "Contribution",
  details: "Details",
  service_date: "Date",
  description: "Description of Volunteer Work",
  hours: "Hours",
  full_name: "Full Name",
  member_code: "Member ID",
  department: "Department",
  position: "Position/Role",
  email: "Email Address",
  status: "Member Status",
  start_date: "Start Date",
  name: "Name",
  sort_order: "Display Order",
  organization_name: "Organization",
  chapter_name: "Chapter",
  admin_display_name: "Administrator Display Name",
  default_documentation_period: "Default Documentation Period",
  site_session_hours: "Directory Session Length (hours)",
  member_idle_minutes: "Member Idle Timeout (minutes)",
  admin_idle_minutes: "Administrator Idle Timeout (minutes)",
  document_type: "Document",
  contribution_entries: "Contribution Entries",
  volunteer_hours: "Volunteer Hours Entries",
  documents: "Documentation Records",
};
