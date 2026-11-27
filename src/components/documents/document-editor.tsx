"use client";

import {
  Check,
  CircleExclamationPoint,
  Copy,
  ExternalLink,
  FileDown,
  Info,
  LoaderCircle,
  Lock,
  Plus,
  Printer,
  Save,
  ShieldCheck,
  Trash,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type TextareaHTMLAttributes } from "react";
import { createEntryAction, deleteEntryAction, saveDocumentFieldsAction, updateEntryAction } from "@/actions/documents";
import { Button, buttonStyles } from "@/components/ui/button";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { CONTRIBUTION_GUIDANCE, PDF_TEXT } from "@/lib/document-text";
import { copyRichText, downloadFile, NEW_GOOGLE_DOC_URL } from "@/lib/export/browser";
import { renderDocumentHtml } from "@/lib/export/document-html";
import { buildExportModel, exportFileName } from "@/lib/export/document-model";
import { formatHours, formatPlainDate, formatTime, todayInAppTimeZone } from "@/lib/format";
import { cleanHours, LIMITS } from "@/lib/validation";
import type { ActingAs, DocumentRecord, EntryKind, HeaderField, OrgInfo, WorkspaceMember } from "@/lib/types";

type RowValues = Record<string, string>;
type LocalRow = { key: string; id: string | null; values: RowValues; error: string | null };
type SaveState = { state: "saved" | "dirty" | "saving" | "error"; at: string; error: string | null };

const BLANK_ROW: Record<EntryKind, RowValues> = {
  contribution: { entry_date: "", title: "", details: "" },
  hours: { service_date: "", description: "", hours: "" },
};

function rowsFrom(record: DocumentRecord): LocalRow[] {
  if (record.documentType === "member_documentation") {
    return record.contributions.map((entry) => ({
      key: entry.id,
      id: entry.id,
      error: null,
      values: { entry_date: entry.entryDate ?? "", title: entry.title, details: entry.details },
    }));
  }
  return record.hours.map((entry) => ({
    key: entry.id,
    id: entry.id,
    error: null,
    values: {
      service_date: entry.serviceDate ?? "",
      description: entry.description,
      hours: entry.hours === null ? "" : String(entry.hours),
    },
  }));
}

function sameValues(a: RowValues, b: RowValues) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) if ((a[key] ?? "") !== (b[key] ?? "")) return false;
  return true;
}

function isBlank(values: RowValues) {
  return Object.values(values).every((value) => value.trim() === "");
}

function validateRow(kind: EntryKind, values: RowValues): string | null {
  if (kind === "hours") {
    const hours = cleanHours(values.hours);
    if (!hours.ok) return hours.error;
    if (values.description.length > LIMITS.description) return "Description is too long.";
    return null;
  }
  if (values.title.length > LIMITS.title) return "Contribution summary is too long.";
  if (values.details.length > LIMITS.details) return "Details are too long.";
  return null;
}

type Props = {
  record: DocumentRecord;
  member: WorkspaceMember;
  org: OrgInfo;
  actingAs: ActingAs;
};

