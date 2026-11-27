import { ArrowLeft, ExternalLink } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DiffView } from "@/components/admin/diff-view";
import { RestoreButton } from "@/components/admin/restore-button";
import { ButtonLink } from "@/components/ui/button";
import { ActorBadge, Badge, PageHeader, Panel } from "@/components/ui/primitives";
import { actionLabel, documentLabel, ENTITY_LABELS, isRestorable } from "@/lib/audit-display";
import { PERIOD_LABEL } from "@/lib/document-text";
import { APP_TIME_ZONE, formatDateLong, formatDateTime, formatTimeWithSeconds, timeZoneAbbreviation } from "@/lib/format";
import { requireAdminPage } from "@/lib/server/auth";
import { getAuditDetail, getDocumentRecord, getWorkspaceMember } from "@/lib/server/queries";

export const metadata: Metadata = { title: "History record" };

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[150px_1fr] gap-3 border-b border-zinc-100 px-4 py-2.5 text-[13px] last:border-0">
      <dt className="text-zinc-500">{label}</dt>
      <dd className="min-w-0 text-zinc-900">{children}</dd>
    </div>
  );
}

export default async function HistoryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPage();
  const { id } = await params;
  const audit = await getAuditDetail(Number(id));
  if (!audit) notFound();

  const [member, document] = await Promise.all([
    audit.memberId ? getWorkspaceMember(audit.memberId) : null,
    audit.documentId ? getDocumentRecord(audit.documentId) : null,
  ]);
  const documentLink =
    document && member ? `/admin/documentation/${member.id}?type=${document.documentType}&doc=${document.id}` : null;
  const previous = (audit.previousValues as Record<string, unknown> | null) ?? null;
  const next = (audit.newValues as Record<string, unknown> | null) ?? null;

  return (
    <>
      <Link href="/admin/history" className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-zinc-500 hover:text-zinc-900">
        <ArrowLeft className="size-4" />
        Edit History
      </Link>
      <PageHeader
        eyebrow={`History record #${audit.id}`}
        title={audit.summary}
        description={
          <>
            {audit.actorName} ({audit.actorType === "admin" ? "Administrator" : audit.actorType === "member" ? "Member" : "System"}) ·{" "}
            {formatDateTime(audit.lastOccurredAt)}
          </>
        }
        actions={
          <>
            {documentLink && (
              <ButtonLink href={documentLink}>
                <ExternalLink />
                Open document
              </ButtonLink>
            )}
            {isRestorable(audit) && previous && <RestoreButton auditId={audit.id} deleted={audit.action === "deleted"} />}
          </>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
        <Panel title="Record details">
          <dl>
            <Row label="Actor">{audit.actorName}</Row>
            <Row label="Actor type">
              <ActorBadge type={audit.actorType} />
            </Row>
            <Row label="Member">
              {audit.memberName ? (
                member ? (
                  <Link href={`/admin/members/${member.id}`} className="text-brand-800 hover:underline">
                    {audit.memberName}
                  </Link>
                ) : (
                  <>
                    {audit.memberName} <span className="text-zinc-400">(account deleted)</span>
                  </>
                )
              ) : (
                "—"
              )}
            </Row>
            <Row label="Department">{audit.departmentName ?? "—"}</Row>
            <Row label="Action">
              <Badge tone="neutral">{actionLabel(audit.action)}</Badge>
            </Row>
            <Row label="Document">{documentLabel(audit)}</Row>
            <Row label="Record type">{ENTITY_LABELS[audit.entityType] ?? audit.entityType}</Row>
            <Row label="Record ID">
              <span className="font-mono text-[12px] break-all text-zinc-600">{audit.recordId ?? "—"}</span>
            </Row>
            <Row label="Date">{formatDateLong(audit.lastOccurredAt)}</Row>
            <Row label="Time">{formatTimeWithSeconds(audit.lastOccurredAt)}</Row>
            <Row label="Timezone">
              {APP_TIME_ZONE} ({timeZoneAbbreviation(audit.lastOccurredAt)})
            </Row>
            {audit.revisionCount > 1 && (
              <Row label="Editing session">
                {audit.revisionCount} saves between {formatTimeWithSeconds(audit.occurredAt)} and {formatTimeWithSeconds(audit.lastOccurredAt)}
              </Row>
            )}
            <Row label="Server timestamp">
              <span className="font-mono text-[12px] text-zinc-600">{audit.lastOccurredAt}</span>
            </Row>
          </dl>
        </Panel>

        <Panel
          title="Changes"
          description={
            audit.action === "created"
              ? "Values recorded when this was created"
              : audit.action === "deleted"
                ? "Content at the moment it was deleted"
                : "Previous version compared with the new version"
          }
          bodyClassName="pb-1"
        >
          <DiffView previous={previous} next={next} periodLabel={audit.documentType ? PERIOD_LABEL[audit.documentType] : "Period"} />
        </Panel>
      </div>
    </>
  );
}
