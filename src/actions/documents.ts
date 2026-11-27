"use server";

import { sqlOne, withTransaction, type Queryable } from "@/lib/server/db";
import { getActorFor, getAdminActor } from "@/lib/server/auth";
import { loadMemberRef, recordAudit, type Actor, type MemberRef } from "@/lib/server/audit";
import { getSettings } from "@/lib/server/settings";
import { cleanDate, cleanFreeText, cleanHours, isUuid, LIMITS } from "@/lib/validation";
import { DOCUMENT_TYPE_LABEL } from "@/lib/document-text";
import {
  DATE_FIELDS,
  DOCUMENT_FIELDS,
  type ActingAs,
  type ActionResult,
  type DocumentType,
  type EntryKind,
  type HeaderField,
  VERIFIER_FIELDS,
} from "@/lib/types";
import { ActionError, fail, handleActionError, UNAUTHORIZED } from "./shared";

type DocRow = {
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
  updated_at: Date;
  verified_at: Date | null;
  verified_by_name: string | null;
};

const FIELD_NAMES: Record<HeaderField, string> = {
  period: "Period",
  supervisor_name: "Supervisor Name",
  supervisor_position: "Supervisor Position",
  supervisor_signature: "Supervisor Signature",
  member_confirmation: "Member Confirmation",
  date_submitted: "Date Submitted",
  verification_date: "Date",
};

const ENTRY_CONFIG = {
  contribution: {
    table: "contribution_entries",
    entity: "contribution_entry",
    documentType: "member_documentation" as DocumentType,
    fields: ["entry_date", "title", "details"] as const,
    label: "contribution entry",
  },
  hours: {
    table: "volunteer_hours",
    entity: "volunteer_hours_entry",
    documentType: "volunteer_hours_record" as DocumentType,
    fields: ["service_date", "description", "hours"] as const,
    label: "volunteer-hours entry",
  },
} as const;

type EntryValues = Record<string, string | number | null>;

function isActingAs(value: unknown): value is ActingAs {
  return value === "member" || value === "admin";
}
function isEntryKind(value: unknown): value is EntryKind {
  return value === "contribution" || value === "hours";
}
function isDocumentType(value: unknown): value is DocumentType {
  return value === "member_documentation" || value === "volunteer_hours_record";
}

function headerSnapshot(row: DocRow) {
  return Object.fromEntries(DOCUMENT_FIELDS[row.document_type].map((field) => [field, row[field] ?? null]));
}

function entrySnapshot(kind: EntryKind, row: Record<string, unknown>): EntryValues {
  return Object.fromEntries(
    ENTRY_CONFIG[kind].fields.map((field) => {
      const value = row[field];
      return [field, value === undefined ? null : field === "hours" && value !== null ? Number(value) : (value as string | null)];
    }),
  );
}

function documentLink(memberId: string, documentId: string, type: DocumentType) {
  return `/admin/documentation/${memberId}?type=${type}&doc=${documentId}`;
}

function validateEntry(kind: EntryKind, values: unknown): { ok: true; value: EntryValues } | { ok: false; error: string } {
  if (!values || typeof values !== "object") return { ok: false, error: "Invalid entry." };
  const input = values as Record<string, unknown>;
  if (kind === "contribution") {
    const date = cleanDate(input.entry_date, "Date");
    if (!date.ok) return date;
    const title = cleanFreeText(input.title, LIMITS.title, "Contribution");
    if (!title.ok) return title;
    const details = cleanFreeText(input.details, LIMITS.details, "Details");
    if (!details.ok) return details;
    return { ok: true, value: { entry_date: date.value, title: title.value, details: details.value } };
  }
  const date = cleanDate(input.service_date, "Date");
  if (!date.ok) return date;
  const description = cleanFreeText(input.description, LIMITS.description, "Description of Volunteer Work");
  if (!description.ok) return description;
  const hours = cleanHours(input.hours);
  if (!hours.ok) return hours;
  return { ok: true, value: { service_date: date.value, description: description.value, hours: hours.value } };
}

