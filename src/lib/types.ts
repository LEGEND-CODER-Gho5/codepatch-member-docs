export type DocumentType = "member_documentation" | "volunteer_hours_record";
export type ActingAs = "member" | "admin";
export type EntryKind = "contribution" | "hours";
export type MemberStatus = "active" | "inactive";
export type ActorType = "member" | "admin" | "system";

export type ActionResult<T = null> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: "unauthorized" | "not_found" | "invalid" | "conflict" };

export const HEADER_FIELDS = [
  "period",
  "supervisor_name",
  "supervisor_position",
  "supervisor_signature",
  "member_confirmation",
  "date_submitted",
  "verification_date",
] as const;
export type HeaderField = (typeof HEADER_FIELDS)[number];

/** Header/verification fields each document format actually contains (per the PDF). */
export const DOCUMENT_FIELDS: Record<DocumentType, readonly HeaderField[]> = {
  member_documentation: [
    "period",
    "supervisor_name",
    "supervisor_position",
    "supervisor_signature",
    "member_confirmation",
    "date_submitted",
    "verification_date",
  ],
  volunteer_hours_record: [
    "period",
    "supervisor_name",
    "supervisor_position",
    "supervisor_signature",
    "verification_date",
  ],
};

export const DATE_FIELDS: readonly HeaderField[] = ["date_submitted", "verification_date"];

export type OrgInfo = {
  organizationName: string;
  chapterName: string;
  adminDisplayName: string;
};

export type WorkspaceMember = {
  id: string;
  fullName: string;
  memberCode: string;
  positionName: string;
  departmentName: string;
  /** Departments besides the main one, in display order. */
  otherDepartmentNames: string[];
  status: MemberStatus;
};

export type ContributionEntry = {
  id: string;
  entryDate: string | null;
  title: string;
  details: string;
  createdAt: string;
  updatedAt: string;
};

export type HoursEntry = {
  id: string;
  serviceDate: string | null;
  description: string;
  hours: number | null;
  createdAt: string;
  updatedAt: string;
};

export type DocumentRecord = {
  id: string;
  memberId: string;
  documentType: DocumentType;
  fields: Record<HeaderField, string>;
  createdAt: string;
  updatedAt: string;
  lastEditedByType: ActorType | null;
  lastEditedByName: string | null;
  contributions: ContributionEntry[];
  hours: HoursEntry[];
};

export type DocumentSummary = {
  id: string;
  documentType: DocumentType;
  period: string;
  createdAt: string;
  updatedAt: string;
  entryCount: number;
  hoursTotal: number;
  lastEditedByType: ActorType | null;
  lastEditedByName: string | null;
};

export type AuditListItem = {
  id: number;
  occurredAt: string;
  lastOccurredAt: string;
  revisionCount: number;
  actorType: ActorType;
  actorName: string;
  memberId: string | null;
  memberName: string | null;
  departmentName: string | null;
  action: string;
  entityType: string;
  documentType: DocumentType | null;
  documentId: string | null;
  recordId: string | null;
  summary: string;
};

export type AuditDetail = AuditListItem & {
  actorId: string | null;
  departmentId: string | null;
  previousValues: unknown;
  newValues: unknown;
};

export type NotificationItem = {
  id: number;
  createdAt: string;
  updatedAt: string;
  type: string;
  auditLogId: number | null;
  memberId: string | null;
  memberName: string | null;
  departmentName: string | null;
  actorType: ActorType;
  actorName: string;
  description: string;
  link: string | null;
  readAt: string | null;
};

export type DepartmentOption = { id: string; name: string };
export type PositionOption = { id: string; name: string };
