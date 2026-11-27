import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { sql, sqlOne } from "./db";
import { getSettings, type SettingsRow } from "./settings";
import { randomToken, sha256 } from "./security";
import type { Actor } from "./audit";
import type { ActingAs } from "@/lib/types";

export type SessionKind = "site" | "member" | "admin";

export const SESSION_COOKIES: Record<SessionKind, string> = {
  site: "cps_site",
  member: "cps_member",
  admin: "cps_admin",
};

/** Absolute lifetime for member/admin sessions; idle timeouts come from settings. */
const ABSOLUTE_SESSION_HOURS = 12;

export type Viewer = {
  configured: boolean;
  /** May view the directory: holds a site, member, or administrator session. */
  siteAccess: boolean;
  hasSiteSession: boolean;
  admin: boolean;
  member: { id: string; fullName: string } | null;
};

export type SessionTokens = Partial<Record<SessionKind, string>>;

export async function getClientInfo(): Promise<{ ip: string; userAgent: string }> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = (forwarded || h.get("x-real-ip") || "local").slice(0, 64);
  return { ip, userAgent: (h.get("user-agent") ?? "").slice(0, 300) };
}

type SessionRow = {
  id: string;
  member_id: string | null;
  credential_version: number;
  expires_at: Date;
  last_seen_at: Date;
};

function isFresh(row: SessionRow, idleMinutes: number | null): boolean {
  const now = Date.now();
  if (new Date(row.expires_at).getTime() <= now) return false;
  if (idleMinutes !== null && now - new Date(row.last_seen_at).getTime() > idleMinutes * 60_000) return false;
  return true;
}

async function touch(row: SessionRow) {
  if (Date.now() - new Date(row.last_seen_at).getTime() > 30_000) {
    await sql("UPDATE sessions SET last_seen_at = now() WHERE id = $1", [row.id]);
  }
}

async function validateSiteOrAdmin(kind: "site" | "admin", token: string, settings: SettingsRow): Promise<boolean> {
  if (!token || token.length > 128) return false;
  const row = await sqlOne<SessionRow>(
    "SELECT id, member_id, credential_version, expires_at, last_seen_at FROM sessions WHERE token_hash = $1 AND kind = $2",
    [sha256(token), kind],
  );
  if (!row) return false;
  const version = kind === "site" ? settings.site_password_version : settings.admin_password_version;
  if (row.credential_version !== version) return false;
  if (!isFresh(row, kind === "admin" ? settings.admin_idle_minutes : null)) return false;
  await touch(row);
  return true;
}

async function validateMember(token: string, settings: SettingsRow): Promise<{ id: string; fullName: string } | null> {
  if (!token || token.length > 128) return null;
  const row = await sqlOne<SessionRow & { full_name: string; status: string; password_version: number }>(
    `SELECT s.id, s.member_id, s.credential_version, s.expires_at, s.last_seen_at,
            m.full_name, m.status, c.password_version
       FROM sessions s
       JOIN members m ON m.id = s.member_id
       JOIN member_credentials c ON c.member_id = s.member_id
      WHERE s.token_hash = $1 AND s.kind = 'member'`,
    [sha256(token)],
  );
  if (!row || !row.member_id) return null;
  if (row.status !== "active" || row.credential_version !== row.password_version) return null;
  if (!isFresh(row, settings.member_idle_minutes)) return null;
  await touch(row);
  return { id: row.member_id, fullName: row.full_name };
}

/** Resolves who is making a request from raw session tokens (used by the event stream too). */
export async function resolveViewer(tokens: SessionTokens): Promise<Viewer> {
  const settings = await getSettings();
  if (!settings) {
    return { configured: false, siteAccess: false, hasSiteSession: false, admin: false, member: null };
  }
  const site = tokens.site ? await validateSiteOrAdmin("site", tokens.site, settings) : false;
  const admin = tokens.admin ? await validateSiteOrAdmin("admin", tokens.admin, settings) : false;
  const member = tokens.member ? await validateMember(tokens.member, settings) : null;
  return {
    configured: true,
    hasSiteSession: site,
    admin,
    member,
    siteAccess: site || admin || member !== null,
  };
}