async function touchDocument(tx: Queryable, documentId: string, actor: Actor) {
  await tx.query(
    "UPDATE member_documentation SET updated_at = now(), last_edited_by_type = $2, last_edited_by_name = $3 WHERE id = $1",
    [documentId, actor.type, actor.name],
  );
}

function memberNotice(actor: Actor, member: MemberRef | null, type: string, description: string, link?: string) {
  if (actor.type !== "member" || !member) return null;
  return { type, description, link };
}

/* ---------------------------------- Verification ---------------------------------- */

function describeVerification(row: { verified_at: Date | null; verified_by_name: string | null }) {
  return row.verified_at ? `Verified by ${row.verified_by_name || "Administrator"}` : "Not verified";
}

/**
 * A verified record stays verified only while it is exactly what the
 * administrator checked. When a member changes a verified record, this clears
 * the verification in the same transaction, records it in Edit History, and
 * notifies the administrator. Changes by the administrator keep it. Call it
 * before recording the change itself, so autosaves keep merging into one entry.
 */
async function clearVerificationAfterMemberChange(tx: Queryable, actor: Actor, documentId: string, member: MemberRef | null) {
  if (actor.type !== "member") return;
  const [before] = await tx.query<{ document_type: DocumentType; member_id: string; verified_at: Date | null; verified_by_name: string | null }>(
    "SELECT document_type, member_id, verified_at, verified_by_name FROM member_documentation WHERE id = $1 FOR UPDATE",
    [documentId],
  );
  if (!before?.verified_at) return;
  await tx.query("UPDATE member_documentation SET verified_at = NULL, verified_by_name = NULL WHERE id = $1", [documentId]);
  const label = DOCUMENT_TYPE_LABEL[before.document_type];
  await recordAudit(tx, {
    actor: { type: "system", id: "verification", name: "Verification" },
    member,
    action: "unverified",
    entityType: "document",
    documentType: before.document_type,
    documentId,
    recordId: documentId,
    summary: `Verification removed: ${member?.fullName ?? "the member"} changed the verified ${label}`,
    previous: { verification: describeVerification(before) },
    next: { verification: "Not verified (changed by the member)" },
    notification: {
      type: "documentation.unverified",
      description: `${member?.fullName ?? "A member"} changed their ${label} after you verified it. It needs verifying again.`,
      link: documentLink(before.member_id, documentId, before.document_type),
    },
    realtime: ["member"],
  });
}

async function setVerification(documentId: unknown, verify: boolean): Promise<ActionResult<{ verifiedAt: string | null }>> {
  try {
    if (!isUuid(documentId)) return fail("Invalid request.", "invalid");
    const actor = await getAdminActor();
    if (!actor) return UNAUTHORIZED;
    const verifiedAt = await withTransaction(async (tx) => {
      const [before] = await tx.query<DocRow>("SELECT * FROM member_documentation WHERE id = $1 FOR UPDATE", [documentId]);
      if (!before) throw new ActionError("This document no longer exists.", "not_found");
      if (Boolean(before.verified_at) === verify) return before.verified_at;
      const [after] = await tx.query<DocRow>(
        verify
          ? "UPDATE member_documentation SET verified_at = now(), verified_by_name = $2 WHERE id = $1 RETURNING *"
          : "UPDATE member_documentation SET verified_at = NULL, verified_by_name = NULL WHERE id = $1 RETURNING *",
        verify ? [documentId, actor.name] : [documentId],
      );
      const member = await loadMemberRef(tx, before.member_id);
      const label = DOCUMENT_TYPE_LABEL[before.document_type];
      await recordAudit(tx, {
        actor,
        member,
        action: verify ? "verified" : "unverified",
        entityType: "document",
        documentType: before.document_type,
        documentId: before.id,
        recordId: before.id,
        summary: verify ? `Verified ${label} record` : `Removed the verification of a ${label} record`,
        previous: { verification: describeVerification(before) },
        next: { verification: describeVerification(after) },
        realtime: ["member"],
      });
      return after.verified_at;
    });
    return { ok: true, data: { verifiedAt: verifiedAt ? new Date(verifiedAt).toISOString() : null } };
  } catch (error) {
    return handleActionError(error, verify ? "verifyDocument" : "unverifyDocument");
  }
}

