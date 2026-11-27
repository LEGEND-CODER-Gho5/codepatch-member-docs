import type { Metadata } from "next";
import { PositionsManager } from "@/components/admin/catalog-manager";
import {
  AdminPasswordForm,
  MemberPasswordReset,
  OrganizationForm,
  PreferencesForm,
  SitePasswordForm,
} from "@/components/admin/settings-forms";
import { PageHeader, Panel } from "@/components/ui/primitives";
import { formatDateTime } from "@/lib/format";
import { requireAdminPage } from "@/lib/server/auth";
import { listMembers, listPositions } from "@/lib/server/queries";
import { getSettings } from "@/lib/server/settings";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  await requireAdminPage();
  const [settings, positions, members] = await Promise.all([getSettings(), listPositions(), listMembers()]);
  if (!settings) return null;

  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="Settings"
        description="The three password systems are independent: changing one never affects the others."
      />
      <div className="grid gap-6 2xl:grid-cols-2">
        <Panel title="Organization information" description="Used in document headers, notifications, and the interface" className="2xl:col-span-2">
          <OrganizationForm
            initial={{
              organizationName: settings.organization_name,
              chapterName: settings.chapter_name,
              adminDisplayName: settings.admin_display_name,
              defaultDocumentationPeriod: settings.default_documentation_period,
            }}
          />
        </Panel>

        <Panel title="Shared website password" description="Opens the member directory for anyone who knows it">
          <SitePasswordForm changedAt={formatDateTime(settings.site_password_changed_at)} />
        </Panel>

        <Panel title="Administrator password" description="Grants full administrative access">
          <AdminPasswordForm changedAt={formatDateTime(settings.admin_password_changed_at)} />
        </Panel>

        <Panel title="Member passwords" description="Issue a new personal password for one member">
          <MemberPasswordReset
            members={members.map((member) => ({
              id: member.id,
              fullName: member.fullName,
              departmentName: member.departmentName,
              status: member.status,
            }))}
          />
        </Panel>

        <Panel title="Positions" description="Options available in the Position/Role field">
          <PositionsManager
            positions={positions.map((position) => ({
              id: position.id,
              name: position.name,
              sortOrder: position.sortOrder,
              memberCount: position.memberCount,
            }))}
          />
        </Panel>

        <Panel title="Session preferences" description="Sign-in duration and inactivity timeouts" className="2xl:col-span-2">
          <PreferencesForm
            initial={{
              siteSessionHours: settings.site_session_hours,
              memberIdleMinutes: settings.member_idle_minutes,
              adminIdleMinutes: settings.admin_idle_minutes,
            }}
          />
        </Panel>
      </div>
    </>
  );
}
