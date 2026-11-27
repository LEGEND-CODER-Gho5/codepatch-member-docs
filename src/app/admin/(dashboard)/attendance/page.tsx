import type { Metadata } from "next";
import { AttendanceForm, LiveMeeting, MeetingsList, type AttendanceMeeting } from "@/components/admin/attendance-manager";
import { PageHeader, Panel } from "@/components/ui/primitives";
import { requireAdminPage } from "@/lib/server/auth";
import { getLiveMeeting, listDepartments, listMeetings, listMembers, type MeetingRow } from "@/lib/server/queries";

export const metadata: Metadata = { title: "Attendance" };

const toClient = (meeting: MeetingRow): AttendanceMeeting => ({
  id: meeting.id,
  name: meeting.name,
  date: meeting.date,
  hours: meeting.hours,
  startedAt: meeting.startedAt,
  endedAt: meeting.endedAt,
  recordedBy: meeting.recordedBy,
  attendees: meeting.attendees,
});

export default async function AttendancePage() {
  await requireAdminPage();
  const [members, departments, meetings, live] = await Promise.all([listMembers(), listDepartments(), listMeetings(), getLiveMeeting()]);
  const activeMembers = members
    .filter((member) => member.status === "active")
    .map((member) => ({
      id: member.id,
      fullName: member.fullName,
      departmentName: member.departmentName,
      departmentIds: [member.departmentId, ...member.otherDepartments.map((other) => other.id)],
    }));
  const departmentOptions = departments.map((department) => ({ id: department.id, name: department.name }));

  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="Attendance"
        description="Start a meeting, tick members as they arrive, and mark anyone who leaves early. Ending the meeting adds everyone's time to their Volunteer Hours Record."
      />
      <div className="space-y-6">
        <Panel
          title={live ? "Meeting in progress" : "Start a meeting"}
          description={live ? "Arrival and leaving times are recorded automatically." : "Give the meeting a name, then tick members as they arrive."}
        >
          <LiveMeeting meeting={live ? toClient(live) : null} members={activeMembers} departments={departmentOptions} />
        </Panel>

        <Panel title="Past meetings" description="Open a meeting to change someone's hours or delete it. Changes update their records.">
          <MeetingsList meetings={meetings.map(toClient)} />
        </Panel>

        <details className="rounded-lg border border-zinc-200 bg-white shadow-panel">
          <summary className="cursor-pointer px-4 py-3 text-[13.5px] font-medium text-zinc-800 hover:bg-zinc-50">
            Add a past meeting (enter the hours yourself)
          </summary>
          <div className="border-t border-zinc-200">
            <AttendanceForm members={activeMembers} departments={departmentOptions} />
          </div>
        </details>
      </div>
    </>
  );
}