/** Administrator only: signs off a record as checked. */
export async function verifyDocumentAction(input: { documentId: string }) {
  return setVerification(input?.documentId, true);
}

/** Administrator only: removes the sign-off so the record shows as not verified. */
export async function unverifyDocumentAction(input: { documentId: string }) {
  return setVerification(input?.documentId, false);
}

/* --------------------------- Header & verification --------------------------- */

export async function saveDocumentFieldsAction(input: {
  documentId: string;
  actingAs: ActingAs;
  patch: Record<string, unknown>;
}): Promise<ActionResult<{ updatedAt: string }>> {
  try {
    if (!input || !isUuid(input.documentId) || !isActingAs(input.actingAs) || !input.patch || typeof input.patch !== "object") {
      return fail("Invalid request.", "invalid");
    }
    const doc = await sqlOne<{ member_id: string; document_type: DocumentType }>(
      "SELECT member_id, document_type FROM member_documentation WHERE id = $1",
      [input.documentId],
    );
    if (!doc) return fail("This document no longer exists.", "not_found");
    const actor = await getActorFor(input.actingAs, doc.member_id);
    if (!actor) return UNAUTHORIZED;

    const allowed = DOCUMENT_FIELDS[doc.document_type] as readonly string[];
    const updates: [HeaderField, string | null][] = [];
    for (const [key, raw] of Object.entries(input.patch)) {
      if (!allowed.includes(key)) return fail("Invalid field.", "invalid");
      const field = key as HeaderField;
      if (actor.type === "member" && VERIFIER_FIELDS.includes(field)) {
        return fail("The supervisor signature and verification date are filled in by the administrator.", "invalid");
      }
      const result = DATE_FIELDS.includes(field)
        ? cleanDate(raw, FIELD_NAMES[field])
        : cleanFreeText(raw, field === "period" ? LIMITS.period : LIMITS.shortField, FIELD_NAMES[field]);
      if (!result.ok) return fail(result.error, "invalid");
      updates.push([field, result.value]);
    }
    if (updates.length === 0) return { ok: true, data: { updatedAt: new Date().toISOString() } };

    const updatedAt = await withTransaction(async (tx) => {
      const [before] = await tx.query<DocRow>("SELECT * FROM member_documentation WHERE id = $1 FOR UPDATE", [input.documentId]);
      if (!before) throw new ActionError("This document no longer exists.", "not_found");
      const assignments = updates.map(([field], index) => `${field} = $${index + 2}`);
      const params: unknown[] = [input.documentId, ...updates.map(([, value]) => value), actor.type, actor.name];
      const [after] = await tx.query<DocRow>(
        `UPDATE member_documentation
            SET ${assignments.join(", ")}, updated_at = now(),
                last_edited_by_type = $${updates.length + 2}, last_edited_by_name = $${updates.length + 3}
          WHERE id = $1
          RETURNING *`,
        params,
      );
      const member = await loadMemberRef(tx, before.member_id);
      const label = DOCUMENT_TYPE_LABEL[before.document_type];
      await clearVerificationAfterMemberChange(tx, actor, before.id, member);
      await recordAudit(tx, {
        actor,
        member,
        action: "edited",
        entityType: "document",
        documentType: before.document_type,
        documentId: before.id,
        recordId: before.id,
        summary: `Edited ${label} details`,
        previous: headerSnapshot(before),
        next: headerSnapshot(after),
        coalesce: true,
        notification: memberNotice(
          actor,
          member,
          "documentation.edited",
          `${member?.fullName} edited their ${label}.`,
          documentLink(before.member_id, before.id, before.document_type),
        ),
        realtime: ["member"],
      });
      return after.updated_at;
    });
    return { ok: true, data: { updatedAt: new Date(updatedAt).toISOString() } };
  } catch (error) {
    return handleActionError(error, "saveDocumentFields");
  }
}

