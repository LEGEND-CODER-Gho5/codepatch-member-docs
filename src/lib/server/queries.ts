import "server-only";
import { sql, sqlOne } from "./db";
import { addDays, memberCode, startOfDayInAppTimeZone } from "@/lib/format";
import { isUuid } from "@/lib/validation";
import type {
  ActorType,
  AuditDetail,
  AuditListItem,
  ContributionEntry,
  DocumentRecord,
  DocumentSummary,
  DocumentType,
  HoursEntry,
  MemberStatus,
  NotificationItem,
  WorkspaceMember,
} from "@/lib/types";

function iso(value: unknown): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}
function isoOrNull(value: unknown): string | null {
  return value ? iso(value) : null;
}

/* ----------------------------- Other departments ---------------------------- */

export type DepartmentRef = { id: string; name: string };

/**
 * Each member's departments besides the main one (member_departments), in
 * department display order, keyed by member id. Pass a member id to load one.
 */
async function loadOtherDepartments(memberId?: string): Promise<Map<string, DepartmentRef[]>> {
  const rows = await sql<{ member_id: string; department_id: string; name: string }>(
    `SELECT md.member_id, d.id AS department_id, d.name
       FROM member_departments md
       JOIN departments d ON d.id = md.department_id
      ${memberId ? "WHERE md.member_id = $1" : ""}
      ORDER BY d.sort_order, lower(d.name)`,
    memberId ? [memberId] : [],
  );
  const byMember = new Map<string, DepartmentRef[]>();
  for (const row of rows) {
    const list = byMember.get(row.member_id) ?? [];
    list.push({ id: row.department_id, name: row.name });
    byMember.set(row.member_id, list);
  }
  return byMember;
}

/* -------------------------------- Directory ------------------------------- */

export type DirectoryMember = { id: string; fullName: string; positionName: string; memberCode: string };
export type DirectoryDepartment = { id: string; name: string; description: string; members: DirectoryMember[] };

export async function getDirectory(): Promise<{ departments: DirectoryDepartment[]; totalActive: number }> {
  const departments = await sql<{ id: string; name: string; description: string }>(
    "SELECT id, name, description FROM departments ORDER BY sort_order, lower(name)",
  );
  const members = await sql<{ id: string; full_name: string; department_id: string; position_name: string; member_number: number }>(
    `SELECT m.id, m.full_name, m.department_id, p.name AS position_name, m.member_number
       FROM members m JOIN positions p ON p.id = m.position_id
      WHERE m.status = 'active'
      ORDER BY p.sort_order, lower(m.full_name)`,
  );
  const others = await loadOtherDepartments();
  const byId = new Map<string, DirectoryDepartment>(departments.map((d) => [d.id, { ...d, members: [] }]));
  // Members are already sorted, so appending in this order keeps every column sorted,
  // including the columns of a member's other departments.
  for (const member of members) {
    const entry: DirectoryMember = {
      id: member.id,
      fullName: member.full_name,
      positionName: member.position_name,
      memberCode: memberCode(member.member_number),
    };
    byId.get(member.department_id)?.members.push(entry);
    for (const other of others.get(member.id) ?? []) {
      if (other.id !== member.department_id) byId.get(other.id)?.members.push(entry);
    }
  }
  return { departments: [...byId.values()], totalActive: members.length };
}

/* --------------------------------- Members -------------------------------- */

export type MemberRow = {
  id: string;
  memberNumber: number;
  memberCode: string;
  fullName: string;
  email: string | null;
  status: MemberStatus;
  startDate: string | null;
  createdAt: string;
  updatedAt: string;
  deactivatedAt: string | null;
  departmentId: string;
  departmentName: string;
  otherDepartments: DepartmentRef[];
  positionId: string;
  positionName: string;
  lastLoginAt: string | null;
  passwordChangedAt: string | null;
  hoursTotal: number;
  contributionCount: number;
  hoursEntryCount: number;
  lastActivityAt: string | null;
};