export function DocumentEditor({ record, member, org, actingAs }: Props) {
  const kind: EntryKind = record.documentType === "member_documentation" ? "contribution" : "hours";
  const [header, setHeaderState] = useState<Record<HeaderField, string>>(() => ({ ...record.fields }));
  const [rows, setRowsState] = useState<LocalRow[]>(() => rowsFrom(record));
  const [saveState, setSaveState] = useState<SaveState>({ state: "saved", at: record.updatedAt, error: null });
  const [pendingDelete, setPendingDelete] = useState<LocalRow | null>(null);

  const headerRef = useRef(header);
  const rowsRef = useRef(rows);
  const dirtyHeader = useRef(new Set<HeaderField>());
  const dirtyRows = useRef(new Set<string>());
  const deletedIds = useRef(new Set<string>());
  const focusedField = useRef<string | null>(null);
  const saving = useRef(false);
  const queued = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const context = useRef({ documentId: record.id, actingAs, kind });
  const lastRecord = useRef(record);
  const focusTarget = useRef<string | null>(null);

  const commitHeader = useCallback((next: Record<HeaderField, string>) => {
    headerRef.current = next;
    setHeaderState(next);
  }, []);
  const commitRows = useCallback((next: LocalRow[]) => {
    rowsRef.current = next;
    setRowsState(next);
  }, []);
  const setRowError = useCallback(
    (key: string, error: string | null) => {
      const row = rowsRef.current.find((item) => item.key === key);
      if (!row || row.error === error) return;
      commitRows(rowsRef.current.map((item) => (item.key === key ? { ...item, error } : item)));
    },
    [commitRows],
  );

  const hasPending = () => dirtyHeader.current.size > 0 || dirtyRows.current.size > 0;

  const flush = useCallback(
    async function run(): Promise<void> {
      window.clearTimeout(timer.current);
      if (saving.current) {
        queued.current = true;
        return;
      }
      if (!(dirtyHeader.current.size > 0 || dirtyRows.current.size > 0)) return;
      saving.current = true;
      setSaveState((current) => ({ ...current, state: "saving", error: null }));
      const { documentId, actingAs: as, kind: entryKind } = context.current;
      let failure: string | null = null;

      try {
        if (dirtyHeader.current.size > 0) {
          const fields = [...dirtyHeader.current];
          const snapshot = headerRef.current;
          const patch = Object.fromEntries(fields.map((field) => [field, snapshot[field]]));
          const result = await saveDocumentFieldsAction({ documentId, actingAs: as, patch });
          if (result.ok) {
            for (const field of fields) if (headerRef.current[field] === patch[field]) dirtyHeader.current.delete(field);
          } else {
            failure = result.error;
          }
        }

        for (const key of [...dirtyRows.current]) {
          const row = rowsRef.current.find((item) => item.key === key);
          if (!row) {
            dirtyRows.current.delete(key);
            continue;
          }
          const values = { ...row.values };
          const invalid = validateRow(entryKind, values);
          if (invalid) {
            setRowError(key, invalid);
            failure ??= invalid;
            continue;
          }
          if (!row.id) {
            if (isBlank(values)) {
              dirtyRows.current.delete(key);
              continue;
            }
            const result = await createEntryAction({ documentId, kind: entryKind, actingAs: as, values });
            if (!result.ok) {
              setRowError(key, result.error);
              failure ??= result.error;
              continue;
            }
            const newId = result.data.id;
            commitRows(
              rowsRef.current
                .filter((item) => item.key === key || item.id !== newId)
                .map((item) => (item.key === key ? { ...item, id: newId, error: null } : item)),
            );
          } else {
            const result = await updateEntryAction({ entryId: row.id, kind: entryKind, actingAs: as, values });
            if (!result.ok) {
              setRowError(key, result.error);
              failure ??= result.error;
              continue;
            }
            setRowError(key, null);
          }
          const current = rowsRef.current.find((item) => item.key === key);
          if (!current || sameValues(current.values, values)) dirtyRows.current.delete(key);
        }
      } catch {
        failure = "Connection problem — your latest changes are not saved yet.";
      }

      saving.current = false;
      const pending = dirtyHeader.current.size > 0 || dirtyRows.current.size > 0;
      setSaveState((current) =>
        failure
          ? { state: "error", at: current.at, error: failure }
          : { state: pending ? "dirty" : "saved", at: new Date().toISOString(), error: null },
      );
      if (queued.current) {
        queued.current = false;
        void run();
      } else if (pending && !failure) {
        timer.current = window.setTimeout(() => void run(), 1200);
      }
    },
    [commitRows, setRowError],
  );

  const schedule = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), 900);
    setSaveState((current) => (current.state === "saving" ? current : { ...current, state: "dirty", error: null }));
  }, [flush]);

  const setHeaderField = (field: HeaderField, value: string) => {
    commitHeader({ ...headerRef.current, [field]: value });
    dirtyHeader.current.add(field);
    schedule();
  };

  const setRowField = (key: string, field: string, value: string) => {
    commitRows(rowsRef.current.map((row) => (row.key === key ? { ...row, values: { ...row.values, [field]: value } } : row)));
    dirtyRows.current.add(key);
    schedule();
  };

  const addRow = () => {
    const key = `new-${crypto.randomUUID()}`;
    const values = { ...BLANK_ROW[kind], [kind === "hours" ? "service_date" : "entry_date"]: todayInAppTimeZone() };
    commitRows([...rowsRef.current, { key, id: null, values, error: null }]);
    dirtyRows.current.add(key);
    focusTarget.current = key;
    schedule();
  };

  const removeLocalRow = (key: string) => {
    dirtyRows.current.delete(key);
    commitRows(rowsRef.current.filter((row) => row.key !== key));
  };

  const confirmDelete = async (): Promise<string | void> => {
    const row = pendingDelete;
    if (!row) return;
    if (!row.id) {
      removeLocalRow(row.key);
      setPendingDelete(null);
      return;
    }
    const result = await deleteEntryAction({ entryId: row.id, kind, actingAs });
    if (!result.ok) return result.error;
    deletedIds.current.add(row.id);
    removeLocalRow(row.key);
    setPendingDelete(null);
    toast(kind === "hours" ? "Volunteer-hours entry deleted" : "Contribution entry deleted");
  };

  // Focus the first input of a newly added row.
  useEffect(() => {
    const key = focusTarget.current;
    if (!key) return;
    focusTarget.current = null;
    const element = window.document.querySelector<HTMLElement>(`[data-row-focus="${CSS.escape(key)}"]`);
    element?.focus();
  }, [rows]);

  // Merge changes made elsewhere (another device, the administrator, or the
  // member) without overwriting anything typed here that is not yet saved.
  useEffect(() => {
    if (lastRecord.current === record) return;
    lastRecord.current = record;

    const incoming = record.fields;
    let headerChanged = false;
    const nextHeader = { ...headerRef.current };
    for (const field of Object.keys(incoming) as HeaderField[]) {
      if (dirtyHeader.current.has(field) || focusedField.current === `h:${field}`) continue;
      if (nextHeader[field] !== incoming[field]) {
        nextHeader[field] = incoming[field];
        headerChanged = true;
      }
    }
    if (headerChanged) commitHeader(nextHeader);

    const serverRows = rowsFrom(record);
    const byId = new Map(serverRows.map((row) => [row.id as string, row]));
    const merged = rowsRef.current
      .filter((row) => !row.id || byId.has(row.id) || dirtyRows.current.has(row.key))
      .map((row) => {
        if (!row.id || dirtyRows.current.has(row.key) || focusedField.current?.startsWith(`r:${row.key}:`)) return row;
        const server = byId.get(row.id);
        return server && !sameValues(server.values, row.values) ? { ...row, values: server.values } : row;
      });
    const known = new Set(merged.map((row) => row.id).filter(Boolean));
    for (const row of serverRows) {
      if (row.id && !known.has(row.id) && !deletedIds.current.has(row.id)) merged.push(row);
    }
    commitRows(merged);
  }, [record, commitHeader, commitRows]);

  // Save before the tab is hidden or closed, and warn about unsaved changes.
  useEffect(() => {
    const onVisibility = () => {
      if (window.document.visibilityState === "hidden") void flush();
    };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (hasPending() || saving.current) {
        void flush();
        event.preventDefault();
      }
    };
    window.document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("beforeunload", onBeforeUnload);
      void flush();
    };
  }, [flush]);

  const totalHours = useMemo(
    () =>
      rows.reduce((sum, row) => {
        const parsed = cleanHours(row.values.hours);
        return sum + (parsed.ok && parsed.value ? parsed.value : 0);
      }, 0),
    [rows],
  );

  const focusProps = (id: string) => ({
    onFocus: () => {
      focusedField.current = id;
    },
    onBlur: () => {
      if (focusedField.current === id) focusedField.current = null;
      if (hasPending()) void flush();
    },
  });

  const headerInput = (field: HeaderField, options: { placeholder?: string; type?: "text" | "date"; signature?: boolean; label: string }) => (
    <input
      type={options.type ?? "text"}
      value={header[field]}
      onChange={(event) => setHeaderField(field, event.target.value)}
      placeholder={options.placeholder}
      aria-label={options.label}
      maxLength={field === "period" ? LIMITS.period : LIMITS.shortField}
      className={cn(lineInputClass, options.type === "date" && "max-w-[220px]", options.signature && "font-serif text-[15px] italic")}
      {...focusProps(`h:${field}`)}
    />
  );

  /* ------------------------------ Export (PDF, Google Docs) ------------------------------ */
  const [exporting, setExporting] = useState<"pdf" | "docs" | null>(null);
  const [docsTabBlocked, setDocsTabBlocked] = useState(false);
  const exportModel = () =>
    buildExportModel({ kind, header: headerRef.current, rows: rowsRef.current, member, org, totalHours });

  async function downloadPdf() {
    if (exporting) return;
    setExporting("pdf");
    try {
      // The PDF shows what is on screen; saving first keeps the stored record identical.
      void flush();
      const model = exportModel();
      const { loadPdfFonts, renderDocumentPdf } = await import("@/lib/export/document-pdf");
      const bytes = await renderDocumentPdf(model, await loadPdfFonts());
      downloadFile(bytes, exportFileName(model.fileTitle, "pdf"), "application/pdf");
      toast("PDF downloaded", { detail: "Check your Downloads folder." });
    } catch {
      toast("The PDF could not be created", { kind: "error", detail: "Check your connection and try again." });
    } finally {
      setExporting(null);
    }
  }

  async function copyToGoogleDocs() {
    if (exporting) return;
    setExporting("docs");
    void flush();
    try {
      const { html, text } = renderDocumentHtml(exportModel());
      await copyRichText(html, text);
    } catch {
      setExporting(null);
      toast("Copying is blocked in this browser", { kind: "error", detail: "Use Download PDF instead, or try another browser." });
      return;
    }
    setExporting(null);
    const tab = window.open(NEW_GOOGLE_DOC_URL, "_blank");
    if (tab) {
      toast("Copied. Now paste it into the new Google Doc", { detail: "Press Ctrl+V (⌘V on a Mac) in the new tab.", duration: 9000 });
    } else {
      setDocsTabBlocked(true);
    }
  }

  const sharedHeader = (
    <EditorToolbar
      state={saveState}
      onSave={() => void flush()}
      onRetry={() => void flush()}
      onPdf={() => void downloadPdf()}
      onGoogleDocs={() => void copyToGoogleDocs()}
      exporting={exporting}
      actingAs={actingAs}
    />
  );

  return (
    <div>
      {sharedHeader}
      {actingAs === "admin" && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-brand-200 bg-brand-50 px-3 py-2 text-[12.5px] text-brand-900 print:hidden">
          <ShieldCheck className="mt-px size-4 shrink-0 text-brand-600" />
          You are editing {member.fullName}&apos;s record as the administrator. Every change is recorded in Edit History as an
          administrator action.
        </div>
      )}

      {/* ----------------------------- Interactive sheet ----------------------------- */}
      <article className="rounded-md border border-zinc-200 bg-white px-5 py-8 shadow-sheet sm:px-12 sm:py-12 print:hidden">
        {kind === "contribution" ? (
          <>
            <header>
              <p className="text-[25px] leading-none font-bold tracking-[-0.01em] text-zinc-950">{PDF_TEXT.heading}</p>
              <h2 className="mt-5 text-[19px] font-bold text-zinc-950">{PDF_TEXT.memberDocumentation.title}</h2>
            </header>
            <div className="mt-5 text-[14px]">
              <LineField label={PDF_TEXT.memberDocumentation.memberName}>
                <AutoValue value={member.fullName} />
              </LineField>
              <LineField label={PDF_TEXT.memberDocumentation.chapter}>
                <span className="text-zinc-900">{org.chapterName}</span>
              </LineField>
              <LineField label={PDF_TEXT.memberDocumentation.positionRole}>
                <AutoValue value={member.positionName} />
              </LineField>
              <LineField label={PDF_TEXT.memberDocumentation.documentationPeriod}>
                {headerInput("period", { placeholder: "e.g., September 2026 – January 2027", label: "Documentation Period" })}
              </LineField>
            </div>

            <section aria-label="Contributions" className="mt-9">
              <p className="mb-4 flex items-start gap-2 rounded-md bg-zinc-50 px-3 py-2 text-[12.5px] text-zinc-600 ring-1 ring-zinc-200 ring-inset">
                <Info className="mt-px size-4 shrink-0 text-zinc-400" />
                {CONTRIBUTION_GUIDANCE}
              </p>
              {rows.length === 0 ? (
                <button
                  type="button"
                  onClick={addRow}
                  className="flex min-h-[260px] w-full flex-col items-center justify-center gap-2 rounded-md border border-dashed border-zinc-300 text-[13.5px] text-zinc-500 transition-colors hover:border-brand-300 hover:bg-brand-50/30 hover:text-brand-800"
                >
                  <Plus className="size-5" />
                  Add your first contribution
                </button>
              ) : (
                <ol className="space-y-3">
                  {rows.map((row, index) => (
                    <li
                      key={row.key}
                      className={cn(
                        "group/entry rounded-md border bg-white transition-colors focus-within:border-brand-300 focus-within:shadow-[0_0_0_3px_rgba(112,83,157,0.08)]",
                        row.error ? "border-red-300" : "border-zinc-200 hover:border-zinc-300",
                      )}
                    >
                      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-100 px-3 py-2">
                        <span className="tabular w-5 text-[12px] font-medium text-zinc-400">{index + 1}.</span>
                        <input
                          type="date"
                          value={row.values.entry_date}
                          onChange={(event) => setRowField(row.key, "entry_date", event.target.value)}
                          aria-label={`Date of contribution ${index + 1}`}
                          className="h-8 rounded border border-zinc-200 bg-white px-2 text-[13px] text-zinc-800 focus:border-brand-500 focus:outline-none"
                          {...focusProps(`r:${row.key}:entry_date`)}
                        />
                        <input
                          data-row-focus={row.key}
                          value={row.values.title}
                          onChange={(event) => setRowField(row.key, "title", event.target.value)}
                          placeholder="What did you contribute?"
                          aria-label={`Contribution ${index + 1}`}
                          maxLength={LIMITS.title}
                          className="h-8 min-w-[180px] flex-1 border-0 bg-transparent px-1 text-[13.5px] font-medium text-zinc-900 placeholder:font-normal placeholder:text-zinc-400 focus:outline-none"
                          {...focusProps(`r:${row.key}:title`)}
                        />
                        <button
                          type="button"
                          onClick={() => setPendingDelete(row)}
                          aria-label={`Delete contribution ${index + 1}`}
                          className="rounded p-1.5 text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-700 sm:opacity-0 sm:group-focus-within/entry:opacity-100 sm:group-hover/entry:opacity-100"
                        >
                          <Trash className="size-4" />
                        </button>
                      </div>
                      <AutoTextarea
                        value={row.values.details}
                        onChange={(event) => setRowField(row.key, "details", event.target.value)}
                        placeholder="Describe the work in detail — what you did, who it supported, and any results."
                        aria-label={`Details for contribution ${index + 1}`}
                        maxLength={LIMITS.details}
                        minHeight={112}
                        className="block w-full resize-none border-0 bg-transparent px-3 py-2.5 text-[13.5px] leading-relaxed text-zinc-800 placeholder:text-zinc-400 focus:outline-none"
                        {...focusProps(`r:${row.key}:details`)}
                      />
                      {row.error && <RowError message={row.error} />}
                    </li>
                  ))}
                </ol>
              )}
              {rows.length > 0 && (
                <Button size="sm" className="mt-3" onClick={addRow}>
                  <Plus />
                  Add contribution entry
                </Button>
              )}
            </section>

            <section className="mt-11">
              <h3 className="text-[16px] font-bold text-zinc-950">{PDF_TEXT.memberDocumentation.verification}</h3>
              <div className="mt-3 space-y-2.5 text-[14px]">
                <LineField label={PDF_TEXT.memberDocumentation.supervisorName}>
                  {headerInput("supervisor_name", { label: "Supervisor Name" })}
                </LineField>
                <LineField label={PDF_TEXT.memberDocumentation.supervisorPosition}>
                  {headerInput("supervisor_position", { label: "Supervisor Position" })}
                </LineField>
                <LineField label={PDF_TEXT.memberDocumentation.supervisorSignature}>
                  {headerInput("supervisor_signature", { label: "Supervisor Signature", signature: true, placeholder: "Typed signature" })}
                </LineField>
              </div>
              <hr className="my-6 border-zinc-300" />
              <div className="space-y-2.5 text-[14px]">
                <LineField label={PDF_TEXT.memberDocumentation.memberConfirmation}>
                  {headerInput("member_confirmation", { label: "Member Confirmation", placeholder: "Type your full name to confirm" })}
                </LineField>
                <LineField label={PDF_TEXT.memberDocumentation.dateSubmitted}>
                  {headerInput("date_submitted", { label: "Date Submitted", type: "date" })}
                </LineField>
                <LineField label={PDF_TEXT.memberDocumentation.date}>
                  {headerInput("verification_date", { label: "Date", type: "date" })}
                </LineField>
              </div>
              <p className="mt-9 text-[13.5px] leading-relaxed text-zinc-800">{PDF_TEXT.certification}</p>
            </section>
          </>
        ) : (
          <>
            <header>
              <p className="text-[25px] leading-none font-normal tracking-[-0.01em] text-zinc-950">{PDF_TEXT.heading}</p>
              <h2 className="mt-5 text-[19px] font-normal text-zinc-950">{PDF_TEXT.volunteerHours.title}</h2>
            </header>
            <div className="mt-5 text-[14px]">
              <LineField label={PDF_TEXT.volunteerHours.volunteerName}>
                <AutoValue value={member.fullName} />
              </LineField>
              <LineField label={PDF_TEXT.volunteerHours.organization}>
                <span className="text-zinc-900">{org.organizationName}</span>
              </LineField>
              <LineField label={PDF_TEXT.volunteerHours.chapter}>
                <span className="text-zinc-900">{org.chapterName}</span>
              </LineField>
              <LineField label={PDF_TEXT.volunteerHours.positionRole}>
                <AutoValue value={member.positionName} />
              </LineField>
              <LineField label={PDF_TEXT.volunteerHours.servicePeriod}>
                {headerInput("period", { placeholder: "e.g., September 2026 – June 2027", label: "Volunteer Service Period" })}
              </LineField>
            </div>

            <section className="mt-8" aria-label="Volunteer Hours">
              <h3 className="mb-3 text-[16px] font-normal text-zinc-500">{PDF_TEXT.volunteerHours.sectionTitle}</h3>
              <div className="overflow-x-auto rounded-md border border-zinc-300">
                <table className="w-full min-w-[560px] border-collapse text-[13.5px]">
                  <thead>
                    <tr className="bg-zinc-50">
                      <th scope="col" className="w-[160px] border-b border-zinc-300 px-3 py-2 text-left font-bold text-zinc-950">
                        {PDF_TEXT.volunteerHours.columnDate}
                      </th>
                      <th scope="col" className="border-b border-zinc-300 px-3 py-2 text-left font-bold text-zinc-950">
                        {PDF_TEXT.volunteerHours.columnDescription}
                      </th>
                      <th scope="col" className="w-[100px] border-b border-zinc-300 px-3 py-2 text-right font-bold text-zinc-950">
                        {PDF_TEXT.volunteerHours.columnHours}
                      </th>
                      <th scope="col" className="w-11 border-b border-zinc-300">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-3 py-8 text-center text-[13px] text-zinc-500">
                          No volunteer hours recorded yet.
                        </td>
                      </tr>
                    )}
                    {rows.map((row, index) => (
                      <HoursRow
                        key={row.key}
                        row={row}
                        index={index}
                        onChange={(field, value) => setRowField(row.key, field, value)}
                        onDelete={() => setPendingDelete(row)}
                        focusProps={focusProps}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
              <Button size="sm" className="mt-3" onClick={addRow}>
                <Plus />
                Add row
              </Button>

              <div className="mt-7 flex flex-wrap items-baseline gap-2 text-[14px]">
                <span className="font-bold text-zinc-950">{PDF_TEXT.volunteerHours.total}</span>
                <span className="tabular doc-line min-w-[110px] px-1 pb-0.5 font-semibold text-zinc-950" aria-live="polite">
                  {formatHours(totalHours)}
                </span>
                <span className="text-[12px] text-zinc-400">Calculated automatically from the rows above</span>
              </div>
            </section>

            <hr className="my-8 border-zinc-300" />

            <section>
              <h3 className="text-[16px] font-normal text-zinc-500">{PDF_TEXT.volunteerHours.verification}</h3>
              <div className="mt-3 space-y-2.5 text-[14px]">
                <LineField label={PDF_TEXT.volunteerHours.supervisorName}>
                  {headerInput("supervisor_name", { label: "Supervisor Name" })}
                </LineField>
                <LineField label={PDF_TEXT.volunteerHours.supervisorPosition}>
                  {headerInput("supervisor_position", { label: "Supervisor Position" })}
                </LineField>
                <LineField label={PDF_TEXT.volunteerHours.supervisorSignature}>
                  {headerInput("supervisor_signature", { label: "Supervisor Signature", signature: true, placeholder: "Typed signature" })}
                </LineField>
                <LineField label={PDF_TEXT.volunteerHours.date}>
                  {headerInput("verification_date", { label: "Date", type: "date" })}
                </LineField>
              </div>
              <p className="mt-9 text-[13.5px] leading-relaxed text-zinc-800">{PDF_TEXT.certification}</p>
            </section>
          </>
        )}
      </article>

      {/* ------------------------------- Print version -------------------------------- */}
      <PrintableDocument kind={kind} header={header} rows={rows} member={member} org={org} totalHours={totalHours} />

      <Dialog
        open={docsTabBlocked}
        onClose={() => setDocsTabBlocked(false)}
        size="sm"
        title="Your document is copied"
        description="Your browser blocked the new tab. Open a new Google Doc, then paste with Ctrl+V (⌘V on a Mac)."
        footer={
          <>
            <Button onClick={() => setDocsTabBlocked(false)}>Close</Button>
            <a
              href={NEW_GOOGLE_DOC_URL}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setDocsTabBlocked(false)}
              className={buttonStyles({ variant: "primary", size: "md" })}
            >
              <ExternalLink />
              Open a new Google Doc
            </a>
          </>
        }
      >
        <p className="text-[13px] text-zinc-600">The copy keeps the headings, labels, and table, so you can edit it in Google Docs.</p>
      </Dialog>

      <ConfirmDialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title={kind === "hours" ? "Delete this volunteer-hours entry?" : "Delete this contribution entry?"}
        description="The entry will be removed from this document. A copy is kept in the edit history."
        confirmLabel="Delete entry"
        onConfirm={confirmDelete}
      />
    </div>
  );
}

