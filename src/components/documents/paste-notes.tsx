"use client";

import { ArrowLeft, ClipboardPaste, LoaderCircle, Rows3, X } from "lucide-react";
import { useId, useRef, useState, type ClipboardEvent, type ReactNode } from "react";
import { createEntriesAction } from "@/actions/documents";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { todayInAppTimeZone } from "@/lib/format";
import { htmlToNotes, MAX_PASTE_CHARACTERS, parseNotes, type ParsedRow } from "@/lib/notes-parser";
import { cleanHours, LIMITS } from "@/lib/validation";
import type { ActingAs, EntryKind } from "@/lib/types";

type Row = ParsedRow & { key: string };
export type AddedRow = { id: string; values: Record<string, string> };

const field =
  "w-full rounded-md border bg-surface px-2.5 text-[13.5px] text-zinc-900 placeholder:text-zinc-400 focus:border-brand-500 focus:ring-3 focus:ring-brand-500/15 focus:outline-none";

function rowError(kind: EntryKind, row: Row): string | null {
  if (kind === "hours") {
    const hours = cleanHours(row.hours);
    if (!hours.ok) return hours.error;
    if (row.text.length > LIMITS.description) return "The description is too long.";
    return null;
  }
  if (row.text.length > LIMITS.title) return "The summary is too long.";
  if (row.details.length > LIMITS.details) return "The details are too long.";
  return null;
}

function isEmpty(kind: EntryKind, row: Row) {
  return !row.date && !row.text.trim() && (kind === "hours" ? !row.hours.trim() : !row.details.trim());
}

/**
 * "Paste your notes": a member pastes what they already wrote (a Google Doc,
 * a list, a table), the page sorts it into rows (src/lib/notes-parser.ts, in
 * the browser), they check and fix each row, and only then are the rows added,
 * all at once. Dates and hours are never guessed: anything not in the notes
 * is left blank and pointed out.
 */