const MEMBER_SELECT = `
  SELECT m.id, m.member_number, m.full_name, m.email, m.status, m.start_date, m.created_at, m.updated_at, m.deactivated_at,
         m.department_id, d.name AS department_name, m.position_id, p.name AS position_name,
         c.last_login_at, c.password_changed_at,
         (SELECT coalesce(sum(h.hours), 0) FROM volunteer_hours h WHERE h.member_id = m.id) AS hours_total,
         (SELECT count(*) FROM contribution_entries e WHERE e.member_id = m.id) AS contribution_count,
         (SELECT count(*) FROM volunteer_hours h WHERE h.member_id = m.id) AS hours_entry_count,
         (SELECT max(a.last_occurred_at) FROM audit_logs a WHERE a.member_id = m.id) AS last_activity_at
    FROM members m
    JOIN departments d ON d.id = m.department_id
    JOIN positions p ON p.id = m.position_id
    LEFT JOIN member_credentials c ON c.member_id = m.id`;

type MemberDbRow = {
  id: string;
  member_number: number;
  full_name: string;
  email: string | null;
  status: MemberStatus;
  start_date: string | null;
  created_at: Date;
  updated_at: Date;
  deactivated_at: Date | null;
  department_id: string;
  department_name: string;
  position_id: string;
  position_name: string;
  last_login_at: Date | null;
  password_changed_at: Date | null;
  hours_total: number;
  contribution_count: number;
  hours_entry_count: number;
  last_activity_at: Date | null;
};

function mapMember(row: MemberDbRow, others: Map<string, DepartmentRef[]>): MemberRow {
  return {
    id: row.id,
    memberNumber: row.member_number,
    memberCode: memberCode(row.member_number),
    fullName: row.full_name,
    email: row.email,
    status: row.status,
    startDate: row.start_date,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    deactivatedAt: isoOrNull(row.deactivated_at),
    departmentId: row.department_id,
    departmentName: row.department_name,
    otherDepartments: others.get(row.id) ?? [],
    positionId: row.position_id,
    positionName: row.position_name,
    lastLoginAt: isoOrNull(row.last_login_at),
    passwordChangedAt: isoOrNull(row.password_changed_at),
    hoursTotal: Number(row.hours_total ?? 0),
    contributionCount: Number(row.contribution_count ?? 0),
    hoursEntryCount: Number(row.hours_entry_count ?? 0),
    lastActivityAt: isoOrNull(row.last_activity_at),
  };
}

export async function listMembers(): Promise<MemberRow[]> {
  const [rows, others] = await Promise.all([sql<MemberDbRow>(`${MEMBER_SELECT} ORDER BY lower(m.full_name)`), loadOtherDepartments()]);
  return rows.map((row) => mapMember(row, others));
}

export async function getMember(id: string): Promise<MemberRow | null> {
  if (!isUuid(id)) return null;
  const [row, others] = await Promise.all([sqlOne<MemberDbRow>(`${MEMBER_SELECT} WHERE m.id = $1`, [id]), loadOtherDepartments(id)]);
  return row ? mapMember(row, others) : null;
}

export async function getWorkspaceMember(id: string): Promise<WorkspaceMember | null> {
  if (!isUuid(id)) return null;
  const row = await sqlOne<{ id: string; full_name: string; member_number: number; position_name: string; department_name: string; status: MemberStatus }>(
    `SELECT m.id, m.full_name, m.member_number, p.name AS position_name, d.name AS department_name, m.status
       FROM members m
       JOIN positions p ON p.id = m.position_id
       JOIN departments d ON d.id = m.department_id
      WHERE m.id = $1`,
    [id],
  );
  if (!row) return null;
  const others = await loadOtherDepartments(id);
  return {
    id: row.id,
    fullName: row.full_name,
    memberCode: memberCode(row.member_number),
    positionName: row.position_name,
    departmentName: row.department_name,
    otherDepartmentNames: (others.get(id) ?? []).map((department) => department.name),
    status: row.status,
  };
}

