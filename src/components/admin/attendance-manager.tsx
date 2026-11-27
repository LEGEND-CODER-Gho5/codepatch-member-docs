"use client";

import { ClipboardCheck, LoaderCircle, Search, Trash } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import { deleteMeetingAction, recordAttendanceAction, setAttendeeHoursAction } from "@/actions/attendance";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Field, FormError, Input, Select } from "@/components/ui/field";
import { EmptyState, tableStyles } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { formatHours, formatPlainDate, todayInAppTimeZone } from "@/lib/format";
import type { DepartmentOption } from "@/lib/types";

export type AttendanceMember = { id: string; fullName: string; departmentName: string; departmentIds: string[] };
export type AttendanceMeeting = {
  id: string;
  name: string;
  date: string;
  hours: number;
  recordedBy: string;
  attendees: { memberId: string; fullName: string; departmentName: string; hours: number; inRecord: boolean }[];
};

const toNumber = (value: string) => {
  const amount = Number(value);
  return value.trim() === "" ? 0 : Number.isFinite(amount) ? amount : NaN;
};

/* ------------------------------- Record attendance ------------------------------- */

export function AttendanceForm({ members, departments }: { members: AttendanceMember[]; departments: DepartmentOption[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [date, setDate] = useState(todayInAppTimeZone);
  const [hours, setHours] = useState("1");
  const [present, setPresent] = useState<Record<string, string>>({}); // memberId -> hours subtracted
  const [query, setQuery] = useState("");
  const [department, setDepartment] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const meetingHours = toNumber(hours);
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return members.filter(
      (member) => (!needle || member.fullName.toLowerCase().includes(needle)) && (!department || member.departmentIds.includes(department)),
    );
  }, [members, query, department]);
  const selectedIds = Object.keys(present);
  const credited = (memberId: string) => Math.max(0, Math.round((meetingHours - toNumber(present[memberId] ?? "0")) * 100) / 100);
  const totalHours = selectedIds.reduce((sum, id) => sum + (Number.isFinite(meetingHours) ? credited(id) : 0), 0);

  const toggle = (id: string, on: boolean) =>
    setPresent((current) => {
      const next = { ...current };
      if (on) next[id] = next[id] ?? "";
      else delete next[id];
      return next;
    });

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const result = await recordAttendanceAction({
      name,
      date,
      hours,
      attendees: selectedIds.map((memberId) => ({ memberId, subtract: present[memberId] })),
    });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    toast("Attendance recorded", { detail: `${result.data.present} member${result.data.present === 1 ? "" : "s"} got hours for ${name}.` });
    setName("");
    setPresent({});
    router.refresh();
  }

  return (
    <form onSubmit={submit} noValidate>
      <div className="grid gap-4 px-4 py-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <Field label="Meeting name" htmlFor="meeting-name" hint="Added as the description on each member's hours.">
          <Input id="meeting-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} placeholder="e.g., General meeting" />
        </Field>
        <Field label="Date" htmlFor="meeting-date">
          <Input id="meeting-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </Field>
        <Field label="Hours for each member" htmlFor="meeting-hours">
          <Input
            id="meeting-hours"
            inputMode="decimal"
            value={hours}
            onChange={(event) => setHours(event.target.value.replace(/[^\d.]/g, ""))}
            className="tabular"
          />
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-y border-zinc-200 bg-zinc-50/60 px-4 py-2.5">
        <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-zinc-400" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a member"
            aria-label="Find a member"
            className="h-9 w-full rounded-md border border-zinc-300 bg-white pr-3 pl-9 text-[13.5px] placeholder:text-zinc-400 focus:border-brand-500 focus:ring-3 focus:ring-brand-500/15 focus:outline-none"
          />
        </div>
        <Select value={department} onChange={(event) => setDepartment(event.target.value)} aria-label="Filter by department" className="w-48">
          <option value="">All departments</option>
          {departments.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </Select>
        <Button size="sm" onClick={() => shown.forEach((member) => toggle(member.id, true))} disabled={shown.length === 0}>
          Select all shown
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setPresent({})} disabled={selectedIds.length === 0}>
          Clear
        </Button>
        <p className="ml-auto text-[12.5px] text-zinc-500">
          {selectedIds.length} of {members.length} present
        </p>
      </div>

      {members.length === 0 ? (
        <EmptyState icon={<ClipboardCheck />} title="No active members yet" description="Add members first, then record attendance." />
      ) : (
        <ul className="max-h-[460px] divide-y divide-zinc-100 overflow-y-auto">
          {shown.map((member) => {
            const isPresent = member.id in present;
            return (
              <li key={member.id} className={cn("flex flex-wrap items-center gap-3 px-4 py-2", isPresent && "bg-brand-50/40")}>
                <label className="flex min-w-0 flex-1 items-center gap-3 text-[13.5px]">
                  <input
                    type="checkbox"
                    checked={isPresent}
                    onChange={(event) => toggle(member.id, event.target.checked)}
                    className="size-4 shrink-0 rounded border-zinc-300 accent-brand-700"
                  />
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-zinc-900">{member.fullName}</span>
                    <span className="block truncate text-[12px] text-zinc-500">{member.departmentName}</span>
                  </span>
                </label>
                {isPresent && (
                  <div className="flex items-center gap-2 text-[12.5px] text-zinc-600">
                    <label htmlFor={`subtract-${member.id}`}>Subtract</label>
                    <input
                      id={`subtract-${member.id}`}
                      inputMode="decimal"
                      value={present[member.id]}
                      onChange={(event) => setPresent({ ...present, [member.id]: event.target.value.replace(/[^\d.]/g, "") })}
                      placeholder="0"
                      className="tabular h-8 w-16 rounded-md border border-zinc-300 bg-white px-2 text-right text-[13px] focus:border-brand-500 focus:outline-none"
                    />
                    <span className="tabular w-16 text-right font-medium text-zinc-900">
                      = {Number.isFinite(meetingHours) ? formatHours(credited(member.id)) : "—"} h
                    </span>
                  </div>
                )}
              </li>
            );
          })}
          {shown.length === 0 && <li className="px-4 py-6 text-[13px] text-zinc-500">No members match.</li>}
        </ul>
      )}

      <div className="px-4 pt-3">
        <FormError message={error} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200 bg-zinc-50/60 px-4 py-3">
        <p className="text-[12.5px] text-zinc-600">
          {selectedIds.length} present · {formatHours(totalHours)} hours in total will be added to their Volunteer Hours Records.
        </p>
        <Button type="submit" variant="primary" size="sm" disabled={pending || selectedIds.length === 0}>
          {pending ? <LoaderCircle className="animate-spin" /> : <ClipboardCheck />}
          Submit attendance
        </Button>
      </div>
    </form>
  );
}

