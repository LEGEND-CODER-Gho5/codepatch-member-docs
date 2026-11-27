import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { ActorBadge } from "@/components/ui/primitives";
import { documentLabel } from "@/lib/audit-display";
import { formatDateTime } from "@/lib/format";
import type { AuditListItem } from "@/lib/types";

export function ActivityList({ items, emptyText = "No activity recorded yet." }: { items: AuditListItem[]; emptyText?: string }) {
  if (items.length === 0) return <p className="px-4 py-8 text-center text-[13px] text-zinc-500">{emptyText}</p>;
  return (
    <ul className="divide-y divide-zinc-100">
      {items.map((item) => (
        <li key={item.id}>
          <Link href={`/admin/history/${item.id}`} className="group flex items-start gap-3 px-4 py-3 transition-colors hover:bg-zinc-50">
            <div className="min-w-0 flex-1">
              <p className="text-[13px] leading-snug text-zinc-900">
                <span className="font-medium">{item.actorName}</span>
                <span className="text-zinc-600"> — {item.summary}</span>
                {item.memberName && item.memberName !== item.actorName && (
                  <span className="text-zinc-600"> for {item.memberName}</span>
                )}
              </p>
              <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] text-zinc-500">
                <ActorBadge type={item.actorType} />
                <span>{documentLabel(item)}</span>
                <span className="text-zinc-300">·</span>
                <span>{formatDateTime(item.lastOccurredAt)}</span>
                {item.revisionCount > 1 && (
                  <>
                    <span className="text-zinc-300">·</span>
                    <span>{item.revisionCount} saves</span>
                  </>
                )}
              </p>
            </div>
            <ChevronRight className="mt-1 size-4 shrink-0 text-zinc-300 group-hover:text-zinc-500" />
          </Link>
        </li>
      ))}
    </ul>
  );
}
