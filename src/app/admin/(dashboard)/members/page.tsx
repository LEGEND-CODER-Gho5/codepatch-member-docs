import type { Metadata } from "next";
import { AddMemberTrigger } from "@/components/admin/admin-shell";
import { MembersTable } from "@/components/admin/members-table";
import { PageHeader } from "@/components/ui/primitives";
import { requireAdminPage } from "@/lib/server/auth";
import { listDepartments, listMembers, listPositions } from "@/lib/server/queries";

export const metadata: Metadata = { title: "Member Management" };

export default async function MembersPage() {
  await requireAdminPage();
  const [members, departments, positions] = await Promise.all([listMembers(), listDepartments(), listPositions()]);

  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="Member Management"
        description="Every registered member, including inactive accounts. Open a member to see their profile, documentation, and activity."
        actions={<AddMemberTrigger />}
      />
      <MembersTable
        members={members.map((member) => ({
          id: member.id,
          memberCode: member.memberCode,
          fullName: member.fullName,
          email: member.email,
          status: member.status,
          startDate: member.startDate,
          departmentId: member.departmentId,
          departmentName: member.departmentName,
          positionId: member.positionId,
          positionName: member.positionName,
          hoursTotal: member.hoursTotal,
          contributionCount: member.contributionCount + member.hoursEntryCount,
          lastActivityAt: member.lastActivityAt,
        }))}
        departments={departments.map((department) => ({ id: department.id, name: department.name }))}
        positions={positions.map((position) => ({ id: position.id, name: position.name }))}
      />
    </>
  );
}