/* -------------------------------- Documents ------------------------------- */

export async function listDocumentSummaries(memberId: string): Promise<DocumentSummary[]> {
  if (!isUuid(memberId)) return [];
  const rows = await sql<{
    id: string;
    document_type: DocumentType;
    period: string;
    created_at: Date;
    updated_at: Date;
    entry_count: number;
    hours_total: number;
    last_edited_by_type: ActorType | null;
    last_edited_by_name: string | null;
  }>(
    `SELECT d.id, d.document_type, d.period, d.created_at, d.updated_at, d.last_edited_by_type, d.last_edited_by_name,
            CASE WHEN d.document_type = 'member_documentation'
                 THEN (SELECT count(*) FROM contribution_entries e WHERE e.document_id = d.id)
                 ELSE (SELECT count(*) FROM volunteer_hours h WHERE h.document_id = d.id) END AS entry_count,
            (SELECT coalesce(sum(h.hours), 0) FROM volunteer_hours h WHERE h.document_id = d.id) AS hours_total
       FROM member_documentation d
      WHERE d.member_id = $1
      ORDER BY d.created_at DESC`,
    [memberId],
  );
  return rows.map((row) => ({
    id: row.id,
    documentType: row.document_type,
    period: row.period,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    entryCount: Number(row.entry_count),
    hoursTotal: Number(row.hours_total),
    lastEditedByType: row.last_edited_by_type,
    lastEditedByName: row.last_edited_by_name,
  }));
}

export async function getDocumentRecord(documentId: string): Promise<DocumentRecord | null> {
  if (!isUuid(documentId)) return null;
  const doc = await sqlOne<{
    id: string;
    member_id: string;
    document_type: DocumentType;
    period: string;
    supervisor_name: string;
    supervisor_position: string;
    supervisor_signature: string;
    member_confirmation: string;
    date_submitted: string | null;
    verification_date: string | null;
    created_at: Date;
    updated_at: Date;
    last_edited_by_type: ActorType | null;
    last_edited_by_name: string | null;
  }>("SELECT * FROM member_documentation WHERE id = $1", [documentId]);
  if (!doc) return null;

  let contributions: ContributionEntry[] = [];
  let hours: HoursEntry[] = [];
  if (doc.document_type === "member_documentation") {
    const rows = await sql<{ id: string; entry_date: string | null; title: string; details: string; created_at: Date; updated_at: Date }>(
      "SELECT id, entry_date, title, details, created_at, updated_at FROM contribution_entries WHERE document_id = $1 ORDER BY created_at, id",
      [documentId],
    );
    contributions = rows.map((row) => ({
      id: row.id,
      entryDate: row.entry_date,
      title: row.title,
      details: row.details,
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
    }));
  } else {
    const rows = await sql<{ id: string; service_date: string | null; description: string; hours: number | null; created_at: Date; updated_at: Date }>(
      "SELECT id, service_date, description, hours, created_at, updated_at FROM volunteer_hours WHERE document_id = $1 ORDER BY created_at, id",
      [documentId],
    );
    hours = rows.map((row) => ({
      id: row.id,
      serviceDate: row.service_date,
      description: row.description,
      hours: row.hours === null ? null : Number(row.hours),
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
    }));
  }

  return {
    id: doc.id,
    memberId: doc.member_id,
    documentType: doc.document_type,
    fields: {
      period: doc.period,
      supervisor_name: doc.supervisor_name,
      supervisor_position: doc.supervisor_position,
      supervisor_signature: doc.supervisor_signature,
      member_confirmation: doc.member_confirmation,
      date_submitted: doc.date_submitted ?? "",
      verification_date: doc.verification_date ?? "",
    },
    createdAt: iso(doc.created_at),
    updatedAt: iso(doc.updated_at),
    lastEditedByType: doc.last_edited_by_type,
    lastEditedByName: doc.last_edited_by_name,
    contributions,
    hours,
  };
}