/* --------------------------------- Past meetings --------------------------------- */

function AttendeeHours({ meetingId, attendee, max }: { meetingId: string; attendee: AttendanceMeeting["attendees"][number]; max: number }) {
  const router = useRouter();
  const [value, setValue] = useState(String(attendee.hours));
  const [pending, setPending] = useState(false);
  const changed = toNumber(value) !== attendee.hours;
  async function save() {
    setPending(true);
    const result = await setAttendeeHoursAction({ meetingId, memberId: attendee.memberId, hours: value });
    setPending(false);
    if (!result.ok) {
      toast(result.error, { kind: "error" });
      return;
    }
    toast("Hours updated", { detail: `${attendee.fullName} now has ${formatHours(toNumber(value))} hours for this meeting.` });
    router.refresh();
  }
  return (
    <div className="flex items-center justify-end gap-2">
      <input
        inputMode="decimal"
        value={value}
        onChange={(event) => setValue(event.target.value.replace(/[^\d.]/g, ""))}
        aria-label={`Hours for ${attendee.fullName}`}
        className="tabular h-8 w-16 rounded-md border border-zinc-300 bg-white px-2 text-right text-[13px] focus:border-brand-500 focus:outline-none"
      />
      <Button size="xs" onClick={() => void save()} disabled={!changed || pending || toNumber(value) > max}>
        {pending && <LoaderCircle className="animate-spin" />}
        Save
      </Button>
    </div>
  );
}

export function MeetingsList({ meetings }: { meetings: AttendanceMeeting[] }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState<AttendanceMeeting | null>(null);
  if (meetings.length === 0) {
    return <EmptyState icon={<ClipboardCheck />} title="No meetings recorded yet" description="Submitted attendance appears here." />;
  }
  return (
    <>
      <ul className="divide-y divide-zinc-200">
        {meetings.map((meeting) => {
          const total = meeting.attendees.reduce((sum, attendee) => sum + attendee.hours, 0);
          return (
            <li key={meeting.id}>
              <details className="group">
                <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-zinc-50">
                  <span className="w-28 shrink-0 text-[12.5px] text-zinc-500">{formatPlainDate(meeting.date, "short")}</span>
                  <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-zinc-900">{meeting.name}</span>
                  <span className="tabular text-[12.5px] text-zinc-600">
                    {meeting.attendees.length} present · {formatHours(meeting.hours)} h each · {formatHours(total)} h total
                  </span>
                </summary>
                <div className="border-t border-zinc-100 bg-zinc-50/50 px-4 py-3">
                  <div className={tableStyles.wrapper}>
                    <table className={tableStyles.table}>
                      <thead>
                        <tr>
                          <th className={tableStyles.th}>Member</th>
                          <th className={tableStyles.th}>Department</th>
                          <th className={cn(tableStyles.th, "text-right")}>Hours (change to subtract)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {meeting.attendees.map((attendee) => (
                          <tr key={attendee.memberId} className={tableStyles.row}>
                            <td className={tableStyles.td}>
                              <span className="font-medium text-zinc-900">{attendee.fullName}</span>
                              {!attendee.inRecord && (
                                <span className="block text-[12px] text-amber-700">This entry was removed from their record. Saving adds it again.</span>
                              )}
                            </td>
                            <td className={cn(tableStyles.td, "text-zinc-600")}>{attendee.departmentName}</td>
                            <td className={tableStyles.td}>
                              <AttendeeHours meetingId={meeting.id} attendee={attendee} max={meeting.hours} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[12px] text-zinc-500">Recorded by {meeting.recordedBy}.</p>
                    <Button size="sm" variant="danger-outline" onClick={() => setDeleting(meeting)}>
                      <Trash />
                      Delete meeting
                    </Button>
                  </div>
                </div>
              </details>
            </li>
          );
        })}
      </ul>
      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        tone="danger"
        title="Delete this meeting?"
        description={
          deleting
            ? `This removes ${deleting.name} and the hours it added to ${deleting.attendees.length} member${deleting.attendees.length === 1 ? "'s" : "s'"} records. The removals are kept in Edit History.`
            : ""
        }
        confirmLabel="Delete meeting"
        onConfirm={async () => {
          if (!deleting) return;
          const result = await deleteMeetingAction(deleting.id);
          if (!result.ok) return result.error;
          toast("Meeting deleted", { detail: "The hours it added were removed." });
          router.refresh();
        }}
      />
    </>
  );
}