/* ---------------------------------- Pieces ---------------------------------- */

const lineInputClass =
  "w-full border-0 border-b border-zinc-400 bg-transparent px-1 pt-0.5 pb-1 text-[14px] text-zinc-900 placeholder:text-zinc-400 transition-colors hover:border-zinc-600 focus:border-brand-600 focus:bg-brand-50/50 focus:outline-none";

const cellInputClass =
  "block w-full rounded border border-transparent bg-transparent px-2 py-1.5 text-[13.5px] text-zinc-900 placeholder:text-zinc-400 transition-colors hover:border-zinc-200 focus:border-brand-500 focus:bg-white focus:outline-none";

function LineField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 py-[3px]">
      <span className="shrink-0 font-bold text-zinc-950">{label}</span>
      <div className="min-w-[200px] flex-1">{children}</div>
    </div>
  );
}

function AutoValue({ value }: { value: string }) {
  return (
    <span
      className="flex items-center justify-between gap-2 border-b border-zinc-300 px-1 pt-0.5 pb-1 text-zinc-900"
      title="Filled automatically from the member profile"
    >
      <span className="truncate">{value}</span>
      <Lock aria-label="Filled automatically" className="size-3.5 shrink-0 text-zinc-300" />
    </span>
  );
}

function RowError({ message }: { message: string }) {
  return (
    <p className="flex items-center gap-1.5 border-t border-red-100 bg-red-50/60 px-3 py-1.5 text-[12px] text-red-700">
      <CircleExclamationPoint className="size-3.5" />
      {message}
    </p>
  );
}

