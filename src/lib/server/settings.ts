import "server-only";
import { cache } from "react";
import { sqlOne } from "./db";
import { bootstrapIfPossible } from "./bootstrap";
import { DEFAULT_CHAPTER_NAME, DEFAULT_ORGANIZATION_NAME } from "@/lib/document-text";
import type { OrgInfo } from "@/lib/types";

export type SettingsRow = {
  organization_name: string;
  chapter_name: string;
  admin_display_name: string;
  default_documentation_period: string;
  site_password_hash: string;
  site_password_version: number;
  site_password_changed_at: Date;
  admin_password_hash: string;
  admin_password_version: number;
  admin_password_changed_at: Date;
  site_session_hours: number;
  member_idle_minutes: number;
  admin_idle_minutes: number;
  updated_at: Date;
};

async function loadSettings(): Promise<SettingsRow | null> {
  const row = await sqlOne<SettingsRow>("SELECT * FROM application_settings WHERE id = 1");
  if (row) return row;
  if (await bootstrapIfPossible()) {
    return sqlOne<SettingsRow>("SELECT * FROM application_settings WHERE id = 1");
  }
  return null;
}

/** Per-request memoized settings (includes password hashes — never send to the client). */
export const getSettings = cache(loadSettings);

export async function getOrgInfo(): Promise<OrgInfo> {
  const settings = await getSettings();
  return {
    organizationName: settings?.organization_name || DEFAULT_ORGANIZATION_NAME,
    chapterName: settings?.chapter_name || DEFAULT_CHAPTER_NAME,
    adminDisplayName: settings?.admin_display_name || "Chapter Administrator",
  };
}
