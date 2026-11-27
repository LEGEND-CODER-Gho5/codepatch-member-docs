"use server";

import { withTransaction, type Queryable } from "@/lib/server/db";
import { getAdminActor } from "@/lib/server/auth";
import { loadMemberRef, recordAudit, type Actor } from "@/lib/server/audit";
import { getSettings } from "@/lib/server/settings";
import { cleanDate, cleanLine, isUuid } from "@/lib/validation";
import type { ActionResult } from "@/lib/types";
import { ActionError, fail, handleActionError, UNAUTHORIZED } from "./shared";

/**
 * Attendance: recording a meeting adds one volunteer-hours entry per present
 * member (the meeting's hours minus any hours subtracted for that member).
 * Entries are ordinary rows in each member's Volunteer Hours Record.
 */

const MAX_MEETING_HOURS = 24;
const MAX_ATTENDEES = 1000;

export type AttendanceInput = {
  name: string;
  date: string;
  hours: string | number;
  attendees: { memberId: string; subtract?: string | number }[];
};

function parseHours(value: unknown, label: string, { allowZero }: { allowZero: boolean }): number {
  const text = String(value ?? "").trim();
  const amount = text === "" ? 0 : Number(text);
  if (!Number.isFinite(amount) || amount < 0 || amount > MAX_MEETING_HOURS || (!allowZero && amount === 0)) {
    throw new ActionError(`${label} must be ${allowZero ? "between 0" : "more than 0"} and ${MAX_MEETING_HOURS}.`);
  }
  if (Math.round(amount * 100) !== amount * 100) throw new ActionError(`${label} can have at most two decimal places.`);
  return amount;
}
const round2 = (value: number) => Math.round(value * 100) / 100;

/** The member's most recent Volunteer Hours Record, created if they have none. */
async function hoursRecordFor(tx: Queryable, memberId: string, actor: Actor): Promise<string> {
  const [existing] = await tx.query<{ id: string }>(
    `SELECT id FROM member_documentation WHERE member_id = $1 AND document_type = 'volunteer_hours_record'
      ORDER BY created_at DESC, id DESC LIMIT 1`,
    [memberId],
  );
  if (existing) return existing.id;
  const settings = await getSettings();
  const period = settings?.default_documentation_period ?? "";
  const [created] = await tx.query<{ id: string }>(
    `INSERT INTO member_documentation (member_id, document_type, period, last_edited_by_type, last_edited_by_name)
     VALUES ($1, 'volunteer_hours_record', $2, $3, $4) RETURNING id`,
    [memberId, period, actor.type, actor.name],
  );
  await recordAudit(tx, {
    actor,
    member: await loadMemberRef(tx, memberId),
    action: "created",
    entityType: "document",
    documentType: "volunteer_hours_record",
    documentId: created.id,
    recordId: created.id,
    summary: "Created Volunteer Hours Record (for meeting attendance)",
    next: { period },
    realtime: ["member"],
  });
  return created.id;
}

async function addMeetingEntry(tx: Queryable, actor: Actor, memberId: string, meeting: { name: string; date: string }, hours: number) {
  const documentId = await hoursRecordFor(tx, memberId, actor);
  const [row] = await tx.query<{ id: string; service_date: string; description: string; hours: number }>(
    `INSERT INTO volunteer_hours (document_id, member_id, service_date, description, hours)
     VALUES ($1, $2, $3::date, $4, $5) RETURNING id, service_date, description, hours`,
    [documentId, memberId, meeting.date, meeting.name, hours],
  );
  await tx.query("UPDATE member_documentation SET updated_at = now(), last_edited_by_type = $2, last_edited_by_name = $3 WHERE id = $1", [
    documentId,
    actor.type,
    actor.name,
  ]);
  await recordAudit(tx, {
    actor,
    member: await loadMemberRef(tx, memberId),
    action: "created",
    entityType: "volunteer_hours_entry",
    documentType: "volunteer_hours_record",
    documentId,
    recordId: row.id,
    summary: `Added meeting hours: ${meeting.name}`,
    next: { service_date: row.service_date, description: row.description, hours: Number(row.hours) },
    realtime: ["member"],
  });
  return row.id;
}

/* ------------------------------ Record attendance ------------------------------ */

