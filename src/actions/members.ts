"use server";

import { withTransaction, type Queryable } from "@/lib/server/db";
import { getAdminActor } from "@/lib/server/auth";
import { recordAudit, type MemberRef } from "@/lib/server/audit";
import { getSettings } from "@/lib/server/settings";
import { generatePassword, hashPassword } from "@/lib/server/security";
import { cleanDate, cleanEmail, cleanLine, isUuid, LIMITS } from "@/lib/validation";
import { DOCUMENT_TYPE_LABEL } from "@/lib/document-text";
import { memberCode } from "@/lib/format";
import type { ActionResult, DocumentType, MemberStatus } from "@/lib/types";
import { ActionError, fail, handleActionError, UNAUTHORIZED } from "./shared";

export type MemberFormInput = {
  fullName: string;
  departmentId: string;
  positionId: string;
  status: string;
  email: string;
  startDate: string;
};

export type IssuedCredential = {
  id: string;
  fullName: string;
  memberCode: string;
  departmentName: string;
  positionName: string;
  status: MemberStatus;
  password: string;
};

type CleanMember = {
  fullName: string;
  departmentId: string;
  positionId: string;
  status: MemberStatus;
  email: string | null;
  startDate: string | null;
};

function validateMember(input: MemberFormInput): { ok: true; value: CleanMember } | { ok: false; error: string } {
  if (!input || typeof input !== "object") return { ok: false, error: "Invalid request." };
  const fullName = cleanLine(input.fullName, LIMITS.fullName, "Full name", true);
  if (!fullName.ok) return fullName;
  if (!isUuid(input.departmentId)) return { ok: false, error: "Select a department." };
  if (!isUuid(input.positionId)) return { ok: false, error: "Select a position/role." };
  if (input.status !== "active" && input.status !== "inactive") return { ok: false, error: "Select a member status." };
  const email = cleanEmail(input.email);
  if (!email.ok) return email;
  const startDate = cleanDate(input.startDate, "Start date");
  if (!startDate.ok) return startDate;
  return {
    ok: true,
    value: {
      fullName: fullName.value,
      departmentId: input.departmentId,
      positionId: input.positionId,
      status: input.status,
      email: email.value,
      startDate: startDate.value,
    },
  };
}

type MemberSnapshotRow = {
  id: string;
  member_number: number;
  full_name: string;
  email: string | null;
  status: MemberStatus;
  start_date: string | null;
  department_id: string;
  department_name: string;
  position_name: string;
};

async function loadMemberForUpdate(tx: Queryable, memberId: string): Promise<MemberSnapshotRow> {
  const [row] = await tx.query<MemberSnapshotRow>(
    `SELECT m.id, m.member_number, m.full_name, m.email, m.status, m.start_date, m.department_id,
            d.name AS department_name, p.name AS position_name
       FROM members m
       JOIN departments d ON d.id = m.department_id
       JOIN positions p ON p.id = m.position_id
      WHERE m.id = $1
      FOR UPDATE OF m`,
    [memberId],
  );
  if (!row) throw new ActionError("This member no longer exists.", "not_found");
  return row;
}

function snapshot(row: MemberSnapshotRow) {
  return {
    member_code: memberCode(row.member_number),
    full_name: row.full_name,
    department: row.department_name,
    position: row.position_name,
    status: row.status,
    email: row.email,
    start_date: row.start_date,
  };
}

function refOf(row: MemberSnapshotRow): MemberRef {
  return { id: row.id, fullName: row.full_name, departmentId: row.department_id, departmentName: row.department_name };
}

async function lookupNames(tx: Queryable, departmentId: string, positionId: string) {
  const [department] = await tx.query<{ id: string; name: string }>("SELECT id, name FROM departments WHERE id = $1", [departmentId]);
  if (!department) throw new ActionError("Select a valid department.");
  const [position] = await tx.query<{ id: string; name: string }>("SELECT id, name FROM positions WHERE id = $1", [positionId]);
  if (!position) throw new ActionError("Select a valid position/role.");
  return { department, position };
}

/* ---------------------------------- Add member ---------------------------------- */

