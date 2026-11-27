"use server";

import { sql, withTransaction } from "@/lib/server/db";
import { getAdminActor, startSession } from "@/lib/server/auth";
import { recordAudit } from "@/lib/server/audit";
import { getSettings, type SettingsRow } from "@/lib/server/settings";
import { hashPassword, verifyPassword } from "@/lib/server/security";
import { cleanInteger, cleanLine, isUuid, LIMITS } from "@/lib/validation";
import type { ActionResult } from "@/lib/types";
import { ActionError, fail, handleActionError, UNAUTHORIZED } from "./shared";

/* --------------------------------- Departments ---------------------------------- */

export async function saveDepartmentAction(input: {
  id?: string | null;
  name: string;
  description: string;
  sortOrder: string | number;
}): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await getAdminActor();
    if (!actor) return UNAUTHORIZED;
    const name = cleanLine(input?.name, LIMITS.departmentName, "Department name", true);
    if (!name.ok) return fail(name.error, "invalid");
    const description = cleanLine(input?.description, LIMITS.departmentDescription, "Description");
    if (!description.ok) return fail(description.error, "invalid");
    const sortOrder = cleanInteger(input?.sortOrder ?? 0, 0, 999, "Display order");
    if (!sortOrder.ok) return fail(sortOrder.error, "invalid");
    if (input.id && !isUuid(input.id)) return fail("Invalid department.", "invalid");

    const id = await withTransaction(async (tx) => {
      if (input.id) {
        const [before] = await tx.query<{ name: string; description: string; sort_order: number }>(
          "SELECT name, description, sort_order FROM departments WHERE id = $1 FOR UPDATE",
          [input.id],
        );
        if (!before) throw new ActionError("This department no longer exists.", "not_found");
        await tx.query(
          "UPDATE departments SET name = $2, description = $3, sort_order = $4, updated_at = now() WHERE id = $1",
          [input.id, name.value, description.value, sortOrder.value],
        );
        await recordAudit(tx, {
          actor,
          action: "edited",
          entityType: "department",
          recordId: input.id,
          summary: `Updated department "${name.value}"`,
          previous: before,
          next: { name: name.value, description: description.value, sort_order: sortOrder.value },
          realtime: ["directory"],
        });
        return input.id;
      }
      const [created] = await tx.query<{ id: string }>(
        "INSERT INTO departments (name, description, sort_order) VALUES ($1, $2, $3) RETURNING id",
        [name.value, description.value, sortOrder.value],
      );
      await recordAudit(tx, {
        actor,
        action: "created",
        entityType: "department",
        recordId: created.id,
        summary: `Created department "${name.value}"`,
        next: { name: name.value, description: description.value, sort_order: sortOrder.value },
        realtime: ["directory"],
      });
      return created.id;
    });
    return { ok: true, data: { id } };
  } catch (error) {
    const result = handleActionError(error, "saveDepartment");
    return result.ok === false && result.code === "conflict" ? fail("A department with that name already exists.", "conflict") : result;
  }
}

export async function deleteDepartmentAction(id: string): Promise<ActionResult<null>> {
  try {
    const actor = await getAdminActor();
    if (!actor) return UNAUTHORIZED;
    if (!isUuid(id)) return fail("Invalid department.", "invalid");
    await withTransaction(async (tx) => {
      const [department] = await tx.query<{ name: string; description: string; sort_order: number }>(
        "SELECT name, description, sort_order FROM departments WHERE id = $1 FOR UPDATE",
        [id],
      );
      if (!department) return;
      const [{ count }] = await tx.query<{ count: number }>("SELECT count(*)::int AS count FROM members WHERE department_id = $1", [id]);
      if (count > 0) {
        throw new ActionError(
          `This department still has ${count} member${count === 1 ? "" : "s"} (including inactive). Move them to another department first.`,
          "conflict",
        );
      }
      await tx.query("DELETE FROM departments WHERE id = $1", [id]);
      await recordAudit(tx, {
        actor,
        action: "deleted",
        entityType: "department",
        recordId: id,
        summary: `Deleted department "${department.name}"`,
        previous: department,
        realtime: ["directory"],
      });
    });
    return { ok: true, data: null };
  } catch (error) {
    return handleActionError(error, "deleteDepartment");
  }
}