export async function recordAttendanceAction(input: AttendanceInput): Promise<ActionResult<{ meetingId: string; present: number }>> {
  try {
    const actor = await getAdminActor();
    if (!actor) return UNAUTHORIZED;
    const name = cleanLine(input?.name, 120, "Meeting name", true);
    if (!name.ok) return fail(name.error, "invalid");
    const date = cleanDate(input?.date, "Date");
    if (!date.ok) return fail(date.error, "invalid");
    if (!date.value) return fail("Enter the meeting date.", "invalid");
    const hours = parseHours(input?.hours, "Meeting hours", { allowZero: false });
    const list = Array.isArray(input?.attendees) ? input.attendees : [];
    if (list.length === 0) return fail("Select at least one member who attended.", "invalid");
    if (list.length > MAX_ATTENDEES) return fail("Too many attendees in one meeting.", "invalid");
    const seen = new Set<string>();
    const attendees = list.map((item) => {
      if (!item || !isUuid(item.memberId) || seen.has(item.memberId)) throw new ActionError("The attendance list is invalid. Reload the page and try again.");
      seen.add(item.memberId);
      const subtract = parseHours(item.subtract, "Hours subtracted", { allowZero: true });
      if (subtract > hours) throw new ActionError("You can't subtract more hours than the meeting lasted.");
      return { memberId: item.memberId, credited: round2(hours - subtract), subtract };
    });

    const result = await withTransaction(async (tx) => {
      const [meeting] = await tx.query<{ id: string }>(
        "INSERT INTO meetings (name, meeting_date, hours, recorded_by_name) VALUES ($1, $2::date, $3, $4) RETURNING id",
        [name.value, date.value, hours, actor.name],
      );
      const names: string[] = [];
      for (const attendee of attendees) {
        const [member] = await tx.query<{ full_name: string; status: string }>("SELECT full_name, status FROM members WHERE id = $1 FOR UPDATE", [
          attendee.memberId,
        ]);
        if (!member) throw new ActionError("One of the selected members no longer exists. Reload the page and try again.");
        const entryId = attendee.credited > 0 ? await addMeetingEntry(tx, actor, attendee.memberId, { name: name.value, date: date.value! }, attendee.credited) : null;
        await tx.query("INSERT INTO meeting_attendance (meeting_id, member_id, hours, volunteer_hours_id) VALUES ($1, $2, $3, $4)", [
          meeting.id,
          attendee.memberId,
          attendee.credited,
          entryId,
        ]);
        names.push(attendee.subtract > 0 ? `${member.full_name} (${attendee.credited} h)` : member.full_name);
      }
      await recordAudit(tx, {
        actor,
        action: "created",
        entityType: "attendance",
        recordId: meeting.id,
        summary: `Recorded attendance for ${name.value}`,
        next: { name: name.value, meeting_date: date.value, hours, present: attendees.length, members: names.join(", ") },
        notification: {
          type: "attendance.recorded",
          description: `${actor.name} recorded attendance for ${name.value}: ${attendees.length} member${attendees.length === 1 ? "" : "s"}, ${hours} hour${hours === 1 ? "" : "s"} each.`,
          link: "/admin/attendance",
        },
        realtime: ["admin"],
      });
      return { meetingId: meeting.id, present: attendees.length };
    });
    return { ok: true, data: result };
  } catch (error) {
    return handleActionError(error, "recordAttendance");
  }
}

/* ------------------------- Change one attendee's hours ------------------------- */