/* ------------------------- Departments and positions ----------------------- */

export type DepartmentRow = {
  id: string;
  name: string;
  description: string;
  sortOrder: number;
  activeMembers: number;
  totalMembers: number;
  hoursTotal: number;
  createdAt: string;
};

export async function listDepartments(): Promise<DepartmentRow[]> {
  const rows = await sql<{
    id: string;
    name: string;
    description: string;
    sort_order: number;
    active_members: number;
    total_members: number;
    hours_total: number;
    created_at: Date;
  }>(
    // Member counts include members for whom this is one of their other departments.
    // Volunteer hours count each member's main department only, so no hour is counted twice.
    `SELECT d.id, d.name, d.description, d.sort_order, d.created_at,
            count(m.id) FILTER (WHERE m.status = 'active') AS active_members,
            count(m.id) AS total_members,
            (SELECT coalesce(sum(h.hours), 0) FROM volunteer_hours h JOIN members hm ON hm.id = h.member_id
              WHERE hm.department_id = d.id) AS hours_total
       FROM departments d
       LEFT JOIN members m
         ON m.department_id = d.id
         OR EXISTS (SELECT 1 FROM member_departments md WHERE md.member_id = m.id AND md.department_id = d.id)
      GROUP BY d.id
      ORDER BY d.sort_order, lower(d.name)`,
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    sortOrder: row.sort_order,
    activeMembers: Number(row.active_members),
    totalMembers: Number(row.total_members),
    hoursTotal: Number(row.hours_total),
    createdAt: iso(row.created_at),
  }));
}

export type PositionRow = { id: string; name: string; sortOrder: number; memberCount: number };

export async function listPositions(): Promise<PositionRow[]> {
  const rows = await sql<{ id: string; name: string; sort_order: number; member_count: number }>(
    `SELECT p.id, p.name, p.sort_order, count(m.id) AS member_count
       FROM positions p LEFT JOIN members m ON m.position_id = p.id
      GROUP BY p.id
      ORDER BY p.sort_order, lower(p.name)`,
  );
  return rows.map((row) => ({ id: row.id, name: row.name, sortOrder: row.sort_order, memberCount: Number(row.member_count) }));
}

/* ---------------------------------- Stats --------------------------------- */

export type OverviewStats = {
  activeMembers: number;
  inactiveMembers: number;
  departments: number;
  contributionEntries: number;
  hoursEntries: number;
  documentRecords: number;
  totalHours: number;
  unreadNotifications: number;
};

export async function getOverviewStats(): Promise<OverviewStats> {
  const row = await sqlOne<Record<string, number>>(
    `SELECT
       (SELECT count(*) FROM members WHERE status = 'active') AS active_members,
       (SELECT count(*) FROM members WHERE status = 'inactive') AS inactive_members,
       (SELECT count(*) FROM departments) AS departments,
       (SELECT count(*) FROM contribution_entries) AS contribution_entries,
       (SELECT count(*) FROM volunteer_hours) AS hours_entries,
       (SELECT count(*) FROM member_documentation) AS document_records,
       (SELECT coalesce(sum(hours), 0) FROM volunteer_hours) AS total_hours,
       (SELECT count(*) FROM notifications WHERE read_at IS NULL) AS unread_notifications`,
  );
  return {
    activeMembers: Number(row?.active_members ?? 0),
    inactiveMembers: Number(row?.inactive_members ?? 0),
    departments: Number(row?.departments ?? 0),
    contributionEntries: Number(row?.contribution_entries ?? 0),
    hoursEntries: Number(row?.hours_entries ?? 0),
    documentRecords: Number(row?.document_records ?? 0),
    totalHours: Number(row?.total_hours ?? 0),
    unreadNotifications: Number(row?.unread_notifications ?? 0),
  };
}