export async function createMemberAction(input: MemberFormInput): Promise<ActionResult<IssuedCredential>> {
  try {
    const actor = await getAdminActor();
    if (!actor) return UNAUTHORIZED;
    const parsed = validateMember(input);
    if (!parsed.ok) return fail(parsed.error, "invalid");
    const value = parsed.value;

    const password = generatePassword();
    const passwordHash = await hashPassword(password);
    const settings = await getSettings();
    const defaultPeriod = settings?.default_documentation_period ?? "";

    const created = await withTransaction(async (tx) => {
      const { department, position } = await lookupNames(tx, value.departmentId, value.positionId);
      const [member] = await tx.query<{ id: string; member_number: number }>(
        `INSERT INTO members (full_name, department_id, position_id, email, status, start_date, deactivated_at)
         VALUES ($1, $2, $3, $4, $5, $6::date, CASE WHEN $5 = 'inactive' THEN now() END)
         RETURNING id, member_number`,
        [value.fullName, department.id, position.id, value.email, value.status, value.startDate],
      );
      await tx.query("INSERT INTO member_credentials (member_id, password_hash) VALUES ($1, $2)", [member.id, passwordHash]);
      const documents = await tx.query<{ id: string; document_type: DocumentType }>(
        `INSERT INTO member_documentation (member_id, document_type, period, last_edited_by_type, last_edited_by_name)
         VALUES ($1, 'member_documentation', $2, 'admin', $3), ($1, 'volunteer_hours_record', $2, 'admin', $3)
         RETURNING id, document_type`,
        [member.id, defaultPeriod, actor.name],
      );

      const ref: MemberRef = { id: member.id, fullName: value.fullName, departmentId: department.id, departmentName: department.name };
      const code = memberCode(member.member_number);
      await recordAudit(tx, {
        actor,
        member: ref,
        action: "created",
        entityType: "member",
        recordId: member.id,
        summary: "Created member account",
        next: {
          member_code: code,
          full_name: value.fullName,
          department: department.name,
          position: position.name,
          status: value.status,
          email: value.email,
          start_date: value.startDate,
        },
        notification: {
          type: "member.created",
          description: `${actor.name} created a member account for ${value.fullName} (${department.name}).`,
          link: `/admin/members/${member.id}`,
        },
        realtime: ["directory", "member"],
      });
      for (const document of documents) {
        await recordAudit(tx, {
          actor,
          member: ref,
          action: "created",
          entityType: "document",
          documentType: document.document_type,
          documentId: document.id,
          recordId: document.id,
          summary: `Created ${DOCUMENT_TYPE_LABEL[document.document_type]} (issued automatically with the new account)`,
          next: { period: defaultPeriod },
          realtime: ["member"],
        });
      }
      return {
        id: member.id,
        fullName: value.fullName,
        memberCode: code,
        departmentName: department.name,
        positionName: position.name,
        status: value.status,
      };
    });

    return { ok: true, data: { ...created, password } };
  } catch (error) {
    return handleActionError(error, "createMember");
  }
}

/* --------------------------------- Edit member ---------------------------------- */

export async function updateMemberAction(memberId: string, input: MemberFormInput): Promise<ActionResult<null>> {
  try {
    const actor = await getAdminActor();
    if (!actor) return UNAUTHORIZED;
    if (!isUuid(memberId)) return fail("Invalid member.", "invalid");
    const parsed = validateMember(input);
    if (!parsed.ok) return fail(parsed.error, "invalid");
    const value = parsed.value;

    await withTransaction(async (tx) => {
      const before = await loadMemberForUpdate(tx, memberId);
      const { department, position } = await lookupNames(tx, value.departmentId, value.positionId);
      await tx.query(
        `UPDATE members
            SET full_name = $2, department_id = $3, position_id = $4, email = $5, status = $6, start_date = $7::date,
                deactivated_at = CASE WHEN $6 = 'inactive' THEN coalesce(deactivated_at, now()) ELSE NULL END,
                updated_at = now()
          WHERE id = $1`,
        [memberId, value.fullName, department.id, position.id, value.email, value.status, value.startDate],
      );
      const after = await loadMemberForUpdate(tx, memberId);
      if (value.status === "inactive") await tx.query("DELETE FROM sessions WHERE member_id = $1", [memberId]);

      const { status: statusBefore, ...restBefore } = snapshot(before);
      const { status: statusAfter, ...restAfter } = snapshot(after);
      await recordAudit(tx, {
        actor,
        member: refOf(after),
        action: "edited",
        entityType: "member",
        recordId: memberId,
        summary: "Updated member information",
        previous: restBefore,
        next: restAfter,
        realtime: ["directory", "member"],
      });
      if (statusBefore !== statusAfter) {
        await recordStatusChange(tx, actor, after, statusBefore, statusAfter);
      }
    });
    return { ok: true, data: null };
  } catch (error) {
    return handleActionError(error, "updateMember");
  }
}

async function recordStatusChange(
  tx: Queryable,
  actor: NonNullable<Awaited<ReturnType<typeof getAdminActor>>>,
  member: MemberSnapshotRow,
  from: MemberStatus,
  to: MemberStatus,
) {
  const deactivated = to === "inactive";
  await recordAudit(tx, {
    actor,
    member: refOf(member),
    action: deactivated ? "deactivated" : "reactivated",
    entityType: "member",
    recordId: member.id,
    summary: deactivated ? "Deactivated member account" : "Reactivated member account",
    previous: { status: from },
    next: { status: to },
    notification: {
      type: deactivated ? "member.deactivated" : "member.reactivated",
      description: deactivated
        ? `${actor.name} deactivated ${member.full_name}'s account (${member.department_name}).`
        : `${actor.name} reactivated ${member.full_name}'s account (${member.department_name}).`,
      link: `/admin/members/${member.id}`,
    },
    realtime: ["directory", "member"],
  });
}