/* ------------------------------------ Entries ------------------------------------ */

export async function createEntryAction(input: {
  documentId: string;
  kind: EntryKind;
  actingAs: ActingAs;
  values: Record<string, unknown>;
}): Promise<ActionResult<{ id: string }>> {
  try {
    if (!input || !isUuid(input.documentId) || !isEntryKind(input.kind) || !isActingAs(input.actingAs)) {
      return fail("Invalid request.", "invalid");
    }
    const config = ENTRY_CONFIG[input.kind];
    const doc = await sqlOne<{ member_id: string; document_type: DocumentType }>(
      "SELECT member_id, document_type FROM member_documentation WHERE id = $1",
      [input.documentId],
    );
    if (!doc) return fail("This document no longer exists.", "not_found");
    if (doc.document_type !== config.documentType) return fail("Invalid entry type for this document.", "invalid");
    const actor = await getActorFor(input.actingAs, doc.member_id);
    if (!actor) return UNAUTHORIZED;
    const values = validateEntry(input.kind, input.values);
    if (!values.ok) return fail(values.error, "invalid");

    const id = await withTransaction(async (tx) => {
      const columns = config.fields.join(", ");
      const placeholders = config.fields.map((_, index) => `$${index + 3}`).join(", ");
      const [row] = await tx.query<Record<string, unknown> & { id: string }>(
        `INSERT INTO ${config.table} (document_id, member_id, ${columns})
         VALUES ($1, $2, ${placeholders})
         RETURNING *`,
        [input.documentId, doc.member_id, ...config.fields.map((field) => values.value[field])],
      );
      await touchDocument(tx, input.documentId, actor);
      const member = await loadMemberRef(tx, doc.member_id);
      const documentLabel = DOCUMENT_TYPE_LABEL[doc.document_type];
      await clearVerificationAfterMemberChange(tx, actor, input.documentId, member);
      await recordAudit(tx, {
        actor,
        member,
        action: "created",
        entityType: config.entity,
        documentType: doc.document_type,
        documentId: input.documentId,
        recordId: row.id,
        summary: `Added ${config.label}`,
        next: entrySnapshot(input.kind, row),
        notification: memberNotice(
          actor,
          member,
          input.kind === "hours" ? "hours.created" : "documentation.created",
          `${member?.fullName} added a ${config.label} to their ${documentLabel}.`,
          documentLink(doc.member_id, input.documentId, doc.document_type),
        ),
        realtime: ["member"],
      });
      return row.id;
    });
    return { ok: true, data: { id } };
  } catch (error) {
    return handleActionError(error, "createEntry");
  }
}

async function loadEntry(kind: EntryKind, entryId: string) {
  const config = ENTRY_CONFIG[kind];
  return sqlOne<{ id: string; document_id: string; member_id: string; document_type: DocumentType }>(
    `SELECT e.id, e.document_id, e.member_id, d.document_type
       FROM ${config.table} e JOIN member_documentation d ON d.id = e.document_id
      WHERE e.id = $1`,
    [entryId],
  );
}

