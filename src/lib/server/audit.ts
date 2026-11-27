import "server-only";
import type { Queryable } from "./db";
import { emitRealtime, type RealtimeScope } from "./realtime";
import type { ActorType, DocumentType } from "@/lib/types";

export type Actor = { type: ActorType; id: string | null; name: string };

export type MemberRef = {
  id: string;
  fullName: string;
  departmentId: string | null;
  departmentName: string | null;
};

export type AuditInput = {
  actor: Actor;
  member?: MemberRef | null;
  action: string;
  entityType: string;
  documentType?: DocumentType | null;
  documentId?: string | null;
  recordId?: string | null;
  summary: string;
  previous?: unknown;
  next?: unknown;
  /** Merge consecutive autosaves by the same actor on the same record into one entry. */
  coalesce?: boolean;
  notification?: {
    type: string;
    description: string;
    link?: string | ((auditId: number) => string);
  } | null;
  realtime?: RealtimeScope[];
};

/** A save merges into the actor's latest entry for the record only if that entry was last extended within this window… */
const COALESCE_WINDOW = "10 minutes";
/**
 * …and only until the entry's first save is this old; the next save then starts
 * a new entry. The audit_logs_protect() trigger enforces the same limit
 * (migration 3). Both use now(), which is fixed for the whole transaction, so
 * the lookup below and the trigger always agree.
 */
const COALESCE_MAX_SPAN = "30 minutes";

export function stableStringify(value: unknown): string {
  return JSON.stringify(value ?? null, (_key, entry) =>
    entry && typeof entry === "object" && !Array.isArray(entry)
      ? Object.fromEntries(Object.entries(entry as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : entry,
  );
}

function toJson(value: unknown): string | null {
  return value === null || value === undefined ? null : JSON.stringify(value);
}

export async function loadMemberRef(q: Queryable, memberId: string): Promise<MemberRef | null> {
  const [row] = await q.query<{ id: string; full_name: string; department_id: string; department_name: string }>(
    `SELECT m.id, m.full_name, m.department_id, d.name AS department_name
       FROM members m JOIN departments d ON d.id = m.department_id
      WHERE m.id = $1`,
    [memberId],
  );
  return row
    ? { id: row.id, fullName: row.full_name, departmentId: row.department_id, departmentName: row.department_name }
    : null;
}

/**
 * Writes an append-only audit record (and optional admin notification and
 * realtime event) inside the caller's transaction. The actor always comes from
 * the authenticated server-side session, never from client input.
 */
export async function recordAudit(tx: Queryable, input: AuditInput): Promise<number | null> {
  const previous = input.previous ?? null;
  const next = input.next ?? null;
  if (input.action === "edited" && stableStringify(previous) === stableStringify(next)) return null;

  const scopes = new Set<RealtimeScope>(input.realtime ?? []);
  scopes.add("admin");
  const memberId = input.member?.id ?? null;

  if (input.coalesce && input.recordId) {
    const [last] = await tx.query<{ id: number; actor_type: string; actor_id: string | null; action: string; open: boolean }>(
      `SELECT id, actor_type, actor_id, action,
              last_occurred_at > now() - interval '${COALESCE_WINDOW}'
                AND occurred_at > now() - interval '${COALESCE_MAX_SPAN}' AS open
         FROM audit_logs
        WHERE entity_type = $1 AND record_id = $2
        ORDER BY id DESC
        LIMIT 1`,
      [input.entityType, input.recordId],
    );
    if (
      last &&
      last.open &&
      last.actor_type === input.actor.type &&
      (last.actor_id ?? null) === (input.actor.id ?? null) &&
      (last.action === "edited" || (last.action === "created" && input.entityType !== "document"))
    ) {
      await tx.query(
        `UPDATE audit_logs
            SET new_values = $2::jsonb, last_occurred_at = now(), revision_count = revision_count + 1
          WHERE id = $1`,
        [last.id, toJson(next)],
      );
      await tx.query(`UPDATE notifications SET updated_at = now(), read_at = NULL WHERE audit_log_id = $1`, [last.id]);
      await emitRealtime(tx, scopes, memberId);
      return Number(last.id);
    }
  }

  const [inserted] = await tx.query<{ id: number }>(
    `INSERT INTO audit_logs (
        actor_type, actor_id, actor_name, member_id, member_name, department_id, department_name,
        action, entity_type, document_type, document_id, record_id, summary, previous_values, new_values)
     VALUES ($1, $2, $3, $4::uuid, $5, $6::uuid, $7, $8, $9, $10, $11::uuid, $12, $13, $14::jsonb, $15::jsonb)
     RETURNING id`,
    [
      input.actor.type,
      input.actor.id,
      input.actor.name,
      memberId,
      input.member?.fullName ?? null,
      input.member?.departmentId ?? null,
      input.member?.departmentName ?? null,
      input.action,
      input.entityType,
      input.documentType ?? null,
      input.documentId ?? null,
      input.recordId ?? null,
      input.summary,
      toJson(previous),
      toJson(next),
    ],
  );
  const auditId = Number(inserted.id);

  if (input.notification) {
    const { link } = input.notification;
    await tx.query(
      `INSERT INTO notifications (type, audit_log_id, member_id, member_name, department_name, actor_type, actor_id, actor_name, description, link)
       VALUES ($1, $2, $3::uuid, $4, $5, $6, $7, $8, $9, $10)`,
      [
        input.notification.type,
        auditId,
        memberId,
        input.member?.fullName ?? null,
        input.member?.departmentName ?? null,
        input.actor.type,
        input.actor.id,
        input.actor.name,
        input.notification.description,
        typeof link === "function" ? link(auditId) : (link ?? `/admin/history/${auditId}`),
      ],
    );
  }

  await emitRealtime(tx, scopes, memberId);
  return auditId;
}