export async function setAttendeeHoursAction(input: { meetingId: string; memberId: string; hours: string | number }): Promise<ActionResult<null>> {
  try {
    const actor = await getAdminActor();
    if (!actor) return UNAUTHORIZED;
    if (!isUuid(input?.meetingId) || !isUuid(input?.memberId)) return fail("Invalid request.", "invalid");
    const hours = parseHours(input.hours, "Hours", { allowZero: true });

    await withTransaction(async (tx) => {
      const [row] = await tx.query<{ name: string; meeting_date: string; meeting_hours: number; hours: number; volunteer_hours_id: string | null }>(
        `SELECT m.name, m.meeting_date::text AS meeting_date, m.hours AS meeting_hours, a.hours, a.volunteer_hours_id
           FROM meeting_attendance a JOIN meetings m ON m.id = a.meeting_id
          WHERE a.meeting_id = $1 AND a.member_id = $2 FOR UPDATE OF a`,
        [input.meetingId, input.memberId],
      );
      if (!row) throw new ActionError("This attendance record no longer exists.", "not_found");
      if (hours > Number(row.meeting_hours)) throw new ActionError(`Hours can't be more than the meeting's ${Number(row.meeting_hours)}.`);
      if (Number(row.hours) === hours) return;
      const member = await loadMemberRef(tx, input.memberId);
      const [entry] = row.volunteer_hours_id
        ? await tx.query<{ id: string; document_id: string; service_date: string; description: string; hours: number }>(
            "SELECT id, document_id, service_date, description, hours FROM volunteer_hours WHERE id = $1 FOR UPDATE",
            [row.volunteer_hours_id],
          )
        : [];
      let entryId: string | null = entry?.id ?? null;
      if (entry && hours > 0) {
        await tx.query("UPDATE volunteer_hours SET hours = $2, updated_at = now() WHERE id = $1", [entry.id, hours]);
        await recordAudit(tx, {
          actor,
          member,
          action: "edited",
          entityType: "volunteer_hours_entry",
          documentType: "volunteer_hours_record",
          documentId: entry.document_id,
          recordId: entry.id,
          summary: `Changed meeting hours: ${row.name}`,
          previous: { service_date: entry.service_date, description: entry.description, hours: Number(entry.hours) },
          next: { service_date: entry.service_date, description: entry.description, hours },
          realtime: ["member"],
        });
      } else if (entry && hours === 0) {
        await tx.query("DELETE FROM volunteer_hours WHERE id = $1", [entry.id]);
        entryId = null;
        await recordAudit(tx, {
          actor,
          member,
          action: "deleted",
          entityType: "volunteer_hours_entry",
          documentType: "volunteer_hours_record",
          documentId: entry.document_id,
          recordId: entry.id,
          summary: `Removed meeting hours: ${row.name}`,
          previous: { service_date: entry.service_date, description: entry.description, hours: Number(entry.hours) },
          realtime: ["member"],
        });
      } else if (!entry && hours > 0) {
        entryId = await addMeetingEntry(tx, actor, input.memberId, { name: row.name, date: row.meeting_date }, hours);
      }
      await tx.query("UPDATE meeting_attendance SET hours = $3, volunteer_hours_id = $4 WHERE meeting_id = $1 AND member_id = $2", [
        input.meetingId,
        input.memberId,
        hours,
        entryId,
      ]);
    });
    return { ok: true, data: null };
  } catch (error) {
    return handleActionError(error, "setAttendeeHours");
  }
}

/* -------------------------------- Delete a meeting ------------------------------- */

export async function deleteMeetingAction(meetingId: string): Promise<ActionResult<null>> {
  try {
    const actor = await getAdminActor();
    if (!actor) return UNAUTHORIZED;
    if (!isUuid(meetingId)) return fail("Invalid request.", "invalid");
    await withTransaction(async (tx) => {
      const [meeting] = await tx.query<{ name: string; meeting_date: string; hours: number }>(
        "SELECT name, meeting_date::text AS meeting_date, hours FROM meetings WHERE id = $1 FOR UPDATE",
        [meetingId],
      );
      if (!meeting) return;
      const entries = await tx.query<{ member_id: string; id: string; document_id: string; service_date: string; description: string; hours: number }>(
        `SELECT a.member_id, h.id, h.document_id, h.service_date, h.description, h.hours
           FROM meeting_attendance a JOIN volunteer_hours h ON h.id = a.volunteer_hours_id
          WHERE a.meeting_id = $1`,
        [meetingId],
      );
      for (const entry of entries) {
        await tx.query("DELETE FROM volunteer_hours WHERE id = $1", [entry.id]);
        await recordAudit(tx, {
          actor,
          member: await loadMemberRef(tx, entry.member_id),
          action: "deleted",
          entityType: "volunteer_hours_entry",
          documentType: "volunteer_hours_record",
          documentId: entry.document_id,
          recordId: entry.id,
          summary: `Removed meeting hours: ${meeting.name} (meeting deleted)`,
          previous: { service_date: entry.service_date, description: entry.description, hours: Number(entry.hours) },
          realtime: ["member"],
        });
      }
      const [{ count }] = await tx.query<{ count: number }>("SELECT count(*)::int AS count FROM meeting_attendance WHERE meeting_id = $1", [meetingId]);
      await tx.query("DELETE FROM meetings WHERE id = $1", [meetingId]);
      await recordAudit(tx, {
        actor,
        action: "deleted",
        entityType: "attendance",
        recordId: meetingId,
        summary: `Deleted attendance for ${meeting.name}`,
        previous: { name: meeting.name, meeting_date: meeting.meeting_date, hours: Number(meeting.hours), present: count },
        notification: {
          type: "attendance.deleted",
          description: `${actor.name} deleted the attendance for ${meeting.name} and removed the hours it added.`,
          link: "/admin/attendance",
        },
        realtime: ["admin"],
      });
    });
    return { ok: true, data: null };
  } catch (error) {
    return handleActionError(error, "deleteMeeting");
  }
}