// Memoized per request and keyed by the token values, so a session created
// mid-request (login) is never confused with the state before it.
const resolveViewerCached = cache((site: string, member: string, admin: string) =>
  resolveViewer({ site: site || undefined, member: member || undefined, admin: admin || undefined }),
);

export async function getViewer(): Promise<Viewer> {
  const store = await cookies();
  return resolveViewerCached(
    store.get(SESSION_COOKIES.site)?.value ?? "",
    store.get(SESSION_COOKIES.member)?.value ?? "",
    store.get(SESSION_COOKIES.admin)?.value ?? "",
  );
}

export function parseSessionCookies(cookieHeader: string | null): SessionTokens {
  const tokens: SessionTokens = {};
  if (!cookieHeader) return tokens;
  for (const part of cookieHeader.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    const value = decodeURIComponent(part.slice(index + 1).trim());
    for (const kind of Object.keys(SESSION_COOKIES) as SessionKind[]) {
      if (SESSION_COOKIES[kind] === name) tokens[kind] = value;
    }
  }
  return tokens;
}

/* ----------------------------- Page guards ------------------------------ */

export async function requireSiteAccess(): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer.siteAccess) redirect("/login");
  return viewer;
}

export async function requireAdminPage(): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer.admin) redirect(viewer.siteAccess ? "/admin/login" : "/login");
  return viewer;
}

/* ---------------------------- Action guards ----------------------------- */

export async function getAdminActor(): Promise<Actor | null> {
  const viewer = await getViewer();
  if (!viewer.admin) return null;
  const settings = await getSettings();
  return { type: "admin", id: "admin", name: settings?.admin_display_name || "Administrator" };
}

/**
 * Determines the authenticated actor for a change to a member's records.
 * "member" requires that member's own session; "admin" requires the
 * administrator session. Client input can only choose between identities the
 * browser has actually authenticated as.
 */
export async function getActorFor(actingAs: ActingAs, memberId: string): Promise<Actor | null> {
  if (actingAs === "admin") return getAdminActor();
  const viewer = await getViewer();
  if (viewer.member && viewer.member.id === memberId) {
    return { type: "member", id: viewer.member.id, name: viewer.member.fullName };
  }
  return null;
}

/* --------------------------- Session lifecycle --------------------------- */

export async function startSession(kind: SessionKind, credentialVersion: number, memberId?: string) {
  const settings = await getSettings();
  const hours = kind === "site" ? (settings?.site_session_hours ?? 12) : ABSOLUTE_SESSION_HOURS;
  const token = randomToken();
  const expires = new Date(Date.now() + hours * 3_600_000);
  const { ip, userAgent } = await getClientInfo();
  const store = await cookies();

  const previous = store.get(SESSION_COOKIES[kind])?.value;
  if (previous) await sql("DELETE FROM sessions WHERE token_hash = $1", [sha256(previous)]);

  await sql(
    `INSERT INTO sessions (token_hash, kind, member_id, credential_version, expires_at, ip_address, user_agent)
     VALUES ($1, $2, $3::uuid, $4, $5::timestamptz, $6, $7)`,
    [sha256(token), kind, memberId ?? null, credentialVersion, expires.toISOString(), ip, userAgent],
  );
  store.set(SESSION_COOKIES[kind], token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production" && process.env.COOKIE_SECURE !== "false",
    sameSite: "lax",
    path: "/",
    expires,
  });

  // Housekeeping for expired state.
  await sql("DELETE FROM sessions WHERE expires_at < now()");
  await sql("DELETE FROM login_attempts WHERE attempted_at < now() - interval '2 days'");
  await sql("DELETE FROM realtime_events WHERE created_at < now() - interval '1 day'");
}

export async function endSession(kind: SessionKind) {
  const store = await cookies();
  const token = store.get(SESSION_COOKIES[kind])?.value;
  if (token) await sql("DELETE FROM sessions WHERE token_hash = $1 AND kind = $2", [sha256(token), kind]);
  store.delete(SESSION_COOKIES[kind]);
}