/* ---------------------------------- Positions ----------------------------------- */

export async function savePositionAction(input: {
  id?: string | null;
  name: string;
  sortOrder: string | number;
}): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await getAdminActor();
    if (!actor) return UNAUTHORIZED;
    const name = cleanLine(input?.name, LIMITS.positionName, "Position name", true);
    if (!name.ok) return fail(name.error, "invalid");
    const sortOrder = cleanInteger(input?.sortOrder ?? 0, 0, 999, "Display order");
    if (!sortOrder.ok) return fail(sortOrder.error, "invalid");
    if (input.id && !isUuid(input.id)) return fail("Invalid position.", "invalid");

    const id = await withTransaction(async (tx) => {
      if (input.id) {
        const [before] = await tx.query<{ name: string; sort_order: number }>(
          "SELECT name, sort_order FROM positions WHERE id = $1 FOR UPDATE",
          [input.id],
        );
        if (!before) throw new ActionError("This position no longer exists.", "not_found");
        await tx.query("UPDATE positions SET name = $2, sort_order = $3, updated_at = now() WHERE id = $1", [
          input.id,
          name.value,
          sortOrder.value,
        ]);
        await recordAudit(tx, {
          actor,
          action: "edited",
          entityType: "position",
          recordId: input.id,
          summary: `Updated position "${name.value}"`,
          previous: before,
          next: { name: name.value, sort_order: sortOrder.value },
          realtime: ["directory"],
        });
        return input.id;
      }
      const [created] = await tx.query<{ id: string }>(
        "INSERT INTO positions (name, sort_order) VALUES ($1, $2) RETURNING id",
        [name.value, sortOrder.value],
      );
      await recordAudit(tx, {
        actor,
        action: "created",
        entityType: "position",
        recordId: created.id,
        summary: `Created position "${name.value}"`,
        next: { name: name.value, sort_order: sortOrder.value },
        realtime: ["directory"],
      });
      return created.id;
    });
    return { ok: true, data: { id } };
  } catch (error) {
    const result = handleActionError(error, "savePosition");
    return result.ok === false && result.code === "conflict" ? fail("A position with that name already exists.", "conflict") : result;
  }
}

export async function deletePositionAction(id: string): Promise<ActionResult<null>> {
  try {
    const actor = await getAdminActor();
    if (!actor) return UNAUTHORIZED;
    if (!isUuid(id)) return fail("Invalid position.", "invalid");
    await withTransaction(async (tx) => {
      const [position] = await tx.query<{ name: string; sort_order: number }>(
        "SELECT name, sort_order FROM positions WHERE id = $1 FOR UPDATE",
        [id],
      );
      if (!position) return;
      const [{ count }] = await tx.query<{ count: number }>("SELECT count(*)::int AS count FROM members WHERE position_id = $1", [id]);
      if (count > 0) {
        throw new ActionError(
          `This position is assigned to ${count} member${count === 1 ? "" : "s"}. Reassign them before deleting it.`,
          "conflict",
        );
      }
      await tx.query("DELETE FROM positions WHERE id = $1", [id]);
      await recordAudit(tx, {
        actor,
        action: "deleted",
        entityType: "position",
        recordId: id,
        summary: `Deleted position "${position.name}"`,
        previous: position,
        realtime: ["directory"],
      });
    });
    return { ok: true, data: null };
  } catch (error) {
    return handleActionError(error, "deletePosition");
  }
}

/* --------------------------- Organization & preferences --------------------------- */