export function PasteNotesButton({
  documentId,
  kind,
  actingAs,
  verified,
  onAdded,
  className,
  label = "Paste your notes",
  trigger,
}: {
  documentId: string;
  kind: EntryKind;
  actingAs: ActingAs;
  verified: boolean;
  onAdded: (rows: AddedRow[]) => void;
  className?: string;
  label?: string;
  /** Draws the opener instead of the standard button (for example, a large card). */
  trigger?: (open: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<"paste" | "review">("paste");
  const [text, setText] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const textId = useId();
  const hoursRecord = kind === "hours";

  const close = () => {
    if (adding) return;
    setOpen(false);
    setStage("paste");
    setText("");
    setRows([]);
    setError(null);
  };

  // Tables copied from Google Docs, Word, or a web page keep their columns.
  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const html = event.clipboardData.getData("text/html");
    if (!html || !/<table/i.test(html)) return;
    event.preventDefault();
    const notes = htmlToNotes(new DOMParser().parseFromString(html, "text/html").body);
    const target = event.currentTarget;
    const start = target.selectionStart ?? text.length;
    const end = target.selectionEnd ?? text.length;
    setText((text.slice(0, start) + notes + text.slice(end)).slice(0, MAX_PASTE_CHARACTERS));
  };

  const sort = () => {
    const result = parseNotes(text, kind, todayInAppTimeZone());
    setRows(result.rows.map((row) => ({ ...row, key: crypto.randomUUID() })));
    setTruncated(result.truncated);
    setError(null);
    setStage("review");
  };

  const change = (key: string, patch: Partial<ParsedRow>) => setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  const remove = (key: string) => setRows((current) => current.filter((row) => row.key !== key));

  const toAdd = rows.filter((row) => !isEmpty(kind, row));
  const invalid = toAdd.find((row) => rowError(kind, row));
  const missingDates = toAdd.filter((row) => !row.date).length;
  const missingHours = hoursRecord ? toAdd.filter((row) => !row.hours.trim()).length : 0;
  const noun = hoursRecord ? (toAdd.length === 1 ? "row" : "rows") : toAdd.length === 1 ? "contribution" : "contributions";

  const add = async () => {
    if (toAdd.length === 0 || invalid) return;
    setAdding(true);
    setError(null);
    const values = toAdd.map((row) =>
      hoursRecord
        ? { service_date: row.date, description: row.text.trim(), hours: row.hours.trim() }
        : { entry_date: row.date, title: row.text.trim(), details: row.details.trim() },
    );
    try {
      const result = await createEntriesAction({ documentId, kind, actingAs, entries: values });
      if (!result.ok) {
        setError(result.error);
        setAdding(false);
        return;
      }
      onAdded(result.data.ids.map((id, index) => ({ id, values: Object.fromEntries(Object.entries(values[index]).map(([k, v]) => [k, String(v)])) })));
      toast(`Added ${toAdd.length} ${noun}`);
      setAdding(false);
      close();
    } catch {
      setError("Connection problem: nothing was added. Try again.");
      setAdding(false);
    }
  };

  return (
    <>
      {trigger ? (
        trigger(() => setOpen(true))
      ) : (
        <Button size="sm" variant="secondary" className={className} onClick={() => setOpen(true)}>
          <ClipboardPaste />
          {label}
        </Button>
      )}
      <Dialog
        open={open}
        onClose={close}
        size="lg"
        dismissible={!adding}
        title={stage === "paste" ? "Paste your notes" : `Check ${toAdd.length} ${noun}`}
        description={
          stage === "paste"
            ? `Paste what you already wrote: a Google Doc, a list, or a table. The page sorts it into ${hoursRecord ? "date, description, and hours" : "dated contributions"} for you to check. Nothing is added until you press Add.`
            : "Fix anything that's off, remove what doesn't belong, then add them."
        }
        footer={
          stage === "paste" ? (
            <>
              <Button size="sm" variant="ghost" onClick={close}>
                Cancel
              </Button>
              <Button size="sm" variant="primary" onClick={sort} disabled={!text.trim()}>
                <Rows3 />
                Sort into {hoursRecord ? "rows" : "entries"}
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="ghost" onClick={() => setStage("paste")} disabled={adding} className="mr-auto">
                <ArrowLeft />
                Back to notes
              </Button>
              <Button size="sm" variant="primary" onClick={add} disabled={adding || toAdd.length === 0 || Boolean(invalid)}>
                {adding && <LoaderCircle className="animate-spin" />}
                Add {toAdd.length} {noun}
              </Button>
            </>
          )
        }
      >
        {stage === "paste" ? (
          <div>
            <label htmlFor={textId} className="sr-only">
              Your notes
            </label>
            <textarea
              id={textId}
              ref={area}
              value={text}
              onChange={(event) => setText(event.target.value)}
              onPaste={onPaste}
              maxLength={MAX_PASTE_CHARACTERS}
              rows={12}
              autoFocus
              placeholder={
                hoursRecord
                  ? "Oct 12 – Taught Scratch at the library (2 hrs)\n10/19 Robotics club mentoring, 1.5 hours\n…"
                  : "Oct 12 – Led the Scratch workshop. We had 14 students…\nNov 2 – Wrote the newsletter article about our hackathon\n…"
              }
              className={cn(field, "min-h-56 resize-y border-zinc-300 py-2 font-mono text-[13px] leading-relaxed")}
            />
            <p className="mt-2 text-[12.5px] leading-relaxed text-zinc-500">
              Each date starts a new {hoursRecord ? "row" : "entry"}; the lines under it are added to it. Dates and hours are only filled in when your notes say them. Your notes stay on this device until you add them.
            </p>
          </div>
        ) : (
          <div>
            {rows.length === 0 ? (
              <p className="rounded-lg border border-dashed border-zinc-300 px-4 py-8 text-center text-[13.5px] text-zinc-600">
                Nothing to add was found. Go back and check that your notes have the activities in them, one per line or under each date.
              </p>
            ) : (
              <>
                {(missingDates > 0 || missingHours > 0 || truncated) && (
                  <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-[12.5px] leading-relaxed text-amber-900 ring-1 ring-amber-200">
                    {[
                      missingDates > 0 && `${missingDates} without a date`,
                      missingHours > 0 && `${missingHours} without hours`,
                    ]
                      .filter(Boolean)
                      .join(" and ")}
                    {(missingDates > 0 || missingHours > 0) && ": your notes didn't say, so they're left blank (highlighted). Fill them in here, or later in the record."}
                    {truncated && " Only the first part of a very long paste was read; add the rest in a second paste."}
                  </p>
                )}
                {verified && actingAs === "member" && (
                  <p className="mb-3 rounded-md bg-zinc-100 px-3 py-2 text-[12.5px] text-zinc-700">
                    This record is verified. Adding to it removes the verification until the administrator checks it again.
                  </p>
                )}
                <ol className="max-h-[52vh] space-y-2 overflow-y-auto pr-1">
                  {rows.map((row, index) => {
                    const problem = rowError(kind, row);
                    return (
                      <li key={row.key} className="rounded-lg border border-zinc-200 p-2.5">
                        <div className="flex items-start gap-2">
                          <span className="tabular mt-2 w-5 shrink-0 text-right text-[12px] text-zinc-400">{index + 1}</span>
                          <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[150px_minmax(0,1fr)_92px]">
                            <input
                              type="date"
                              aria-label={`Row ${index + 1} date`}
                              value={row.date}
                              onChange={(event) => change(row.key, { date: event.target.value })}
                              className={cn(field, "h-9", row.date ? "border-zinc-300" : "border-amber-400 bg-amber-50/60")}
                            />
                            <input
                              type="text"
                              aria-label={hoursRecord ? `Row ${index + 1} description` : `Row ${index + 1} summary`}
                              value={row.text}
                              maxLength={hoursRecord ? LIMITS.description : LIMITS.title}
                              placeholder={hoursRecord ? "Description of volunteer work" : "Contribution"}
                              onChange={(event) => change(row.key, { text: event.target.value })}
                              className={cn(field, "h-9 border-zinc-300", !hoursRecord && "sm:col-span-2")}
                            />
                            {hoursRecord && (
                              <input
                                type="text"
                                inputMode="decimal"
                                aria-label={`Row ${index + 1} hours`}
                                value={row.hours}
                                placeholder="Hours"
                                onChange={(event) => change(row.key, { hours: event.target.value })}
                                className={cn(field, "tabular h-9", row.hours ? "border-zinc-300" : "border-amber-400 bg-amber-50/60", problem && "border-red-400")}
                              />
                            )}
                            {!hoursRecord && (
                              <textarea
                                aria-label={`Row ${index + 1} details`}
                                value={row.details}
                                rows={2}
                                maxLength={LIMITS.details}
                                placeholder="Details (optional)"
                                onChange={(event) => change(row.key, { details: event.target.value })}
                                className={cn(field, "border-zinc-300 py-1.5 sm:col-span-3")}
                              />
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => remove(row.key)}
                            aria-label={`Remove row ${index + 1}`}
                            className="mt-1 rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
                          >
                            <X className="size-4" />
                          </button>
                        </div>
                        {problem && <p className="mt-1.5 pl-7 text-[12px] text-red-700">{problem}</p>}
                      </li>
                    );
                  })}
                </ol>
              </>
            )}
            {error && (
              <p role="alert" className="mt-3 text-[13px] text-red-700">
                {error}
              </p>
            )}
          </div>
        )}
      </Dialog>
    </>
  );
}
