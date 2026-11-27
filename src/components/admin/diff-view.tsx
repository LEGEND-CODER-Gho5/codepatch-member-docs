import { diffWordsWithSpace } from "diff";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { FIELD_LABELS } from "@/lib/document-text";
import { formatPlainDate } from "@/lib/format";

type Values = Record<string, unknown> | null;

const ORDER = [
  "member_code",
  "full_name",
  "department",
  "other_departments",
  "position",
  "status",
  "email",
  "start_date",
  "name",
  "description",
  "sort_order",
  "period",
  "entry_date",
  "service_date",
  "title",
  "details",
  "hours",
  "supervisor_name",
  "supervisor_position",
  "supervisor_signature",
  "member_confirmation",
  "date_submitted",
  "verification_date",
];

function labelFor(key: string, periodLabel: string) {
  if (key === "period") return periodLabel;
  return FIELD_LABELS[key] ?? key.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

function isDateKey(key: string) {
  return /(^|_)date$|date_submitted|start_date|verification_date/.test(key);
}

function display(key: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "string" && isDateKey(key) && /^\d{4}-\d{2}-\d{2}$/.test(value)) return formatPlainDate(value);
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function Empty() {
  return <span className="text-zinc-400 italic">empty</span>;
}

function WordDiff({ before, after, side }: { before: string; after: string; side: "before" | "after" }) {
  const parts = diffWordsWithSpace(before, after);
  return (
    <span className="whitespace-pre-wrap">
      {parts.map((part, index) => {
        if (part.added) {
          return side === "after" ? (
            <ins key={index} className="rounded-[2px] bg-emerald-100 text-emerald-900 no-underline">
              {part.value}
            </ins>
          ) : null;
        }
        if (part.removed) {
          return side === "before" ? (
            <del key={index} className="rounded-[2px] bg-red-100 text-red-900">
              {part.value}
            </del>
          ) : null;
        }
        return <span key={index}>{part.value}</span>;
      })}
    </span>
  );
}

function NestedList({ items }: { items: unknown[] }) {
  if (items.length === 0) return <Empty />;
  return (
    <ol className="space-y-2">
      {items.map((item, index) => (
        <li key={index} className="rounded border border-zinc-200 bg-surface px-2.5 py-2 text-[12.5px]">
          {item && typeof item === "object" ? (
            <dl className="space-y-0.5">
              {Object.entries(item as Record<string, unknown>)
                .filter(([key]) => !["document_id", "id", "member_id", "created_at", "updated_at"].includes(key))
                .map(([key, value]) => (
                  <div key={key} className="flex gap-2">
                    <dt className="shrink-0 text-zinc-500">{FIELD_LABELS[key] ?? key}:</dt>
                    <dd className="min-w-0 whitespace-pre-wrap text-zinc-800">{display(key, value) || <Empty />}</dd>
                  </div>
                ))}
            </dl>
          ) : (
            String(item)
          )}
        </li>
      ))}
    </ol>
  );
}

export function DiffView({ previous, next, periodLabel = "Period" }: { previous: Values; next: Values; periodLabel?: string }) {
  const keys = [...new Set([...Object.keys(previous ?? {}), ...Object.keys(next ?? {})])].sort((a, b) => {
    const ia = ORDER.indexOf(a);
    const ib = ORDER.indexOf(b);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });

  if (keys.length === 0) {
    return <p className="px-4 py-6 text-[13px] text-zinc-500">No field values were recorded for this action.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-[13px]">
        <thead>
          <tr>
            <th className="w-[190px] border-b border-zinc-200 bg-zinc-50/80 px-4 py-2 text-left text-[11.5px] font-semibold tracking-[0.02em] text-zinc-500 uppercase">
              Field
            </th>
            <th className="border-b border-zinc-200 bg-zinc-50/80 px-4 py-2 text-left text-[11.5px] font-semibold tracking-[0.02em] text-zinc-500 uppercase">
              Previous version
            </th>
            <th className="border-b border-zinc-200 bg-zinc-50/80 px-4 py-2 text-left text-[11.5px] font-semibold tracking-[0.02em] text-zinc-500 uppercase">
              New version
            </th>
          </tr>
        </thead>
        <tbody>
          {keys.map((key) => {
            const before = previous ? previous[key] : undefined;
            const after = next ? next[key] : undefined;
            const changed = previous !== null && next !== null && JSON.stringify(before ?? null) !== JSON.stringify(after ?? null);
            let beforeNode: ReactNode;
            let afterNode: ReactNode;
            if (Array.isArray(before) || Array.isArray(after)) {
              beforeNode = previous ? Array.isArray(before) ? <NestedList items={before} /> : <Empty /> : <span className="text-zinc-400">—</span>;
              afterNode = next ? Array.isArray(after) ? <NestedList items={after} /> : <Empty /> : <span className="text-zinc-400">—</span>;
            } else {
              const a = display(key, before);
              const b = display(key, after);
              const useWordDiff = changed && a.length > 0 && b.length > 0 && (a.length > 24 || b.length > 24);
              beforeNode = previous === null ? (
                <span className="text-zinc-400">—</span>
              ) : useWordDiff ? (
                <WordDiff before={a} after={b} side="before" />
              ) : a ? (
                <span className="whitespace-pre-wrap">{a}</span>
              ) : (
                <Empty />
              );
              afterNode = next === null ? (
                <span className="text-zinc-400">—</span>
              ) : useWordDiff ? (
                <WordDiff before={a} after={b} side="after" />
              ) : b ? (
                <span className="whitespace-pre-wrap">{b}</span>
              ) : (
                <Empty />
              );
            }
            return (
              <tr key={key} className={cn("align-top", changed && "bg-amber-50/50")}>
                <td className={cn("border-b border-zinc-100 px-4 py-2.5 font-medium text-zinc-700", changed && "border-l-2 border-l-amber-400")}>
                  {labelFor(key, periodLabel)}
                  {changed && <span className="ml-1.5 text-[11px] font-normal text-amber-700">changed</span>}
                </td>
                <td className="border-b border-zinc-100 px-4 py-2.5 text-zinc-800">{beforeNode}</td>
                <td className="border-b border-zinc-100 px-4 py-2.5 text-zinc-900">{afterNode}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