export async function updateEntryAction(input: {
  entryId: string;
  kind: EntryKind;
  actingAs: ActingAs;
  values: Record<string, unknown>;
}): Promise<ActionResult<{ id: string }>> {
  try {
    if (!input || !isUuid(input.entryId) || !isEntryKind(input.kind) || !isActingAs(input.actingAs)) {
      return fail("Invalid request.", "invalid");
    }
    const config = ENTRY_CONFIG[input.kind];
    const entry = await loadEntry(input.kind, input.entryId);
    if (!entry) return fail("This entry no longer exists.", "not_found");
    const actor = await getActorFor(input.actingAs, entry.member_id);
    if (!actor) return UNAUTHORIZED;
    const values = validateEntry(input.kind, input.values);
    if (!values.ok) return fail(values.error, "invalid");

    await withTransaction(async (tx) => {
      const [before] = await tx.query<Record<string, unknown>>(`SELECT * FROM ${config.table} WHERE id = $1 FOR UPDATE`, [input.entryId]);
      if (!before) throw new ActionError("This entry no longer exists.", "not_found");
      const assignments = config.fields.map((field, index) => `${field} = $${index + 2}`).join(", ");
      const [after] = await tx.query<Record<string, unknown>>(
        `UPDATE ${config.table} SET ${assignments}, updated_at = now() WHERE id = $1 RETURNING *`,
        [input.entryId, ...config.fields.map((field) => values.value[field])],
      );
      await touchDocument(tx, entry.document_id, actor);
      const member = await loadMemberRef(tx, entry.member_id);
      const documentLabel = DOCUMENT_TYPE_LABEL[entry.document_type];
      await clearVerificationAfterMemberChange(tx, actor, entry.document_id, member);
      await recordAudit(tx, {
        actor,
        member,
        action: "edited",
        entityType: config.entity,
        documentType: entry.document_type,
        documentId: entry.document_id,
        recordId: entry.id,
        summary: `Edited ${config.label}`,
        previous: entrySnapshot(input.kind, before),
        next: entrySnapshot(input.kind, after),
        coalesce: true,
        notification: memberNotice(
          actor,
          member,
          input.kind === "hours" ? "hours.edited" : "documentation.edited",
          input.kind === "hours"
            ? `${member?.fullName} modified a volunteer-hours entry in their ${documentLabel}.`
            : `${member?.fullName} edited their ${documentLabel}.`,
          documentLink(entry.member_id, entry.document_id, entry.document_type),
        ),
        realtime: ["member"],
      });
    });
    return { ok: true, data: { id: input.entryId } };
  } catch (error) {
    return handleActionError(error, "updateEntry");
  }
}

export async function deleteEntryAction(input: {
  entryId: string;
  kind: EntryKind;
  actingAs: ActingAs;
}): Promise<ActionResult<null>> {
  try {
    if (!input || !isUuid(input.entryId) || !isEntryKind(input.kind) || !isActingAs(input.actingAs)) {
      return fail("Invalid request.", "invalid");
    }
    const config = ENTRY_CONFIG[input.kind];
    const entry = await loadEntry(input.kind, input.entryId);
    if (!entry) return { ok: true, data: null };
    const actor = await getActorFor(input.actingAs, entry.member_id);
    if (!actor) return UNAUTHORIZED;

    await withTransaction(async (tx) => {
      const [before] = await tx.query<Record<string, unknown>>(`DELETE FROM ${config.table} WHERE id = $1 RETURNING *`, [input.entryId]);
      if (!before) return;
      await touchDocument(tx, entry.document_id, actor);
      const member = await loadMemberRef(tx, entry.member_id);
      const documentLabel = DOCUMENT_TYPE_LABEL[entry.document_type];
      await clearVerificationAfterMemberChange(tx, actor, entry.document_id, member);
      await recordAudit(tx, {
        actor,
        member,
        action: "deleted",
        entityType: config.entity,
        documentType: entry.document_type,
        documentId: entry.document_id,
        recordId: entry.id,
        summary: `Deleted ${config.label}`,
        previous: entrySnapshot(input.kind, before),
        notification: memberNotice(
          actor,
          member,
          input.kind === "hours" ? "hours.deleted" : "documentation.deleted",
          `${member?.fullName} deleted a ${config.label} from their ${documentLabel}.`,
        ),
        realtime: ["member"],
      });
    });
    return { ok: true, data: null };
  } catch (error) {
    return handleActionError(error, "deleteEntry");
  }
}

/* ------------------------------- Whole documents -------------------------------- */

