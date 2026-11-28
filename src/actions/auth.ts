"use server";

import { redirect } from "next/navigation";
import { sql, sqlOne, withTransaction } from "@/lib/server/db";
import { acceptSiteRules, endSession, getActorFor, getClientInfo, getViewer, startSession } from "@/lib/server/auth";
import { getSettings } from "@/lib/server/settings";
import { hashPassword, verifyPassword } from "@/lib/server/security";
import { checkLoginThrottle, failureDelay, recordLoginAttempt } from "@/lib/server/rate-limit";
import { loadMemberRef, recordAudit } from "@/lib/server/audit";
import type { ActionResult } from "@/lib/types";
import { isUuid, MEMBER_PASSWORD_MIN_LENGTH } from "@/lib/validation";
import { fail, handleActionError, UNAUTHORIZED } from "./shared";

export type LoginState = { error: string | null };

function readPassword(formData: FormData): string {
  const value = formData.get("password");
  return typeof value === "string" ? value : "";
}

function safeNext(value: FormDataEntryValue | null, fallback: string): string {
  const next = typeof value === "string" ? value : "";
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/api") || next.length > 200) return fallback;
  return /^\/[A-Za-z0-9\-._~/?=&%]*$/.test(next) ? next : fallback;
}

function lockedMessage(minutes: number) {
  return `Too many unsuccessful attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
}

/* ------------------------- A. Shared website password ------------------------ */

export async function siteLoginAction(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const password = readPassword(formData);
  if (!password) return { error: "Enter the chapter access password." };
  const settings = await getSettings();
  if (!settings) return { error: "The system has not been configured yet. Contact the chapter administrator." };

  const { ip } = await getClientInfo();
  const throttle = await checkLoginThrottle("site", "site", ip);
  if (!throttle.allowed) return { error: lockedMessage(throttle.retryAfterMinutes) };

  const valid = password.length <= 200 && (await verifyPassword(password, settings.site_password_hash));
  await recordLoginAttempt("site", "site", ip, valid);
  if (!valid) {
    await failureDelay();
    return { error: "That password is incorrect. Please try again." };
  }

  await startSession("site", settings.site_password_version);
  // Every visit starts with the portal guide and the policies and procedures.
  const next = safeNext(formData.get("next"), "/directory");
  redirect(next === "/directory" ? "/welcome" : `/welcome?next=${encodeURIComponent(next)}`);
}

/* ---------------------- Policies and procedures (welcome) --------------------- */

export async function acceptRulesAction(formData: FormData): Promise<void> {
  const next = safeNext(formData.get("next"), "/directory");
  const back = next === "/directory" ? "/welcome" : `/welcome?next=${encodeURIComponent(next)}`;
  const settings = await getSettings();
  if (!settings) redirect("/login");
  // The version the visitor read; if the policies changed meanwhile, show the new text instead.
  const shownVersion = Number(formData.get("version"));
  if (formData.get("agree") !== "yes" || shownVersion !== settings.site_rules_version) redirect(back);
  if (!(await acceptSiteRules(shownVersion))) redirect("/login");
  redirect(next);
}

/* ------------------------ B. Individual member passwords ---------------------- */

export async function memberLoginAction(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const memberId = formData.get("memberId");
  if (!isUuid(memberId)) return { error: "This member could not be found." };

  const viewer = await getViewer();
  if (!viewer.siteAccess) redirect("/login");
  if (viewer.rulesPending) redirect("/welcome");

  const password = readPassword(formData);
  if (!password) return { error: "Enter your personal documentation password." };

  const member = await sqlOne<{ id: string; status: string; password_hash: string; password_version: number }>(
    `SELECT m.id, m.status, c.password_hash, c.password_version
       FROM members m JOIN member_credentials c ON c.member_id = m.id
      WHERE m.id = $1`,
    [memberId],
  );
  if (!member || member.status !== "active") {
    await verifyPassword(password, null);
    return { error: "This member account is not active. Contact the chapter administrator." };
  }

  const { ip } = await getClientInfo();
  const throttle = await checkLoginThrottle("member", memberId, ip);
  if (!throttle.allowed) return { error: lockedMessage(throttle.retryAfterMinutes) };

  const valid = password.length <= 200 && (await verifyPassword(password, member.password_hash));
  const { lockedNow } = await recordLoginAttempt("member", memberId, ip, valid);
  if (!valid) {
    if (lockedNow) {
      await withTransaction(async (tx) => {
        const ref = await loadMemberRef(tx, memberId);
        await recordAudit(tx, {
          actor: { type: "system", id: null, name: "System" },
          member: ref,
          action: "locked_out",
          entityType: "security",
          recordId: memberId,
          summary: "Temporarily locked documentation sign-in after repeated incorrect passwords",
          next: { ip_address: ip },
          notification: {
            type: "security.lockout",
            description: `Repeated incorrect password attempts locked sign-in to ${ref?.fullName ?? "a member"}'s documentation for 15 minutes.`,
          },
        });
      });
    }
    await failureDelay();
    return { error: "That password is incorrect. Please try again." };
  }

  await sql("UPDATE member_credentials SET last_login_at = now() WHERE member_id = $1", [memberId]);
  await startSession("member", member.password_version, memberId);
  redirect(`/members/${memberId}`);
}

/**
 * A signed-in member changes their own documentation password. Only the
 * password changes: records, hours, and verification are untouched, and the
 * administrator never needs member passwords (records open from the admin
 * dashboard). The current password is required and counts toward the same
 * sign-in lock as the sign-in page. Other sessions for this member end; this
 * device stays signed in. Edit History records it and the administrator is
 * notified. If a member forgets it, Reset password still issues a new one.
 */