function HoursRow({
  row,
  index,
  onChange,
  onDelete,
  focusProps,
}: {
  row: LocalRow;
  index: number;
  onChange: (field: string, value: string) => void;
  onDelete: () => void;
  focusProps: (id: string) => { onFocus: () => void; onBlur: () => void };
}) {
  const hoursCheck = cleanHours(row.values.hours);
  return (
    <>
      <tr className={cn("group/row align-top", row.error ? "bg-red-50/40" : "hover:bg-zinc-50/60")}>
        <td className="border-b border-zinc-200 p-1">
          <input
            type="date"
            data-row-focus={row.key}
            value={row.values.service_date}
            onChange={(event) => onChange("service_date", event.target.value)}
            aria-label={`Date, row ${index + 1}`}
            className={cellInputClass}
            {...focusProps(`r:${row.key}:service_date`)}
          />
        </td>
        <td className="border-b border-zinc-200 p-1">
          <AutoTextarea
            rows={1}
            value={row.values.description}
            onChange={(event) => onChange("description", event.target.value)}
            placeholder="Describe the volunteer work"
            aria-label={`Description of Volunteer Work, row ${index + 1}`}
            maxLength={LIMITS.description}
            minHeight={34}
            className={cn(cellInputClass, "resize-none leading-snug")}
            {...focusProps(`r:${row.key}:description`)}
          />
        </td>
        <td className="border-b border-zinc-200 p-1">
          <input
            type="text"
            inputMode="decimal"
            value={row.values.hours}
            onChange={(event) => onChange("hours", event.target.value.replace(/[^\d.]/g, ""))}
            placeholder="0"
            aria-label={`Hours, row ${index + 1}`}
            aria-invalid={!hoursCheck.ok || undefined}
            className={cn(cellInputClass, "tabular text-right", !hoursCheck.ok && "border-red-400")}
            {...focusProps(`r:${row.key}:hours`)}
          />
        </td>
        <td className="border-b border-zinc-200 p-1 text-center">
          <button
            type="button"
            onClick={onDelete}
            aria-label={`Delete row ${index + 1}`}
            className="mt-0.5 rounded p-1.5 text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-700 sm:opacity-0 sm:group-focus-within/row:opacity-100 sm:group-hover/row:opacity-100"
          >
            <Trash className="size-4" />
          </button>
        </td>
      </tr>
      {row.error && (
        <tr>
          <td colSpan={4} className="border-b border-zinc-200 p-0">
            <RowError message={row.error} />
          </td>
        </tr>
      )}
    </>
  );
}

