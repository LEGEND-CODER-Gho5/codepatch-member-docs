"use server";

import { withTransaction } from "@/lib/server/db";
import { getAdminActor } from "@/lib/server/auth";
import { loadMemberRef, recordAudit } from "@/lib/server/audit";
import { getAuditDetail } from "@/lib/server/queries";
import { isRestorable } from "@/lib/audit-display";
import { DOCUMENT_TYPE_LABEL } from "@/lib/document-text";
import { cleanDate, cleanFreeText, cleanHours, LIMITS } from "@/lib/validation";
import { DOCUMENT_FIELDS, DATE_FIELDS, type ActionResult, type DocumentType } from "@/lib/types";
import { ActionError, fail, handleActionError, UNAUTHORIZED } from "./shared";

type Snapshot = Record<string, unknown>;

function docFieldsFrom(type: DocumentType, snapshot: Snapshot) {
  return DOCUMENT_FIELDS[type].map((field) => {
    const raw = snapshot[field];
    const result = DATE_FIELDS.includes(field)
      ? cleanDate(raw ?? null, field)
      : cleanFreeText(raw ?? "", field === "period" ? LIMITS.period : LIMITS.shortField, field);
    if (!result.ok) throw new ActionError("The stored version contains invalid values and cannot be restored.");
    return [field, result.value] as const;
  });
}

function contributionFrom(snapshot: Snapshot) {
  const date = cleanDate(snapshot.entry_date ?? null, "Date");
  const title = cleanFreeText(snapshot.title ?? "", LIMITS.title, "Contribution");
  const details = cleanFreeText(snapshot.details ?? "", LIMITS.details, "Details");
  if (!date.ok || !title.ok || !details.ok) throw new ActionError("The stored version cannot be restored.");
  return { entry_date: date.value, title: title.value, details: details.value };
}

function hoursFrom(snapshot: Snapshot) {
  const date = cleanDate(snapshot.service_date ?? null, "Date");
  const description = cleanFreeText(snapshot.description ?? "", LIMITS.description, "Description");
  const hours = cleanHours(snapshot.hours ?? null);
  if (!date.ok || !description.ok || !hours.ok) throw new ActionError("The stored version cannot be restored.");
  return { service_date: date.value, description: description.value, hours: hours.value };
}

/**
 * Restores the "previous version" captured in an audit record. The restore is
 * itself recorded as a new administrator action; nothing in history is altered.
 */