/* ---------------------------------- Audit --------------------------------- */

type AuditDbRow = {
  id: number;
  occurred_at: Date;
  last_occurred_at: Date;
  revision_count: number;
  actor_type: ActorType;
  actor_id: string | null;
  actor_name: string;
  member_id: string | null;
  member_name: string | null;
  department_id: string | null;
  department_name: string | null;
  action: string;
  entity_type: string;
  document_type: DocumentType | null;
  document_id: string | null;
  record_id: string | null;
  summary: string;
  previous_values?: unknown;
  new_values?: unknown;
};

const AUDIT_COLUMNS = `id, occurred_at, last_occurred_at, revision_count, actor_type, actor_id, actor_name, member_id,
  member_name, department_id, department_name, action, entity_type, document_type, document_id, record_id, summary`;

function mapAudit(row: AuditDbRow): AuditListItem {
  return {
    id: Number(row.id),
    occurredAt: iso(row.occurred_at),
    lastOccurredAt: iso(row.last_occurred_at),
    revisionCount: Number(row.revision_count),
    actorType: row.actor_type,
    actorName: row.actor_name,
    memberId: row.member_id,
    memberName: row.member_name,
    departmentName: row.department_name,
    action: row.action,
    entityType: row.entity_type,
    documentType: row.document_type,
    documentId: row.document_id,
    recordId: row.record_id,
    summary: row.summary,
  };
}

export async function listRecentActivity(
  limit: number,
  options: { actorType?: ActorType; memberId?: string; documentId?: string } = {},
): Promise<AuditListItem[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (options.actorType) {
    params.push(options.actorType);
    where.push(`actor_type = $${params.length}`);
  }
  if (options.memberId && isUuid(options.memberId)) {
    params.push(options.memberId);
    where.push(`member_id = $${params.length}::uuid`);
  }
  if (options.documentId && isUuid(options.documentId)) {
    params.push(options.documentId);
    where.push(`document_id = $${params.length}::uuid`);
  }
  params.push(Math.min(Math.max(limit, 1), 200));
  const rows = await sql<AuditDbRow>(
    `SELECT ${AUDIT_COLUMNS} FROM audit_logs ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY last_occurred_at DESC, id DESC LIMIT $${params.length}`,
    params,
  );
  return rows.map(mapAudit);
}

export type AuditFilters = {
  q?: string;
  department?: string;
  action?: string;
  document?: string;
  actor?: string;
  from?: string;
  to?: string;
  sort?: string;
  page?: number;
};

export const AUDIT_PAGE_SIZE = 50;

export async function queryAuditLogs(filters: AuditFilters) {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (clause: (placeholder: string) => string, value: unknown) => {
    params.push(value);
    where.push(clause(`$${params.length}`));
  };

  const q = filters.q?.trim().slice(0, 100);
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    add((p) => `(member_name ILIKE ${p} OR actor_name ILIKE ${p} OR summary ILIKE ${p})`, like);
  }
  if (filters.department && isUuid(filters.department)) add((p) => `department_id = ${p}::uuid`, filters.department);
  if (filters.action && /^[a-z_]{2,32}$/.test(filters.action)) add((p) => `action = ${p}`, filters.action);
  if (filters.actor === "member" || filters.actor === "admin" || filters.actor === "system") {
    add((p) => `actor_type = ${p}`, filters.actor);
  }
  if (filters.document === "member_documentation" || filters.document === "volunteer_hours_record") {
    add((p) => `document_type = ${p}`, filters.document);
  } else if (filters.document === "member_account") {
    where.push(`entity_type = 'member'`);
  } else if (filters.document === "administration") {
    where.push(`entity_type IN ('settings', 'department', 'position', 'security', 'attendance')`);
  }
  const from = filters.from ? startOfDayInAppTimeZone(filters.from) : null;
  if (from) add((p) => `last_occurred_at >= ${p}::timestamptz`, from.toISOString());
  const to = filters.to ? startOfDayInAppTimeZone(addDays(filters.to, 1)) : null;
  if (to) add((p) => `last_occurred_at < ${p}::timestamptz`, to.toISOString());

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const direction = filters.sort === "oldest" ? "ASC" : "DESC";
  const page = Math.max(1, Math.floor(filters.page ?? 1));
  const totalRow = await sqlOne<{ total: number }>(`SELECT count(*) AS total FROM audit_logs ${whereSql}`, params);
  const rows = await sql<AuditDbRow>(
    `SELECT ${AUDIT_COLUMNS} FROM audit_logs ${whereSql}
      ORDER BY last_occurred_at ${direction}, id ${direction}
      LIMIT ${AUDIT_PAGE_SIZE} OFFSET ${(page - 1) * AUDIT_PAGE_SIZE}`,
    params,
  );
  return { items: rows.map(mapAudit), total: Number(totalRow?.total ?? 0), page, pageSize: AUDIT_PAGE_SIZE };
}