export async function updateOrganizationAction(input: {
  organizationName: string;
  chapterName: string;
  adminDisplayName: string;
  defaultDocumentationPeriod: string;
}): Promise<ActionResult<null>> {
  try {
    const actor = await getAdminActor();
    if (!actor) return UNAUTHORIZED;
    const organizationName = cleanLine(input?.organizationName, LIMITS.organizationName, "Organization name", true);
    if (!organizationName.ok) return fail(organizationName.error, "invalid");
    const chapterName = cleanLine(input?.chapterName, LIMITS.chapterName, "Chapter", true);
    if (!chapterName.ok) return fail(chapterName.error, "invalid");
    const adminDisplayName = cleanLine(input?.adminDisplayName, LIMITS.fullName, "Administrator display name", true);
    if (!adminDisplayName.ok) return fail(adminDisplayName.error, "invalid");
    const period = cleanLine(input?.defaultDocumentationPeriod, LIMITS.period, "Default documentation period");
    if (!period.ok) return fail(period.error, "invalid");

    await withTransaction(async (tx) => {
      const [before] = await tx.query<Pick<SettingsRow, "organization_name" | "chapter_name" | "admin_display_name" | "default_documentation_period">>(
        "SELECT organization_name, chapter_name, admin_display_name, default_documentation_period FROM application_settings WHERE id = 1 FOR UPDATE",
      );
      const next = {
        organization_name: organizationName.value,
        chapter_name: chapterName.value,
        admin_display_name: adminDisplayName.value,
        default_documentation_period: period.value,
      };
      await tx.query(
        `UPDATE application_settings
            SET organization_name = $1, chapter_name = $2, admin_display_name = $3, default_documentation_period = $4, updated_at = now()
          WHERE id = 1`,
        [next.organization_name, next.chapter_name, next.admin_display_name, next.default_documentation_period],
      );
      await recordAudit(tx, {
        actor,
        action: "edited",
        entityType: "settings",
        recordId: "organization",
        summary: "Updated organization information",
        previous: before,
        next,
        realtime: ["directory"],
      });
    });
    return { ok: true, data: null };
  } catch (error) {
    return handleActionError(error, "updateOrganization");
  }
}

export async function updatePreferencesAction(input: {
  siteSessionHours: string | number;
  memberIdleMinutes: string | number;
  adminIdleMinutes: string | number;
}): Promise<ActionResult<null>> {
  try {
    const actor = await getAdminActor();
    if (!actor) return UNAUTHORIZED;
    const site = cleanInteger(input?.siteSessionHours, 1, 168, "Directory session length");
    if (!site.ok) return fail(site.error, "invalid");
    const member = cleanInteger(input?.memberIdleMinutes, 5, 720, "Member idle timeout");
    if (!member.ok) return fail(member.error, "invalid");
    const admin = cleanInteger(input?.adminIdleMinutes, 5, 720, "Administrator idle timeout");
    if (!admin.ok) return fail(admin.error, "invalid");

    await withTransaction(async (tx) => {
      const [before] = await tx.query(
        "SELECT site_session_hours, member_idle_minutes, admin_idle_minutes FROM application_settings WHERE id = 1 FOR UPDATE",
      );
      const next = { site_session_hours: site.value, member_idle_minutes: member.value, admin_idle_minutes: admin.value };
      await tx.query(
        `UPDATE application_settings SET site_session_hours = $1, member_idle_minutes = $2, admin_idle_minutes = $3, updated_at = now() WHERE id = 1`,
        [next.site_session_hours, next.member_idle_minutes, next.admin_idle_minutes],
      );
      await recordAudit(tx, {
        actor,
        action: "edited",
        entityType: "settings",
        recordId: "preferences",
        summary: "Updated session preferences",
        previous: before,
        next,
      });
    });
    return { ok: true, data: null };
  } catch (error) {
    return handleActionError(error, "updatePreferences");
  }
}

/* -------------------------------- Password changes -------------------------------- */

function checkNewPassword(password: unknown, confirm: unknown, minLength: number): string | null {
  if (typeof password !== "string" || typeof confirm !== "string") return "Enter the new password twice.";
  if (password.length < minLength) return `The new password must be at least ${minLength} characters.`;
  if (password.length > 200) return "The new password must be 200 characters or fewer.";
  if (password !== confirm) return "The two passwords do not match.";
  return null;
}