export async function createDocumentAction(input: {
  memberId: string;
  documentType: DocumentType;
  actingAs: ActingAs;
}): Promise<ActionResult<{ id: string }>> {
  try {
    if (!input || !isUuid(input.memberId) || !isDocumentType(input.documentType) || !isActingAs(input.actingAs)) {
      return fail("Invalid request.", "invalid");
    }
    const actor = await getActorFor(input.actingAs, input.memberId);
    if (!actor) return UNAUTHORIZED;
    const settings = await getSettings();

    const id = await withTransaction(async (tx) => {
      const member = await loadMemberRef(tx, input.memberId);
      if (!member) throw new ActionError("This member no longer exists.", "not_found");
      const [doc] = await tx.query<DocRow>(
        `INSERT INTO member_documentation (member_id, document_type, period, last_edited_by_type, last_edited_by_name)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [input.memberId, input.documentType, settings?.default_documentation_period ?? "", actor.type, actor.name],
      );
      const label = DOCUMENT_TYPE_LABEL[input.documentType];
      await recordAudit(tx, {
        actor,
        member,
        action: "created",
        entityType: "document",
        documentType: input.documentType,
        documentId: doc.id,
        recordId: doc.id,
        summary: `Created ${label} record`,
        next: headerSnapshot(doc),
        notification: memberNotice(
          actor,
          member,
          "documentation.created",
          `${member.fullName} created a new ${label} record.`,
          documentLink(input.memberId, doc.id, input.documentType),
        ),
        realtime: ["member"],
      });
      return doc.id;
    });
    return { ok: true, data: { id } };
  } catch (error) {
    return handleActionError(error, "createDocument");
  }
}

export async function deleteDocumentAction(input: { documentId: string; actingAs: ActingAs }): Promise<ActionResult<null>> {
  try {
    if (!input || !isUuid(input.documentId) || !isActingAs(input.actingAs)) return fail("Invalid request.", "invalid");
    const doc = await sqlOne<{ member_id: string }>("SELECT member_id FROM member_documentation WHERE id = $1", [input.documentId]);
    if (!doc) return { ok: true, data: null };
    const actor = await getActorFor(input.actingAs, doc.member_id);
    if (!actor) return UNAUTHORIZED;

    await withTransaction(async (tx) => {
      const [before] = await tx.query<DocRow>("SELECT * FROM member_documentation WHERE id = $1 FOR UPDATE", [input.documentId]);
      if (!before) return;
      // Verified hours are kept: only the administrator can delete a verified record.
      if (actor.type === "member" && before.verified_at) {
        throw new ActionError("This record has been verified by the administrator, so it can't be deleted. Ask the administrator if it needs to go.", "conflict");
      }
      const kind: EntryKind = before.document_type === "member_documentation" ? "contribution" : "hours";
      const config = ENTRY_CONFIG[kind];
      const children = await tx.query<Record<string, unknown>>(
        `SELECT * FROM ${config.table} WHERE document_id = $1 ORDER BY created_at, id`,
        [input.documentId],
      );
      const member = await loadMemberRef(tx, before.member_id);
      await tx.query("DELETE FROM member_documentation WHERE id = $1", [input.documentId]);
      const label = DOCUMENT_TYPE_LABEL[before.document_type];
      await recordAudit(tx, {
        actor,
        member,
        action: "deleted",
        entityType: "document",
        documentType: before.document_type,
        documentId: before.id,
        recordId: before.id,
        summary: `Deleted ${label} record`,
        previous: {
          ...headerSnapshot(before),
          [kind === "contribution" ? "contribution_entries" : "volunteer_hours"]: children.map((child) =>
            entrySnapshot(kind, child),
          ),
        },
        notification: memberNotice(actor, member, "documentation.deleted", `${member?.fullName} deleted a ${label} record.`),
        realtime: ["member"],
      });
    });
    return { ok: true, data: null };
  } catch (error) {
    return handleActionError(error, "deleteDocument");
  }
}