export async function getAuditDetail(id: number): Promise<AuditDetail | null> {
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const row = await sqlOne<AuditDbRow>(`SELECT ${AUDIT_COLUMNS}, previous_values, new_values FROM audit_logs WHERE id = $1`, [id]);
  if (!row) return null;
  return {
    ...mapAudit(row),
    actorId: row.actor_id,
    departmentId: row.department_id,
    previousValues: row.previous_values ?? null,
    newValues: row.new_values ?? null,
  };
}

/* ------------------------------- Notifications ----------------------------- */

type NotificationDbRow = {
  id: number;
  created_at: Date;
  updated_at: Date;
  type: string;
  audit_log_id: number | null;
  member_id: string | null;
  member_name: string | null;
  department_name: string | null;
  actor_type: ActorType;
  actor_name: string;
  description: string;
  link: string | null;
  read_at: Date | null;
};

function mapNotification(row: NotificationDbRow): NotificationItem {
  return {
    id: Number(row.id),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    type: row.type,
    auditLogId: row.audit_log_id === null ? null : Number(row.audit_log_id),
    memberId: row.member_id,
    memberName: row.member_name,
    departmentName: row.department_name,
    actorType: row.actor_type,
    actorName: row.actor_name,
    description: row.description,
    link: row.link,
    readAt: isoOrNull(row.read_at),
  };
}

export async function listNotifications(options: { unreadOnly?: boolean; limit?: number; offset?: number } = {}) {
  const where = options.unreadOnly ? "WHERE read_at IS NULL" : "";
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const offset = Math.max(options.offset ?? 0, 0);
  const rows = await sql<NotificationDbRow>(
    `SELECT id, created_at, updated_at, type, audit_log_id, member_id, member_name, department_name, actor_type, actor_name,
            description, link, read_at
       FROM notifications ${where}
      ORDER BY updated_at DESC, id DESC
      LIMIT ${limit} OFFSET ${offset}`,
  );
  const totals = await sqlOne<{ total: number; unread: number }>(
    "SELECT count(*) AS total, count(*) FILTER (WHERE read_at IS NULL) AS unread FROM notifications",
  );
  return {
    items: rows.map(mapNotification),
    total: Number(totals?.total ?? 0),
    unread: Number(totals?.unread ?? 0),
  };
}

/* --------------------------- Documentation overview ------------------------ */

export type DocumentationOverviewRow = {
  memberId: string;
  memberCode: string;
  fullName: string;
  status: MemberStatus;
  departmentId: string;
  departmentName: string;
  otherDepartments: DepartmentRef[];
  positionName: string;
  documentationRecords: number;
  hoursRecords: number;
  contributionCount: number;
  hoursEntryCount: number;
  hoursTotal: number;
  documentationUpdatedAt: string | null;
  hoursUpdatedAt: string | null;
};