/** Changes only the shared website password. Member and administrator passwords are untouched. */
export async function changeSitePasswordAction(input: { newPassword: string; confirmPassword: string }): Promise<ActionResult<null>> {
  try {
    const actor = await getAdminActor();
    if (!actor) return UNAUTHORIZED;
    const problem = checkNewPassword(input?.newPassword, input?.confirmPassword, 8);
    if (problem) return fail(problem, "invalid");
    const settings = await getSettings();
    if (!settings) return fail("Settings are unavailable.");
    if (await verifyPassword(input.newPassword, settings.admin_password_hash)) {
      return fail("The shared website password must be different from the administrator password.", "invalid");
    }
    const hash = await hashPassword(input.newPassword);
    await withTransaction(async (tx) => {
      await tx.query(
        `UPDATE application_settings
            SET site_password_hash = $1, site_password_version = site_password_version + 1,
                site_password_changed_at = now(), updated_at = now()
          WHERE id = 1`,
        [hash],
      );
      // Directory-only sessions must re-enter the new shared password.
      await tx.query("DELETE FROM sessions WHERE kind = 'site'");
      await recordAudit(tx, {
        actor,
        action: "password_reset",
        entityType: "settings",
        recordId: "site_password",
        summary: "Changed the shared website password",
        next: { site_password: "Changed (not stored in readable form)" },
        notification: {
          type: "settings.site_password",
          description: `${actor.name} changed the shared website password. Existing directory sessions were signed out.`,
        },
        realtime: ["directory"],
      });
    });
    return { ok: true, data: null };
  } catch (error) {
    return handleActionError(error, "changeSitePassword");
  }
}

/** Changes only the administrator password. Shared and member passwords are untouched. */
export async function changeAdminPasswordAction(input: {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}): Promise<ActionResult<null>> {
  try {
    const actor = await getAdminActor();
    if (!actor) return UNAUTHORIZED;
    const settings = await getSettings();
    if (!settings) return fail("Settings are unavailable.");
    if (typeof input?.currentPassword !== "string" || !(await verifyPassword(input.currentPassword, settings.admin_password_hash))) {
      return fail("The current administrator password is incorrect.", "invalid");
    }
    const problem = checkNewPassword(input.newPassword, input.confirmPassword, 10);
    if (problem) return fail(problem, "invalid");
    if (await verifyPassword(input.newPassword, settings.site_password_hash)) {
      return fail("The administrator password must be different from the shared website password.", "invalid");
    }
    const hash = await hashPassword(input.newPassword);
    const version = await withTransaction(async (tx) => {
      const [row] = await tx.query<{ admin_password_version: number }>(
        `UPDATE application_settings
            SET admin_password_hash = $1, admin_password_version = admin_password_version + 1,
                admin_password_changed_at = now(), updated_at = now()
          WHERE id = 1
          RETURNING admin_password_version`,
        [hash],
      );
      await tx.query("DELETE FROM sessions WHERE kind = 'admin'");
      await recordAudit(tx, {
        actor,
        action: "password_reset",
        entityType: "settings",
        recordId: "admin_password",
        summary: "Changed the administrator password",
        next: { admin_password: "Changed (not stored in readable form)" },
        notification: {
          type: "settings.admin_password",
          description: `${actor.name} changed the administrator password. Other administrator sessions were signed out.`,
        },
      });
      return row.admin_password_version;
    });
    // Keep the current administrator signed in with a fresh session.
    await startSession("admin", version);
    return { ok: true, data: null };
  } catch (error) {
    return handleActionError(error, "changeAdminPassword");
  }
}

/* --------------------------------- Notifications ---------------------------------- */

export async function markNotificationReadAction(id: number): Promise<ActionResult<null>> {
  const actor = await getAdminActor();
  if (!actor) return UNAUTHORIZED;
  if (!Number.isSafeInteger(id) || id <= 0) return fail("Invalid notification.", "invalid");
  await withTransaction(async (tx) => {
    await tx.query("UPDATE notifications SET read_at = now() WHERE id = $1 AND read_at IS NULL", [id]);
    await tx.query("INSERT INTO realtime_events (scope) VALUES ('admin')");
  });
  return { ok: true, data: null };
}

export async function markAllNotificationsReadAction(): Promise<ActionResult<null>> {
  const actor = await getAdminActor();
  if (!actor) return UNAUTHORIZED;
  await withTransaction(async (tx) => {
    await tx.query("UPDATE notifications SET read_at = now() WHERE read_at IS NULL");
    await tx.query("INSERT INTO realtime_events (scope) VALUES ('admin')");
  });
  return { ok: true, data: null };
}

export async function markNotificationUnreadAction(id: number): Promise<ActionResult<null>> {
  const actor = await getAdminActor();
  if (!actor) return UNAUTHORIZED;
  if (!Number.isSafeInteger(id) || id <= 0) return fail("Invalid notification.", "invalid");
  await sql("UPDATE notifications SET read_at = NULL WHERE id = $1", [id]);
  return { ok: true, data: null };
}
