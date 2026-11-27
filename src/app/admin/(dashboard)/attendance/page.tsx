import type { Metadata } from "next";
import { AttendanceForm, MeetingsList } from "@/components/admin/attendance-manager";
import { PageHeader, Panel } from "@/components/ui/primitives";
import { requireAdminPage } from "@/lib/server/auth";
import { listDepartments, listMeetings, listMembers } from "@/lib/server/queries";

export const metadata: Metadata = { title: "Attendance" };

export default async function AttendancePage() {
  await requireAdminPage();
  const [members, departments, meetings] = await Promise.all([listMembers(), listDepartments(), listMeetings()]);

  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="Attendance"
        description="Take attendance for a meeting. Submitting adds the meeting's hours to every present member's Volunteer Hours Record, minus any hours you subtract."
      />
      <div className="space-y-6">
        <Panel title="Record attendance" description="Tick who attended. Use Subtract for anyone who should get fewer hours.">
          <AttendanceForm
            members={members
              .filter((member) => member.status === "active")
              .map((member) => ({
                id: member.id,
                fullName: member.fullName,
                departmentName: member.departmentName,
                departmentIds: [member.departmentId, ...member.otherDepartments.map((other) => other.id)],
              }))}
            departments={departments.map((department) => ({ id: department.id, name: department.name }))}
          />
        </Panel>
        <Panel title="Past meetings" description="Open a meeting to change someone's hours or delete it. Changes update their records.">
          <MeetingsList
            meetings={meetings.map((meeting) => ({
              id: meeting.id,
              name: meeting.name,
              date: meeting.date,
              hours: meeting.hours,
              recordedBy: meeting.recordedBy,
              attendees: meeting.attendees,
            }))}
          />
        </Panel>
      </div>
    </>
  );
}
