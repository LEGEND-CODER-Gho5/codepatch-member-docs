import type { AuditListItem, DocumentType } from "./types";

export const ACTION_LABELS: Record<string, string> = {
  created: "Created",
  edited: "Edited",
  deleted: "Deleted",
  deactivated: "Deactivated",
  reactivated: "Reactivated",
  password_reset: "Password changed",
  restored: "Restored",
  initialized: "Initialized",
  locked_out: "Sign-in locked",
};

export const ACTION_FILTER_OPTIONS = [
  { value: "created", label: "Created / added" },
  { value: "edited", label: "Edited" },
  { value: "deleted", label: "Deleted" },
  { value: "restored", label: "Restored" },
  { value: "deactivated", label: "Deactivated" },
  { value: "reactivated", label: "Reactivated" },
  { value: "password_reset", label: "Password changes" },
  { value: "locked_out", label: "Sign-in lockouts" },
];

export const DOCUMENT_FILTER_OPTIONS = [
  { value: "member_documentation", label: "Member Documentation" },
  { value: "volunteer_hours_record", label: "Volunteer Hours Record" },
  { value: "member_account", label: "Member accounts" },
  { value: "administration", label: "Administration & settings" },
];

export const ENTITY_LABELS: Record<string, string> = {
  document: "Document",
  contribution_entry: "Contribution entry",
  volunteer_hours_entry: "Volunteer-hours entry",
  member: "Member account",
  department: "Department",
  position: "Position",
  settings: "Settings",
  security: "Security",
};

const DOCUMENT_LABELS: Record<DocumentType, string> = {
  member_documentation: "Member Documentation",
  volunteer_hours_record: "Volunteer Hours Record",
};

export function documentLabel(item: Pick<AuditListItem, "documentType" | "entityType">): string {
  if (item.documentType) return DOCUMENT_LABELS[item.documentType];
  return ENTITY_LABELS[item.entityType] ?? item.entityType;
}

export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action.replace(/_/g, " ");
}

export function isRestorable(item: Pick<AuditListItem, "entityType" | "action">): boolean {
  const restorableEntity = ["document", "contribution_entry", "volunteer_hours_entry"].includes(item.entityType);
  return restorableEntity && (item.action === "edited" || item.action === "deleted");
}
