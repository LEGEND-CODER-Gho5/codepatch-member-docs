"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { formatHours } from "@/lib/format";

export type MonthlyHoursPoint = { month: string; verified: number; awaiting: number };

const monthShort = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" });
const monthLong = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

function monthDate(key: string) {
  const [year, month] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1));
}

/** A clean axis: 0 to a round number in 1/2/5 steps, about four gridlines. */
function niceScale(max: number): { top: number; ticks: number[] } {
  if (max <= 0) return { top: 4, ticks: [0, 1, 2, 3, 4] };
  const rough = max / 4;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((candidate) => candidate >= rough) ?? 10 * power;
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let value = 0; value <= top + step / 2; value += step) ticks.push(Number(value.toFixed(6)));
  return { top, ticks };
}

/**
 * Volunteer hours by month, stacked: hours in verified records (solid) and
 * hours still awaiting verification (lighter). Hover, tap, or focus a month for
 * its figures; the table view lists every value.
 */
export function HoursChart({ data }: { data: MonthlyHoursPoint[] }) {
  const [active, setActive] = useState<number | null>(null);
  const totals = data.map((point) => point.verified + point.awaiting);
  const { top, ticks } = niceScale(Math.max(...totals, 0));
  const sumVerified = data.reduce((sum, point) => sum + point.verified, 0);
  const sumAwaiting = data.reduce((sum, point) => sum + point.awaiting, 0);
  const empty = sumVerified + sumAwaiting === 0;
  const point = active === null ? null : data[active];

  return (
    <figure className="px-4 pt-4 pb-3">
      <figcaption className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div>
          <p className="tabular text-[26px] leading-none font-semibold tracking-[-0.02em] text-zinc-950">
            {formatHours(sumVerified + sumAwaiting)}
            <span className="ml-1.5 text-[14px] font-medium tracking-normal text-zinc-500">hours in the last 12 months</span>
          </p>
          <p className="mt-1.5 text-[12.5px] text-zinc-500">
            {empty ? "No volunteer hours recorded in this period yet." : `${formatHours(sumVerified)} verified, ${formatHours(sumAwaiting)} awaiting verification`}
          </p>
        </div>
        <ul className="flex gap-4 text-[12.5px] text-zinc-600" aria-label="Legend">
          <li className="flex items-center gap-1.5">
            <span aria-hidden className="size-2.5 rounded-[3px] bg-chart-verified" />
            Verified
          </li>
          <li className="flex items-center gap-1.5">
            <span aria-hidden className="size-2.5 rounded-[3px] bg-chart-awaiting" />
            Awaiting verification
          </li>
        </ul>
      </figcaption>

      <div className="relative">
        {/* Gridlines and their labels */}
        <div aria-hidden className="pointer-events-none absolute inset-0 bottom-6 left-9">
          {ticks.map((tick) => (
            <div
              key={tick}
              className={cn("absolute right-0 left-0 border-t", tick === 0 ? "border-zinc-300" : "border-zinc-200/80")}
              style={{ bottom: `${(tick / top) * 100}%` }}
            >
              <span className="tabular absolute top-0 -left-9 w-7 -translate-y-1/2 text-right text-[11px] text-zinc-400">{formatHours(tick)}</span>
            </div>
          ))}
        </div>

        <div className="relative ml-9 grid h-[188px] grid-cols-12 items-end pb-6" onMouseLeave={() => setActive(null)}>
          {data.map((entry, index) => {
            const total = totals[index];
            const height = total > 0 ? Math.max((total / top) * 100, 1.5) : 0;
            const date = monthDate(entry.month);
            const isActive = active === index;
            return (
              <div
                key={entry.month}
                role="button"
                tabIndex={0}
                aria-label={`${monthLong.format(date)}: ${formatHours(total)} hours, ${formatHours(entry.verified)} verified, ${formatHours(entry.awaiting)} awaiting verification`}
                onMouseEnter={() => setActive(index)}
                onFocus={() => setActive(index)}
                onBlur={() => setActive(null)}
                onClick={() => setActive(isActive ? null : index)}
                className="group relative flex h-full flex-col items-center justify-end rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
              >
                <span aria-hidden className={cn("absolute inset-x-[12%] top-0 bottom-0 rounded-md transition-colors", isActive && "bg-zinc-100")} />
                {total > 0 && (
                  <div
                    data-motion
                    className="relative flex w-[58%] max-w-6 origin-bottom animate-[bar-rise_560ms_cubic-bezier(0.2,0.8,0.2,1)_both] flex-col gap-[2px]"
                    style={{ height: `${height}%`, animationDelay: `${40 + index * 22}ms` }}
                  >
                    {entry.awaiting > 0 && (
                      <span className="block w-full rounded-t-[4px] bg-chart-awaiting" style={{ flexGrow: entry.awaiting }} />
                    )}
                    {entry.verified > 0 && (
                      <span
                        className={cn("block w-full bg-chart-verified", entry.awaiting === 0 && "rounded-t-[4px]")}
                        style={{ flexGrow: entry.verified }}
                      />
                    )}
                  </div>
                )}
                <span
                  className={cn(
                    "absolute -bottom-0.5 translate-y-full text-[11px] transition-colors",
                    isActive ? "font-medium text-zinc-900" : "text-zinc-400",
                  )}
                >
                  {monthShort.format(date)}
                </span>
              </div>
            );
          })}

          {point && active !== null && (
            <div
              role="status"
              className="pointer-events-none absolute z-10 w-44 rounded-md border border-zinc-200 bg-surface px-3 py-2 text-[12px] shadow-raised"
              // Beside the month, inside the plot: toward the middle, never over the bar or past an edge.
              style={
                active >= data.length / 2
                  ? { top: 0, right: `calc(${100 - ((active + 0.5) / data.length) * 100}% + 18px)` }
                  : { top: 0, left: `calc(${((active + 0.5) / data.length) * 100}% + 18px)` }
              }
            >
              <p className="font-semibold text-zinc-900">{monthLong.format(monthDate(point.month))}</p>
              <dl className="mt-1 space-y-0.5">
                <div className="flex items-center justify-between gap-3">
                  <dt className="flex items-center gap-1.5 text-zinc-600">
                    <span aria-hidden className="size-2 rounded-[2px] bg-chart-verified" />
                    Verified
                  </dt>
                  <dd className="tabular font-medium text-zinc-900">{formatHours(point.verified)}</dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="flex items-center gap-1.5 text-zinc-600">
                    <span aria-hidden className="size-2 rounded-[2px] bg-chart-awaiting" />
                    Awaiting
                  </dt>
                  <dd className="tabular font-medium text-zinc-900">{formatHours(point.awaiting)}</dd>
                </div>
                <div className="flex justify-between gap-3 border-t border-zinc-100 pt-0.5">
                  <dt className="text-zinc-500">Total</dt>
                  <dd className="tabular font-semibold text-zinc-950">{formatHours(totals[active])} hours</dd>
                </div>
              </dl>
            </div>
          )}
        </div>
      </div>

      <details className="mt-1 text-[12.5px]">
        <summary className="w-fit rounded text-zinc-500 hover:text-zinc-800">View as a table</summary>
        <table className="mt-2 w-full max-w-md text-left">
          <thead>
            <tr className="text-zinc-500">
              <th className="py-1 font-medium">Month</th>
              <th className="py-1 text-right font-medium">Verified</th>
              <th className="py-1 text-right font-medium">Awaiting</th>
              <th className="py-1 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody className="tabular">
            {data.map((entry, index) => (
              <tr key={entry.month} className="border-t border-zinc-100 text-zinc-800">
                <td className="py-1">{monthLong.format(monthDate(entry.month))}</td>
                <td className="py-1 text-right">{formatHours(entry.verified)}</td>
                <td className="py-1 text-right">{formatHours(entry.awaiting)}</td>
                <td className="py-1 text-right font-medium">{formatHours(totals[index])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