export async function changeMemberPasswordAction(input: {
  memberId: string;
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}): Promise<ActionResult<null>> {
  try {
    if (!input || !isUuid(input.memberId)) return fail("Invalid request.", "invalid");
    const memberId = input.memberId;
    // Only the member themselves, signed in to their documentation.
    const actor = await getActorFor("member", memberId);
    if (!actor) return UNAUTHORIZED;

    const member = await sqlOne<{ status: string; password_hash: string }>(
      `SELECT m.status, c.password_hash
         FROM members m JOIN member_credentials c ON c.member_id = m.id
        WHERE m.id = $1`,
      [memberId],
    );
    if (!member || member.status !== "active") return fail("This member account is not active.", "invalid");

    const { ip } = await getClientInfo();
    const throttle = await checkLoginThrottle("member", memberId, ip);
    if (!throttle.allowed) return fail(lockedMessage(throttle.retryAfterMinutes), "invalid");

    const current = typeof input.currentPassword === "string" ? input.currentPassword : "";
    const valid = current.length > 0 && current.length <= 200 && (await verifyPassword(current, member.password_hash));
    if (!valid) {
      await recordLoginAttempt("member", memberId, ip, false);
      await failureDelay();
      return fail("Your current password is incorrect.", "invalid");
    }

    const next = typeof input.newPassword === "string" ? input.newPassword : "";
    if (next.length < MEMBER_PASSWORD_MIN_LENGTH) return fail(`Your new password must be at least ${MEMBER_PASSWORD_MIN_LENGTH} characters.`, "invalid");
    if (next.length > 200) return fail("Your new password must be 200 characters or fewer.", "invalid");
    if (next !== input.confirmPassword) return fail("The two new passwords do not match.", "invalid");
    if (next === current) return fail("Choose a password that is different from your current one.", "invalid");
    if (/^(.)\1+$/.test(next) || /^(?:0?123456789?0?|password\d*|codepatch\w*)$/i.test(next)) {
      return fail("That password is too easy to guess. Try a short phrase only you would know.", "invalid");
    }
    // Never the shared chapter password (everyone in the chapter knows it) or the administrator password.
    const settings = await getSettings();
    if (settings && ((await verifyPassword(next, settings.site_password_hash)) || (await verifyPassword(next, settings.admin_password_hash)))) {
      return fail("Your password can't be the shared chapter password. Choose one only you know.", "invalid");
    }

    const hash = await hashPassword(next);
    const version = await withTransaction(async (tx) => {
      const [row] = await tx.query<{ password_version: number }>(
        `UPDATE member_credentials
            SET password_hash = $2, password_version = password_version + 1, password_changed_at = now()
          WHERE member_id = $1
          RETURNING password_version`,
        [memberId, hash],
      );
      // Sign-ins on other devices end; this one gets a fresh session below.
      await tx.query("DELETE FROM sessions WHERE member_id = $1", [memberId]);
      await tx.query("DELETE FROM login_attempts WHERE scope = 'member' AND target = $1", [memberId]);
      const ref = await loadMemberRef(tx, memberId);
      await recordAudit(tx, {
        actor,
        member: ref,
        action: "password_reset",
        entityType: "member",
        recordId: memberId,
        summary: "Changed their own documentation password",
        next: { password: "Changed by the member (not stored in readable form)" },
        notification: {
          type: "member.password_reset",
          description: `${ref?.fullName ?? "A member"} changed their documentation password.`,
          link: `/admin/members/${memberId}`,
        },
        realtime: ["member"],
      });
      return row.password_version;
    });
    await startSession("member", version, memberId);
    return { ok: true, data: null };
  } catch (error) {
    return handleActionError(error, "changeMemberPassword");
  }
}

/* --------------------------- C. Administrator password ------------------------ */

export async function adminLoginAction(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const viewer = await getViewer();
  if (!viewer.siteAccess) redirect("/login");
  if (viewer.rulesPending) redirect("/welcome?next=/admin/login");

  const password = readPassword(formData);
  if (!password) return { error: "Enter the administrator password." };
  const settings = await getSettings();
  if (!settings) return { error: "The system has not been configured yet." };

  const { ip } = await getClientInfo();
  const throttle = await checkLoginThrottle("admin", "admin", ip);
  if (!throttle.allowed) return { error: lockedMessage(throttle.retryAfterMinutes) };

  const valid = password.length <= 200 && (await verifyPassword(password, settings.admin_password_hash));
  const { lockedNow } = await recordLoginAttempt("admin", "admin", ip, valid);
  if (!valid) {
    if (lockedNow) {
      await withTransaction(async (tx) => {
        await recordAudit(tx, {
          actor: { type: "system", id: null, name: "System" },
          action: "locked_out",
          entityType: "security",
          recordId: "admin",
          summary: "Temporarily locked administrator sign-in after repeated incorrect passwords",
          next: { ip_address: ip },
          notification: {
            type: "security.lockout",
            description: "Repeated incorrect administrator password attempts locked administrator sign-in for 15 minutes.",
          },
        });
      });
    }
    await failureDelay();
    return { error: "That password is incorrect. Please try again." };
  }

  await startSession("admin", settings.admin_password_version);
  redirect(safeNext(formData.get("next"), "/admin"));
}

/* ----------------------------------- Sign out ---------------------------------- */

export async function memberLogoutAction() {
  await endSession("member");
  redirect("/directory");
}

export async function adminLogoutAction() {
  await endSession("admin");
  redirect("/directory");
}

/** Leaves the site entirely: ends directory, member, and administrator sessions. */
export async function exitSiteAction() {
  await endSession("member");
  await endSession("admin");
  await endSession("site");
  redirect("/login");
}