export async function getDocumentationOverview(): Promise<DocumentationOverviewRow[]> {
  const others = await loadOtherDepartments();
  const rows = await sql<{
    id: string;
    member_number: number;
    full_name: string;
    status: MemberStatus;
    department_id: string;
    department_name: string;
    position_name: string;
    md_records: number;
    vh_records: number;
    md_updated: Date | null;
    vh_updated: Date | null;
    contribution_count: number;
    hours_entry_count: number;
    hours_total: number;
  }>(
    `SELECT m.id, m.member_number, m.full_name, m.status, m.department_id, d.name AS department_name, p.name AS position_name,
            count(md.id) FILTER (WHERE md.document_type = 'member_documentation') AS md_records,
            count(md.id) FILTER (WHERE md.document_type = 'volunteer_hours_record') AS vh_records,
            max(md.updated_at) FILTER (WHERE md.document_type = 'member_documentation') AS md_updated,
            max(md.updated_at) FILTER (WHERE md.document_type = 'volunteer_hours_record') AS vh_updated,
            (SELECT count(*) FROM contribution_entries e WHERE e.member_id = m.id) AS contribution_count,
            (SELECT count(*) FROM volunteer_hours h WHERE h.member_id = m.id) AS hours_entry_count,
            (SELECT coalesce(sum(h.hours), 0) FROM volunteer_hours h WHERE h.member_id = m.id) AS hours_total
       FROM members m
       JOIN departments d ON d.id = m.department_id
       JOIN positions p ON p.id = m.position_id
       LEFT JOIN member_documentation md ON md.member_id = m.id
      GROUP BY m.id, d.id, p.id
      ORDER BY d.sort_order, lower(d.name), lower(m.full_name)`,
  );
  return rows.map((row) => ({
    memberId: row.id,
    memberCode: memberCode(row.member_number),
    fullName: row.full_name,
    status: row.status,
    departmentId: row.department_id,
    departmentName: row.department_name,
    otherDepartments: others.get(row.id) ?? [],
    positionName: row.position_name,
    documentationRecords: Number(row.md_records),
    hoursRecords: Number(row.vh_records),
    contributionCount: Number(row.contribution_count),
    hoursEntryCount: Number(row.hours_entry_count),
    hoursTotal: Number(row.hours_total),
    documentationUpdatedAt: isoOrNull(row.md_updated),
    hoursUpdatedAt: isoOrNull(row.vh_updated),
  }));
}

export type EntryFeedItem = {
  kind: "contribution" | "hours";
  id: string;
  documentId: string;
  memberId: string;
  memberName: string;
  departmentName: string;
  date: string | null;
  title: string;
  body: string;
  hours: number | null;
  period: string;
  updatedAt: string;
};

