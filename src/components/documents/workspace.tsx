import { ArrowRight, BadgeCheck, FileText, Printer, Save, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { ActorBadge, Badge, EmptyState, Panel } from "@/components/ui/primitives";
import { actionLabel } from "@/lib/audit-display";
import { cn } from "@/lib/cn";
import { DOCUMENT_TYPE_LABEL, PERIOD_LABEL } from "@/lib/document-text";
import { formatDateShort, formatDateTimeShort, formatHours } from "@/lib/format";
import type { ActingAs, AuditListItem, DocumentRecord, DocumentSummary, DocumentType, OrgInfo, WorkspaceMember } from "@/lib/types";
import { DocumentEditor } from "./document-editor";
import { DeleteRecordButton, NewRecordButton, RecordListItem } from "./record-actions";

type Props = {
  mode: ActingAs;
  member: WorkspaceMember;
  org: OrgInfo;
  summaries: DocumentSummary[];
  activeType: DocumentType;
  record: DocumentRecord | null;
  basePath: string;
  history?: AuditListItem[];
};

export function DocumentWorkspace({ mode, member, org, summaries, activeType, record, basePath, history }: Props) {
  const ofType = summaries.filter((summary) => summary.documentType === activeType);
  const entryCount = summaries
    .filter((summary) => summary.documentType === "member_documentation")
    .reduce((sum, summary) => sum + summary.entryCount, 0);
  const hoursTotal = summaries
    .filter((summary) => summary.documentType === "volunteer_hours_record")
    .reduce((sum, summary) => sum + summary.hoursTotal, 0);

  const tabs: { type: DocumentType; meta: string }[] = [
    { type: "member_documentation", meta: `${entryCount} ${entryCount === 1 ? "entry" : "entries"}` },
    { type: "volunteer_hours_record", meta: `${formatHours(hoursTotal)} hrs` },
  ];
  const label = DOCUMENT_TYPE_LABEL[activeType];
  const verifiedHours = summaries
    .filter((summary) => summary.documentType === "volunteer_hours_record" && summary.verification)
    .reduce((sum, summary) => sum + summary.hoursTotal, 0);
  const toVerify = summaries.filter((summary) => !summary.verification && summary.entryCount > 0).length;
  const verifiedShare = hoursTotal > 0 ? Math.min(verifiedHours / hoursTotal, 1) : 0;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0">
        {/* At a glance: this member's hours and how much of it is verified. */}
        <dl className="mb-5 grid grid-cols-2 overflow-hidden rounded-lg border border-zinc-200 bg-surface shadow-panel sm:grid-cols-4 print:hidden">
          <div className="border-zinc-200 px-4 py-3">
            <dt className="text-[12px] font-medium text-zinc-500">Volunteer hours</dt>
            <dd className="tabular mt-1 text-[22px] leading-none font-semibold tracking-[-0.02em] text-zinc-950">{formatHours(hoursTotal)}</dd>
          </div>
          <div className="border-l border-zinc-200 px-4 py-3">
            <dt className="text-[12px] font-medium text-zinc-500">Verified</dt>
            <dd className="mt-1">
              <span className="tabular text-[22px] leading-none font-semibold tracking-[-0.02em] text-zinc-950">{formatHours(verifiedHours)}</span>
              <span className="ml-1 text-[12px] text-zinc-500">of {formatHours(hoursTotal)}</span>
              <span
                className="mt-2 block h-1 overflow-hidden rounded-full bg-brand-100"
                role="meter"
                aria-label="Share of hours verified"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(verifiedShare * 100)}
              >
                <span className="block h-full rounded-full bg-chart-verified transition-[width] duration-500" style={{ width: `${verifiedShare * 100}%` }} />
              </span>
            </dd>
          </div>
          <div className="border-t border-zinc-200 px-4 py-3 sm:border-t-0 sm:border-l">
            <dt className="text-[12px] font-medium text-zinc-500">Contributions</dt>
            <dd className="tabular mt-1 text-[22px] leading-none font-semibold tracking-[-0.02em] text-zinc-950">{entryCount}</dd>
          </div>
          <div className="border-t border-l border-zinc-200 px-4 py-3 sm:border-t-0">
            <dt className="text-[12px] font-medium text-zinc-500">Records</dt>
            <dd className="mt-1">
              <span className="tabular text-[22px] leading-none font-semibold tracking-[-0.02em] text-zinc-950">{summaries.length}</span>
              <span className={cn("ml-1.5 text-[12px]", toVerify > 0 ? "text-amber-700" : "text-zinc-500")}>
                {toVerify > 0 ? `${toVerify} awaiting verification` : summaries.some((summary) => summary.verification) ? "all verified" : ""}
              </span>
            </dd>
          </div>
        </dl>
        <nav
          aria-label="Documents"
          className="mb-4 flex gap-1 overflow-x-auto border-b border-zinc-200 [scrollbar-width:none] print:hidden [&::-webkit-scrollbar]:hidden"
        >
          {tabs.map((tab) => {
            const active = tab.type === activeType;
            return (
              <Link
                key={tab.type}
                href={`${basePath}?type=${tab.type}`}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "-mb-px flex items-center gap-2 border-b-2 px-3 py-2.5 text-[13.5px] font-medium whitespace-nowrap transition-colors",
                  active ? "border-brand-700 text-zinc-950" : "border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-800",
                )}
              >
                <FileText className={cn("size-4", active ? "text-brand-700" : "text-zinc-400")} />
                {DOCUMENT_TYPE_LABEL[tab.type]}
                <span className="tabular rounded-[4px] bg-zinc-100 px-1.5 py-px text-[11.5px] font-medium text-zinc-600">{tab.meta}</span>
              </Link>
            );
          })}
        </nav>

        {record ? (
          <DocumentEditor key={record.id} record={record} member={member} org={org} actingAs={mode} />
        ) : (
          <div className="rounded-lg border border-zinc-200 bg-surface shadow-panel">
            <EmptyState
              icon={<FileText />}
              title={`No ${label} record`}
              description={`Create a ${label} record to start documenting.`}
              action={
                <NewRecordButton
                  memberId={member.id}
                  documentType={activeType}
                  actingAs={mode}
                  basePath={basePath}
                  variant="primary"
                  label={`Create ${label}`}
                />
              }
            />
          </div>
        )}
      </div>

      <aside className="space-y-4 print:hidden">
        <Panel
          title={`${label} records`}
          description={`${ofType.length} record${ofType.length === 1 ? "" : "s"} · grouped by ${PERIOD_LABEL[activeType].toLowerCase()}`}
          actions={<NewRecordButton memberId={member.id} documentType={activeType} actingAs={mode} basePath={basePath} />}
        >
          {ofType.length === 0 ? (
            <p className="px-4 py-4 text-[13px] text-zinc-500">No records yet.</p>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {ofType.map((summary) => {
                const active = summary.id === record?.id;
                const href = `${basePath}?type=${activeType}&doc=${summary.id}`;
                return (
                  <RecordListItem
                    key={summary.id}
                    href={href}
                    active={active}
                    target={{ documentId: summary.id, documentType: activeType, actingAs: mode, basePath, periodLabel: summary.period }}
                  >
                    <Link
                      href={href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "block border-l-2 px-4 py-2.5 transition-colors",
                        active ? "border-brand-600 bg-brand-50/60" : "border-transparent hover:bg-zinc-50",
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <p className={cn("min-w-0 flex-1 truncate text-[13px] font-medium", summary.period ? "text-zinc-900" : "text-zinc-500 italic")}>
                          {summary.period || "Period not set"}
                        </p>
                        {summary.verification ? (
                          <Badge tone="success" className="shrink-0">
                            <BadgeCheck className="size-3" aria-hidden />
                            Verified
                          </Badge>
                        ) : (
                          <span className="shrink-0 text-[11.5px] text-zinc-400">Not verified</span>
                        )}
                      </div>
                      <p className="mt-0.5 text-[12px] text-zinc-500">
                        {activeType === "volunteer_hours_record"
                          ? `${formatHours(summary.hoursTotal)} hrs · ${summary.entryCount} ${summary.entryCount === 1 ? "row" : "rows"}`
                          : `${summary.entryCount} ${summary.entryCount === 1 ? "entry" : "entries"}`}
                        {" · "}Updated {formatDateShort(summary.updatedAt)}
                      </p>
                    </Link>
                  </RecordListItem>
                );
              })}
            </ul>
          )}
          {record && (
            <div className="border-t border-zinc-200 px-4 py-3">
              <DeleteRecordButton
                documentId={record.id}
                documentType={record.documentType}
                actingAs={mode}
                basePath={basePath}
                periodLabel={record.fields.period}
              />
            </div>
          )}
        </Panel>

        {mode === "admin" && history && (
          <Panel
            title="Version history"
            description="Every change to this record, newest first"
            actions={
              <Link
                href={`/admin/history?q=${encodeURIComponent(member.fullName)}&document=${activeType}`}
                className="text-[12.5px] font-medium text-brand-700 hover:text-brand-900"
              >
                View all
              </Link>
            }
          >
            {history.length === 0 ? (
              <p className="px-4 py-4 text-[13px] text-zinc-500">No changes recorded yet.</p>
            ) : (
              <ol className="divide-y divide-zinc-100">
                {history.map((item) => (
                  <li key={item.id}>
                    <Link href={`/admin/history/${item.id}`} className="group block px-4 py-2.5 transition-colors hover:bg-zinc-50">
                      <p className="flex items-center justify-between gap-2 text-[13px] font-medium text-zinc-900">
                        <span className="truncate">{item.summary}</span>
                        <ArrowRight className="size-3.5 shrink-0 text-zinc-300 group-hover:text-zinc-500" />
                      </p>
                      <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] text-zinc-500">
                        <ActorBadge type={item.actorType} />
                        <span>{actionLabel(item.action)}</span>
                        <span className="text-zinc-300">·</span>
                        <span>{formatDateTimeShort(item.lastOccurredAt)}</span>
                      </p>
                    </Link>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        )}

        {mode === "member" && (
          <Panel title="How your records work">
            <ul className="space-y-3 px-4 py-3 text-[12.5px] leading-relaxed text-zinc-600">
              <li className="flex gap-2.5">
                <Save className="mt-0.5 size-4 shrink-0 text-zinc-400" />
                Changes save automatically as you type and stay available after you sign out.
              </li>
              <li className="flex gap-2.5">
                <Printer className="mt-0.5 size-4 shrink-0 text-zinc-400" />
                Use Print for a paper copy or Download PDF for a file, both in the official document format. Copy to Google Docs
                opens a new Google Doc you can paste into.
              </li>
              <li className="flex gap-2.5">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-zinc-400" />
                Only you and the chapter administrator can open these records. Changes are logged for verification.
              </li>
            </ul>
          </Panel>
        )}
      </aside>
    </div>
  );
}
