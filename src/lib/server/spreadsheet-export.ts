import "server-only";
import { DOCUMENT_TYPE_LABEL } from "@/lib/document-text";
import { memberCode } from "@/lib/format";
import type { DocumentType } from "@/lib/types";
import { sql } from "./db";
import { listDepartments, listMembers } from "./queries";
import { buildWorkbook, type CellValue, type SheetSpec } from "./xlsx";

/**
 * The administrator's spreadsheet export (Admin → Backups): everything people
 * read or report on — members, records, hours, contributions, meetings, and
 * attendance — one tab each. It never contains passwords or password hashes.
 */
export async function buildSpreadsheetExport(): Promise<Buffer> {
  const [members, departments, records, hours, contributions, meetings, attendance] = await Promise.all([
    listMembers(),
    listDepartments(),
    sql<{
      member_number: number;
      full_name: string;
      document_type: DocumentType;
      period: string;
      supervisor_name: string;
      supervisor_position: string;
      supervisor_signature: string;
      member_confirmation: string;
      date_submitted: string | null;
      verification_date: string | null;
      hours_total: number | null;
      entry_count: number;
      last_edited_by_name: string | null;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT m.member_number, m.full_name, doc.document_type, doc.period, doc.supervisor_name, doc.supervisor_position,
              doc.supervisor_signature, doc.member_confirmation, doc.date_submitted, doc.verification_date,
              doc.last_edited_by_name, doc.created_at, doc.updated_at,
              CASE WHEN doc.document_type = 'volunteer_hours_record'
                   THEN (SELECT coalesce(sum(h.hours), 0) FROM volunteer_hours h WHERE h.document_id = doc.id) END AS hours_total,
              CASE WHEN doc.document_type = 'volunteer_hours_record'
                   THEN (SELECT count(*) FROM volunteer_hours h WHERE h.document_id = doc.id)
                   ELSE (SELECT count(*) FROM contribution_entries e WHERE e.document_id = doc.id) END AS entry_count
         FROM member_documentation doc
         JOIN members m ON m.id = doc.member_id
        ORDER BY lower(m.full_name), doc.document_type, doc.created_at`,
    ),
    sql<{
      member_number: number;
      full_name: string;
      department_name: string;
      period: string;
      service_date: string | null;
      description: string;
      hours: number | null;
      meeting_name: string | null;
      updated_at: Date;
    }>(
      `SELECT m.member_number, m.full_name, d.name AS department_name, doc.period, h.service_date, h.description, h.hours,
              (SELECT mt.name FROM meeting_attendance ma JOIN meetings mt ON mt.id = ma.meeting_id
                WHERE ma.volunteer_hours_id = h.id LIMIT 1) AS meeting_name,
              h.updated_at
         FROM volunteer_hours h
         JOIN members m ON m.id = h.member_id
         JOIN departments d ON d.id = m.department_id
         JOIN member_documentation doc ON doc.id = h.document_id
        ORDER BY lower(m.full_name), h.service_date NULLS LAST, h.created_at`,
    ),
    sql<{
      member_number: number;
      full_name: string;
      department_name: string;
      period: string;
      entry_date: string | null;
      title: string;
      details: string;
      updated_at: Date;
    }>(
      `SELECT m.member_number, m.full_name, d.name AS department_name, doc.period, e.entry_date, e.title, e.details, e.updated_at
         FROM contribution_entries e
         JOIN members m ON m.id = e.member_id
         JOIN departments d ON d.id = m.department_id
         JOIN member_documentation doc ON doc.id = e.document_id
        ORDER BY lower(m.full_name), e.entry_date NULLS LAST, e.created_at`,
    ),
    sql<{
      name: string;
      meeting_date: string;
      status: "in_progress" | "ended";
      started_at: Date | null;
      ended_at: Date | null;
      hours: number | null;
      present: number;
      hours_credited: number;
      recorded_by_name: string;
    }>(
      `SELECT mt.name, mt.meeting_date, mt.status, mt.started_at, mt.ended_at, mt.hours, mt.recorded_by_name,
              (SELECT count(*) FROM meeting_attendance ma WHERE ma.meeting_id = mt.id) AS present,
              (SELECT coalesce(sum(ma.hours), 0) FROM meeting_attendance ma WHERE ma.meeting_id = mt.id) AS hours_credited
         FROM meetings mt
        ORDER BY mt.meeting_date DESC, mt.created_at DESC`,
    ),
    sql<{
      name: string;
      meeting_date: string;
      member_number: number;
      full_name: string;
      checked_in_at: Date | null;
      left_at: Date | null;
      hours: number | null;
    }>(
      `SELECT mt.name, mt.meeting_date, m.member_number, m.full_name, ma.checked_in_at, ma.left_at, ma.hours
         FROM meeting_attendance ma
         JOIN meetings mt ON mt.id = ma.meeting_id
         JOIN members m ON m.id = ma.member_id
        ORDER BY mt.meeting_date DESC, mt.created_at DESC, lower(m.full_name)`,
    ),
  ]);

  const num = (value: number | null | undefined): CellValue => (value === null || value === undefined ? null : Number(value));
  const date = (value: string | null): CellValue => ({ date: value });
  const time = (value: Date | string | null): CellValue => ({ time: value });

  const sheets: SheetSpec[] = [
    {
      name: "Members",
      columns: [
        { header: "Member ID", width: 12 },
        { header: "Name", width: 28 },
        { header: "Main department", width: 24 },
        { header: "Other departments", width: 28 },
        { header: "Position", width: 20 },
        { header: "Email", width: 30 },
        { header: "Status", width: 10 },
        { header: "Start date", width: 12 },
        { header: "Total volunteer hours", width: 12 },
        { header: "Hours entries", width: 10 },
        { header: "Contribution entries", width: 12 },
        { header: "Last sign-in", width: 22 },
        { header: "Added", width: 22 },
      ],
      rows: members.map((member) => [
        member.memberCode,
        member.fullName,
        member.departmentName,
        member.otherDepartments.map((department) => department.name).join(", "),
        member.positionName,
        member.email,
        member.status === "active" ? "Active" : "Inactive",
        date(member.startDate),
        member.hoursTotal,
        member.hoursEntryCount,
        member.contributionCount,
        time(member.lastLoginAt),
        time(member.createdAt),
      ]),
    },
    {
      name: "Volunteer hours",
      columns: [
        { header: "Member ID", width: 12 },
        { header: "Member", width: 28 },
        { header: "Main department", width: 24 },
        { header: "Record period", width: 22 },
        { header: "Date", width: 12 },
        { header: "Description", width: 44 },
        { header: "Hours", width: 8 },
        { header: "From meeting", width: 26 },
        { header: "Last changed", width: 22 },
      ],
      rows: hours.map((row) => [
        memberCode(row.member_number),
        row.full_name,
        row.department_name,
        row.period,
        date(row.service_date),
        row.description,
        num(row.hours),
        row.meeting_name,
        time(row.updated_at),
      ]),
    },
    {
      name: "Contributions",
      columns: [
        { header: "Member ID", width: 12 },
        { header: "Member", width: 28 },
        { header: "Main department", width: 24 },
        { header: "Record period", width: 22 },
        { header: "Date", width: 12 },
        { header: "Title", width: 30 },
        { header: "Details", width: 60 },
        { header: "Last changed", width: 22 },
      ],
      rows: contributions.map((row) => [
        memberCode(row.member_number),
        row.full_name,
        row.department_name,
        row.period,
        date(row.entry_date),
        row.title,
        row.details,
        time(row.updated_at),
      ]),
    },
    {
      name: "Records",
      columns: [
        { header: "Member ID", width: 12 },
        { header: "Member", width: 28 },
        { header: "Document", width: 24 },
        { header: "Period", width: 22 },
        { header: "Supervisor name", width: 22 },
        { header: "Supervisor position", width: 20 },
        { header: "Supervisor signature", width: 22 },
        { header: "Member confirmation", width: 22 },
        { header: "Date submitted", width: 12 },
        { header: "Verification date", width: 12 },
        { header: "Total hours", width: 10 },
        { header: "Entries", width: 8 },
        { header: "Last edited by", width: 22 },
        { header: "Last changed", width: 22 },
      ],
      rows: records.map((row) => [
        memberCode(row.member_number),
        row.full_name,
        DOCUMENT_TYPE_LABEL[row.document_type] ?? row.document_type,
        row.period,
        row.supervisor_name,
        row.supervisor_position,
        row.supervisor_signature,
        row.member_confirmation,
        date(row.date_submitted),
        date(row.verification_date),
        num(row.hours_total),
        num(row.entry_count),
        row.last_edited_by_name,
        time(row.updated_at),
      ]),
    },
    {
      name: "Meetings",
      columns: [
        { header: "Meeting", width: 30 },
        { header: "Date", width: 12 },
        { header: "Status", width: 12 },
        { header: "Started", width: 22 },
        { header: "Ended", width: 22 },
        { header: "Meeting hours", width: 10 },
        { header: "Members present", width: 10 },
        { header: "Hours credited", width: 10 },
        { header: "Recorded by", width: 22 },
      ],
      rows: meetings.map((row) => [
        row.name,
        date(row.meeting_date),
        row.status === "in_progress" ? "In progress" : "Ended",
        time(row.started_at),
        time(row.ended_at),
        num(row.hours),
        num(row.present),
        num(row.hours_credited),
        row.recorded_by_name,
      ]),
    },
    {
      name: "Attendance",
      columns: [
        { header: "Meeting", width: 30 },
        { header: "Meeting date", width: 12 },
        { header: "Member ID", width: 12 },
        { header: "Member", width: 28 },
        { header: "Checked in", width: 22 },
        { header: "Left", width: 22 },
        { header: "Hours credited", width: 10 },
      ],
      rows: attendance.map((row) => [
        row.name,
        date(row.meeting_date),
        memberCode(row.member_number),
        row.full_name,
        time(row.checked_in_at),
        time(row.left_at),
        num(row.hours),
      ]),
    },
    {
      name: "Departments",
      columns: [
        { header: "Department", width: 28 },
        { header: "Description", width: 40 },
        { header: "Active members", width: 10 },
        { header: "All members", width: 10 },
        { header: "Volunteer hours (main department)", width: 14 },
      ],
      rows: departments.map((row) => [row.name, row.description, row.activeMembers, row.totalMembers, row.hoursTotal]),
    },
  ];
  return buildWorkbook(sheets);
}