export async function setMemberStatusAction(memberId: string, status: MemberStatus): Promise<ActionResult<null>> {
  try {
    const actor = await getAdminActor();
    if (!actor) return UNAUTHORIZED;
    if (!isUuid(memberId) || (status !== "active" && status !== "inactive")) return fail("Invalid request.", "invalid");
    await withTransaction(async (tx) => {
      const before = await loadMemberForUpdate(tx, memberId);
      if (before.status === status) return;
      await tx.query(
        `UPDATE members SET status = $2, updated_at = now(),
                deactivated_at = CASE WHEN $2 = 'inactive' THEN now() ELSE NULL END
          WHERE id = $1`,
        [memberId, status],
      );
      if (status === "inactive") await tx.query("DELETE FROM sessions WHERE member_id = $1", [memberId]);
      await recordStatusChange(tx, actor, { ...before, status }, before.status, status);
    });
    return { ok: true, data: null };
  } catch (error) {
    return handleActionError(error, "setMemberStatus");
  }
}

/* -------------------------------- Password reset -------------------------------- */

export async function resetMemberPasswordAction(memberId: string): Promise<ActionResult<IssuedCredential>> {
  try {
    const actor = await getAdminActor();
    if (!actor) return UNAUTHORIZED;
    if (!isUuid(memberId)) return fail("Invalid member.", "invalid");
    const password = generatePassword();
    const passwordHash = await hashPassword(password);

    const member = await withTransaction(async (tx) => {
      const row = await loadMemberForUpdate(tx, memberId);
      await tx.query(
        `UPDATE member_credentials
            SET password_hash = $2, password_version = password_version + 1, password_changed_at = now()
          WHERE member_id = $1`,
        [memberId, passwordHash],
      );
      // Existing sessions for this member end immediately; other members are unaffected.
      await tx.query("DELETE FROM sessions WHERE member_id = $1", [memberId]);
      // A freshly issued password clears any temporary sign-in lock on this account.
      await tx.query("DELETE FROM login_attempts WHERE scope = 'member' AND target = $1", [memberId]);
      await recordAudit(tx, {
        actor,
        member: refOf(row),
        action: "password_reset",
        entityType: "member",
        recordId: memberId,
        summary: "Reset member password",
        next: { password: "New password issued (not stored in readable form)" },
        notification: {
          type: "member.password_reset",
          description: `${actor.name} reset the documentation password for ${row.full_name}.`,
          link: `/admin/members/${memberId}`,
        },
        realtime: ["member"],
      });
      return row;
    });

    return {
      ok: true,
      data: {
        id: member.id,
        fullName: member.full_name,
        memberCode: memberCode(member.member_number),
        departmentName: member.department_name,
        positionName: member.position_name,
        status: member.status,
        password,
      },
    };
  } catch (error) {
    return handleActionError(error, "resetMemberPassword");
  }
}

/* --------------------------------- Delete member -------------------------------- */

export async function deleteMemberAction(memberId: string, confirmation: string): Promise<ActionResult<null>> {
  try {
    const actor = await getAdminActor();
    if (!actor) return UNAUTHORIZED;
    if (!isUuid(memberId)) return fail("Invalid member.", "invalid");

    await withTransaction(async (tx) => {
      const member = await loadMemberForUpdate(tx, memberId);
      if (String(confirmation ?? "").trim().toLowerCase() !== member.full_name.trim().toLowerCase()) {
        throw new ActionError("Type the member's full name exactly to confirm deletion.");
      }
      const documents = await tx.query<Record<string, unknown> & { id: string; document_type: DocumentType }>(
        `SELECT id, document_type, period, supervisor_name, supervisor_position, supervisor_signature, member_confirmation,
                date_submitted, verification_date
           FROM member_documentation WHERE member_id = $1 ORDER BY created_at`,
        [memberId],
      );
      const contributions = await tx.query(
        "SELECT document_id, entry_date, title, details FROM contribution_entries WHERE member_id = $1 ORDER BY created_at",
        [memberId],
      );
      const hours = await tx.query(
        "SELECT document_id, service_date, description, hours FROM volunteer_hours WHERE member_id = $1 ORDER BY created_at",
        [memberId],
      );
      await tx.query("DELETE FROM members WHERE id = $1", [memberId]);
      await recordAudit(tx, {
        actor,
        member: refOf(member),
        action: "deleted",
        entityType: "member",
        recordId: memberId,
        summary: "Deleted member account and documentation",
        previous: { ...snapshot(member), documents, contribution_entries: contributions, volunteer_hours: hours },
        notification: {
          type: "member.deleted",
          description: `${actor.name} deleted the member account for ${member.full_name} (${member.department_name}).`,
        },
        realtime: ["directory", "member"],
      });
    });
    return { ok: true, data: null };
  } catch (error) {
    return handleActionError(error, "deleteMember");
  }
}