export async function listAllEntries(filters: { kind?: string; member?: string; department?: string; q?: string }) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filters.kind === "contribution" || filters.kind === "hours") {
    params.push(filters.kind);
    where.push(`kind = $${params.length}`);
  }
  if (filters.member && isUuid(filters.member)) {
    params.push(filters.member);
    where.push(`member_id = $${params.length}::uuid`);
  }
  if (filters.department && isUuid(filters.department)) {
    params.push(filters.department);
    const p = `$${params.length}::uuid`;
    // A member's main department or any of their other departments.
    where.push(
      `(department_id = ${p} OR EXISTS (SELECT 1 FROM member_departments md WHERE md.member_id = entries.member_id AND md.department_id = ${p}))`,
    );
  }
  const q = filters.q?.trim().slice(0, 100);
  if (q) {
    params.push(`%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    where.push(`(member_name ILIKE $${params.length} OR title ILIKE $${params.length} OR body ILIKE $${params.length})`);
  }
  const rows = await sql<{
    kind: "contribution" | "hours";
    id: string;
    document_id: string;
    member_id: string;
    member_name: string;
    department_name: string;
    entry_date: string | null;
    title: string;
    body: string;
    hours: number | null;
    period: string;
    updated_at: Date;
  }>(
    `SELECT * FROM (
        SELECT 'contribution' AS kind, e.id, e.document_id, e.member_id, m.full_name AS member_name, m.department_id,
               d.name AS department_name, e.entry_date, e.title, e.details AS body, NULL::numeric AS hours, md.period, e.updated_at
          FROM contribution_entries e
          JOIN members m ON m.id = e.member_id
          JOIN departments d ON d.id = m.department_id
          JOIN member_documentation md ON md.id = e.document_id
        UNION ALL
        SELECT 'hours' AS kind, h.id, h.document_id, h.member_id, m.full_name, m.department_id,
               d.name, h.service_date, '' AS title, h.description, h.hours, md.period, h.updated_at
          FROM volunteer_hours h
          JOIN members m ON m.id = h.member_id
          JOIN departments d ON d.id = m.department_id
          JOIN member_documentation md ON md.id = h.document_id
      ) entries
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY entry_date DESC NULLS LAST, updated_at DESC
      LIMIT 300`,
    params,
  );
  return rows.map(
    (row): EntryFeedItem => ({
      kind: row.kind,
      id: row.id,
      documentId: row.document_id,
      memberId: row.member_id,
      memberName: row.member_name,
      departmentName: row.department_name,
      date: row.entry_date,
      title: row.title,
      body: row.body,
      hours: row.hours === null ? null : Number(row.hours),
      period: row.period,
      updatedAt: iso(row.updated_at),
    }),
  );
}

/* -------------------------------- Attendance ------------------------------- */

export type MeetingAttendee = {
  memberId: string;
  fullName: string;
  departmentName: string;
  /** Hours credited: the meeting's hours minus any hours subtracted. */
  hours: number;
  /** False when the entry it added was later deleted from the member's record. */
  inRecord: boolean;
};

export type MeetingRow = {
  id: string;
  name: string;
  date: string;
  hours: number;
  recordedBy: string;
  createdAt: string;
  attendees: MeetingAttendee[];
};

export async function listMeetings(limit = 40): Promise<MeetingRow[]> {
  const meetings = await sql<{ id: string; name: string; meeting_date: string; hours: number; recorded_by_name: string; created_at: Date }>(
    `SELECT id, name, meeting_date::text AS meeting_date, hours, recorded_by_name, created_at
       FROM meetings ORDER BY meeting_date DESC, created_at DESC LIMIT $1`,
    [Math.min(Math.max(limit, 1), 200)],
  );
  if (meetings.length === 0) return [];
  const rows = await sql<{ meeting_id: string; member_id: string; full_name: string; department_name: string; hours: number; volunteer_hours_id: string | null }>(
    `SELECT a.meeting_id, a.member_id, m.full_name, d.name AS department_name, a.hours, a.volunteer_hours_id
       FROM meeting_attendance a
       JOIN members m ON m.id = a.member_id
       JOIN departments d ON d.id = m.department_id
      WHERE a.meeting_id IN (SELECT id FROM meetings ORDER BY meeting_date DESC, created_at DESC LIMIT $1)
      ORDER BY lower(m.full_name)`,
    [Math.min(Math.max(limit, 1), 200)],
  );
  const byMeeting = new Map<string, MeetingAttendee[]>();
  for (const row of rows) {
    const list = byMeeting.get(row.meeting_id) ?? [];
    list.push({
      memberId: row.member_id,
      fullName: row.full_name,
      departmentName: row.department_name,
      hours: Number(row.hours),
      inRecord: row.volunteer_hours_id !== null || Number(row.hours) === 0,
    });
    byMeeting.set(row.meeting_id, list);
  }
  return meetings.map((meeting) => ({
    id: meeting.id,
    name: meeting.name,
    date: meeting.meeting_date,
    hours: Number(meeting.hours),
    recordedBy: meeting.recorded_by_name,
    createdAt: iso(meeting.created_at),
    attendees: byMeeting.get(meeting.id) ?? [],
  }));
}