export async function restoreAuditVersionAction(auditId: number): Promise<ActionResult<{ link: string }>> {
  try {
    const actor = await getAdminActor();
    if (!actor) return UNAUTHORIZED;
    const audit = await getAuditDetail(Number(auditId));
    if (!audit) return fail("This history record does not exist.", "not_found");
    if (!isRestorable(audit) || !audit.previousValues || typeof audit.previousValues !== "object" || !audit.documentType) {
      return fail("This change cannot be restored automatically.", "invalid");
    }
    const previous = audit.previousValues as Snapshot;
    const documentType = audit.documentType;

    const link = await withTransaction(async (tx) => {
      const restoredFrom = { audit_record: audit.id };

      if (audit.entityType === "document" && audit.action === "edited") {
        const [doc] = await tx.query<Snapshot & { member_id: string }>(
          "SELECT * FROM member_documentation WHERE id = $1 FOR UPDATE",
          [audit.documentId],
        );
        if (!doc) throw new ActionError("The document no longer exists. Restore its deletion record instead.", "not_found");
        const fields = docFieldsFrom(documentType, previous);
        const assignments = fields.map(([field], index) => `${field} = $${index + 2}`).join(", ");
        await tx.query(
          `UPDATE member_documentation SET ${assignments}, updated_at = now(), last_edited_by_type = 'admin',
                  last_edited_by_name = $${fields.length + 2} WHERE id = $1`,
          [audit.documentId, ...fields.map(([, value]) => value), actor.name],
        );
        const member = await loadMemberRef(tx, doc.member_id);
        await recordAudit(tx, {
          actor,
          member,
          action: "restored",
          entityType: "document",
          documentType,
          documentId: audit.documentId,
          recordId: audit.documentId,
          summary: `Restored ${DOCUMENT_TYPE_LABEL[documentType]} details to an earlier version`,
          previous: Object.fromEntries(DOCUMENT_FIELDS[documentType].map((field) => [field, doc[field] ?? null])),
          next: { ...Object.fromEntries(fields), ...restoredFrom },
          realtime: ["member"],
        });
        return `/admin/documentation/${doc.member_id}?type=${documentType}&doc=${audit.documentId}`;
      }

      if (audit.entityType === "document" && audit.action === "deleted") {
        if (!audit.memberId) throw new ActionError("The member for this document is unknown.");
        const member = await loadMemberRef(tx, audit.memberId);
        if (!member) throw new ActionError("The member account no longer exists, so the document cannot be restored.", "not_found");
        const fields = docFieldsFrom(documentType, previous);
        const columns = fields.map(([field]) => field).join(", ");
        const placeholders = fields.map((_, index) => `$${index + 3}`).join(", ");
        const [doc] = await tx.query<{ id: string }>(
          `INSERT INTO member_documentation (member_id, document_type, ${columns}, last_edited_by_type, last_edited_by_name)
           VALUES ($1, $2, ${placeholders}, 'admin', $${fields.length + 3}) RETURNING id`,
          [member.id, documentType, ...fields.map(([, value]) => value), actor.name],
        );
        const children = Array.isArray(previous.contribution_entries)
          ? (previous.contribution_entries as Snapshot[])
          : Array.isArray(previous.volunteer_hours)
            ? (previous.volunteer_hours as Snapshot[])
            : [];
        for (const child of children) {
          if (documentType === "member_documentation") {
            const values = contributionFrom(child);
            await tx.query(
              "INSERT INTO contribution_entries (document_id, member_id, entry_date, title, details) VALUES ($1, $2, $3, $4, $5)",
              [doc.id, member.id, values.entry_date, values.title, values.details],
            );
          } else {
            const values = hoursFrom(child);
            await tx.query(
              "INSERT INTO volunteer_hours (document_id, member_id, service_date, description, hours) VALUES ($1, $2, $3, $4, $5)",
              [doc.id, member.id, values.service_date, values.description, values.hours],
            );
          }
        }
        await recordAudit(tx, {
          actor,
          member,
          action: "restored",
          entityType: "document",
          documentType,
          documentId: doc.id,
          recordId: doc.id,
          summary: `Restored deleted ${DOCUMENT_TYPE_LABEL[documentType]} record (${children.length} entries)`,
          next: { ...previous, ...restoredFrom },
          realtime: ["member"],
        });
        return `/admin/documentation/${member.id}?type=${documentType}&doc=${doc.id}`;
      }

      // Individual entries.
      const isHours = audit.entityType === "volunteer_hours_entry";
      const table = isHours ? "volunteer_hours" : "contribution_entries";
      const values = isHours ? hoursFrom(previous) : contributionFrom(previous);
      const [doc] = await tx.query<{ id: string; member_id: string }>(
        "SELECT id, member_id FROM member_documentation WHERE id = $1",
        [audit.documentId],
      );
      if (!doc) throw new ActionError("The document containing this entry no longer exists.", "not_found");
      const member = await loadMemberRef(tx, doc.member_id);
      const columns = Object.keys(values);
      let recordId: string;
      let before: Snapshot | null = null;

      if (audit.action === "edited") {
        const [current] = await tx.query<Snapshot & { id: string }>(`SELECT * FROM ${table} WHERE id = $1 FOR UPDATE`, [audit.recordId]);
        if (!current) throw new ActionError("This entry has since been deleted. Restore the deletion record instead.", "not_found");
        before = Object.fromEntries(columns.map((column) => [column, current[column] ?? null]));
        await tx.query(
          `UPDATE ${table} SET ${columns.map((column, index) => `${column} = $${index + 2}`).join(", ")}, updated_at = now() WHERE id = $1`,
          [current.id, ...Object.values(values)],
        );
        recordId = current.id;
      } else {
        const [created] = await tx.query<{ id: string }>(
          `INSERT INTO ${table} (document_id, member_id, ${columns.join(", ")})
           VALUES ($1, $2, ${columns.map((_, index) => `$${index + 3}`).join(", ")}) RETURNING id`,
          [doc.id, doc.member_id, ...Object.values(values)],
        );
        recordId = created.id;
      }
      await tx.query(
        "UPDATE member_documentation SET updated_at = now(), last_edited_by_type = 'admin', last_edited_by_name = $2 WHERE id = $1",
        [doc.id, actor.name],
      );
      await recordAudit(tx, {
        actor,
        member,
        action: "restored",
        entityType: audit.entityType,
        documentType,
        documentId: doc.id,
        recordId,
        summary: isHours ? "Restored volunteer-hours entry to an earlier version" : "Restored contribution entry to an earlier version",
        previous: before,
        next: { ...values, ...restoredFrom },
        realtime: ["member"],
      });
      return `/admin/documentation/${doc.member_id}?type=${documentType}&doc=${doc.id}`;
    });

    return { ok: true, data: { link } };
  } catch (error) {
    return handleActionError(error, "restoreAuditVersion");
  }
}