function AutoTextarea({ minHeight = 80, className, value, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { minHeight?: number }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.max(element.scrollHeight + 2, minHeight)}px`;
  }, [value, minHeight]);
  return <textarea ref={ref} value={value} className={className} style={{ minHeight }} {...props} />;
}

function EditorToolbar({
  state,
  onSave,
  onRetry,
  onPdf,
  onGoogleDocs,
  exporting,
  actingAs,
}: {
  state: SaveState;
  onSave: () => void;
  onRetry: () => void;
  onPdf: () => void;
  onGoogleDocs: () => void;
  exporting: "pdf" | "docs" | null;
  actingAs: ActingAs;
}) {
  return (
    <div className="z-20 mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-zinc-200 bg-white/95 px-3 py-2 shadow-panel backdrop-blur lg:sticky lg:top-[68px] print:hidden">
      <div className="flex min-w-0 items-center gap-2 text-[12.5px]" aria-live="polite">
        {state.state === "saving" && (
          <span className="flex items-center gap-1.5 text-zinc-600">
            <LoaderCircle className="size-3.5 animate-spin" />
            Saving…
          </span>
        )}
        {state.state === "dirty" && (
          <span className="flex items-center gap-1.5 text-amber-700">
            <span className="size-1.5 rounded-full bg-amber-500" />
            Unsaved changes
          </span>
        )}
        {state.state === "saved" && (
          <span className="flex items-center gap-1.5 text-zinc-600">
            <Check className="size-3.5 text-emerald-600" />
            All changes saved · {formatTime(state.at)}
          </span>
        )}
        {state.state === "error" && (
          <span className="flex min-w-0 items-center gap-1.5 text-red-700">
            <CircleExclamationPoint className="size-3.5 shrink-0" />
            <span className="truncate">{state.error}</span>
            <button type="button" onClick={onRetry} className="shrink-0 font-medium underline underline-offset-2 hover:text-red-900">
              Retry
            </button>
          </span>
        )}
        <span className="hidden text-zinc-300 sm:inline">|</span>
        <span className="hidden text-zinc-500 sm:inline">
          Saves automatically{actingAs === "admin" ? " · editing as administrator" : ""}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={onSave} disabled={state.state === "saving"}>
          <Save />
          Save
        </Button>
        <Button size="sm" onClick={() => window.print()}>
          <Printer />
          Print
        </Button>
        <Button size="sm" onClick={onPdf} disabled={exporting !== null}>
          {exporting === "pdf" ? <LoaderCircle className="animate-spin" /> : <FileDown />}
          Download PDF
        </Button>
        <Button size="sm" onClick={onGoogleDocs} disabled={exporting !== null}>
          {exporting === "docs" ? <LoaderCircle className="animate-spin" /> : <Copy />}
          Copy to Google Docs
        </Button>
      </div>
    </div>
  );
}

/* --------------------------------- Print view -------------------------------- */

function PrintLine({ label, value, className }: { label: string; value?: string; className?: string }) {
  return (
    <div className="flex items-baseline gap-2 py-[2px]">
      <span className="font-bold">{label}</span>
      <span className={cn("doc-line inline-block min-w-[2.7in] px-1", className)}>{value || " "}</span>
    </div>
  );
}

function PrintableDocument({
  kind,
  header,
  rows,
  member,
  org,
  totalHours,
}: {
  kind: EntryKind;
  header: Record<HeaderField, string>;
  rows: LocalRow[];
  member: WorkspaceMember;
  org: OrgInfo;
  totalHours: number;
}) {
  const savedRows = rows.filter((row) => !isBlank(row.values));
  if (kind === "contribution") {
    return (
      <article className="hidden text-[11pt] leading-snug text-black print:block">
        <p className="text-[22pt] leading-none font-bold">{PDF_TEXT.heading}</p>
        <h2 className="mt-4 text-[15pt] font-bold">{PDF_TEXT.memberDocumentation.title}</h2>
        <div className="mt-3">
          <PrintLine label={PDF_TEXT.memberDocumentation.memberName} value={member.fullName} />
          <div className="py-[2px]">
            <span className="font-bold">{PDF_TEXT.memberDocumentation.chapter}</span> {org.chapterName}
          </div>
          <PrintLine label={PDF_TEXT.memberDocumentation.positionRole} value={member.positionName} />
          <PrintLine label={PDF_TEXT.memberDocumentation.documentationPeriod} value={header.period} />
        </div>
        <div className="mt-6 min-h-[2.5in] space-y-3">
          {savedRows.map((row) => (
            <div key={row.key} className="print-break-inside-avoid">
              <p>
                <span className="font-bold">{formatPlainDate(row.values.entry_date) || "Undated"}</span>
                {row.values.title ? ` — ${row.values.title}` : ""}
              </p>
              {row.values.details && <p className="mt-0.5 whitespace-pre-wrap">{row.values.details}</p>}
            </div>
          ))}
        </div>
        <div className="print-break-inside-avoid mt-6">
          <h3 className="text-[13pt] font-bold">{PDF_TEXT.memberDocumentation.verification}</h3>
          <div className="mt-2 space-y-1.5">
            <PrintLine label={PDF_TEXT.memberDocumentation.supervisorName} value={header.supervisor_name} />
            <PrintLine label={PDF_TEXT.memberDocumentation.supervisorPosition} value={header.supervisor_position} />
            <PrintLine label={PDF_TEXT.memberDocumentation.supervisorSignature} value={header.supervisor_signature} className="font-serif italic" />
          </div>
          <hr className="my-4 border-zinc-400" />
          <div className="space-y-1.5">
            <PrintLine label={PDF_TEXT.memberDocumentation.memberConfirmation} value={header.member_confirmation} />
            <PrintLine label={PDF_TEXT.memberDocumentation.dateSubmitted} value={formatPlainDate(header.date_submitted)} />
            <PrintLine label={PDF_TEXT.memberDocumentation.date} value={formatPlainDate(header.verification_date)} />
          </div>
          <p className="mt-6">{PDF_TEXT.certification}</p>
        </div>
      </article>
    );
  }

  const padding = Math.max(0, 10 - savedRows.length);
  return (
    <article className="hidden text-[11pt] leading-snug text-black print:block">
      <p className="text-[22pt] leading-none">{PDF_TEXT.heading}</p>
      <h2 className="mt-4 text-[15pt]">{PDF_TEXT.volunteerHours.title}</h2>
      <div className="mt-3">
        <PrintLine label={PDF_TEXT.volunteerHours.volunteerName} value={member.fullName} />
        <div className="py-[2px]">
          <span className="font-bold">{PDF_TEXT.volunteerHours.organization}</span> {org.organizationName}
        </div>
        <div className="py-[2px]">
          <span className="font-bold">{PDF_TEXT.volunteerHours.chapter}</span> {org.chapterName}
        </div>
        <PrintLine label={PDF_TEXT.volunteerHours.positionRole} value={member.positionName} />
        <PrintLine label={PDF_TEXT.volunteerHours.servicePeriod} value={header.period} />
      </div>
      <h3 className="mt-5 text-[13pt] text-zinc-600">{PDF_TEXT.volunteerHours.sectionTitle}</h3>
      <table className="mt-2 w-full border-collapse text-[10.5pt]">
        <thead>
          <tr>
            <th className="w-[1.3in] border border-zinc-500 px-2 py-1 text-left">{PDF_TEXT.volunteerHours.columnDate}</th>
            <th className="border border-zinc-500 px-2 py-1 text-left">{PDF_TEXT.volunteerHours.columnDescription}</th>
            <th className="w-[0.8in] border border-zinc-500 px-2 py-1 text-right">{PDF_TEXT.volunteerHours.columnHours}</th>
          </tr>
        </thead>
        <tbody>
          {savedRows.map((row) => (
            <tr key={row.key} className="print-break-inside-avoid align-top">
              <td className="border border-zinc-500 px-2 py-1">{formatPlainDate(row.values.service_date, "short")}</td>
              <td className="border border-zinc-500 px-2 py-1 whitespace-pre-wrap">{row.values.description}</td>
              <td className="border border-zinc-500 px-2 py-1 text-right">{row.values.hours}</td>
            </tr>
          ))}
          {Array.from({ length: padding }, (_, index) => (
            <tr key={`pad-${index}`}>
              <td className="h-[0.3in] border border-zinc-500" />
              <td className="border border-zinc-500" />
              <td className="border border-zinc-500" />
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-4">
        <PrintLine label={PDF_TEXT.volunteerHours.total} value={formatHours(totalHours)} className="min-w-[1.2in]" />
      </div>
      <hr className="my-5 border-zinc-400" />
      <div className="print-break-inside-avoid">
        <h3 className="text-[13pt] text-zinc-600">{PDF_TEXT.volunteerHours.verification}</h3>
        <div className="mt-2 space-y-1.5">
          <PrintLine label={PDF_TEXT.volunteerHours.supervisorName} value={header.supervisor_name} />
          <PrintLine label={PDF_TEXT.volunteerHours.supervisorPosition} value={header.supervisor_position} />
          <PrintLine label={PDF_TEXT.volunteerHours.supervisorSignature} value={header.supervisor_signature} className="font-serif italic" />
          <PrintLine label={PDF_TEXT.volunteerHours.date} value={formatPlainDate(header.verification_date)} />
        </div>
        <p className="mt-6">{PDF_TEXT.certification}</p>
      </div>
    </article>
  );
}
