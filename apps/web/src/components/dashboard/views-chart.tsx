"use client";

import { useId, useState } from "react";
import { cn } from "@open-talent/ui";

const dayFmt = (iso: string, opts: Intl.DateTimeFormatOptions) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { timeZone: "UTC", ...opts });

/** Daily profile views as plain SVG bars, with a data table for screen readers and anyone who prefers numbers. */
export function ViewsChart({ daily }: { daily: { date: string; views: number }[] }) {
  const tableId = useId();
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...daily.map((d) => d.views));
  const total = daily.reduce((n, d) => n + d.views, 0);
  const n = daily.length || 1;
  const H = 100;
  const gap = 0.25;
  const active = hover != null ? daily[hover] : null;
  const first = daily[0];
  const last = daily[daily.length - 1];

  return (
    <figure className="space-y-2" data-testid="views-chart">
      <div className="flex items-baseline justify-between gap-2 text-xs text-subtle-foreground">
        <span aria-hidden>{max} max</span>
        <span className="min-h-4 font-medium text-foreground" aria-live="polite">
          {active ? `${dayFmt(active.date, { month: "short", day: "numeric" })}: ${active.views} view${active.views === 1 ? "" : "s"}` : ""}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${n} ${H}`}
        preserveAspectRatio="none"
        className="h-28 w-full overflow-visible"
        role="img"
        aria-label={`Profile views per day over the last ${daily.length} days, ${total} in total. The table below lists each day.`}
        onMouseLeave={() => setHover(null)}
      >
        <line x1={0} x2={n} y1={H} y2={H} className="stroke-border" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        {daily.map((d, i) => {
          const h = d.views ? Math.max(3, (d.views / max) * H) : 1.5;
          return (
            <g key={d.date} onMouseEnter={() => setHover(i)}>
              <rect x={i} y={0} width={1} height={H} fill="transparent" />
              <rect
                x={i + gap / 2}
                y={H - h}
                width={1 - gap}
                height={h}
                rx={0.15}
                className={cn("transition-colors", d.views ? (hover === i ? "fill-primary" : "fill-primary/70") : "fill-muted")}
              />
            </g>
          );
        })}
      </svg>
      {first && last ? (
        <div className="flex justify-between text-2xs text-subtle-foreground" aria-hidden>
          <span>{dayFmt(first.date, { month: "short", day: "numeric" })}</span>
          <span>{dayFmt(last.date, { month: "short", day: "numeric" })}</span>
        </div>
      ) : null}
      <details className="text-sm">
        <summary className="cursor-pointer text-xs font-medium text-link hover:underline" aria-controls={tableId}>
          Show as a table
        </summary>
        <div className="mt-2 max-h-56 overflow-y-auto rounded-md border border-border">
          <table id={tableId} className="w-full text-left text-xs">
            <caption className="sr-only">Profile views per day</caption>
            <thead className="sticky top-0 bg-muted">
              <tr>
                <th scope="col" className="px-3 py-1.5 font-semibold">
                  Day
                </th>
                <th scope="col" className="px-3 py-1.5 text-right font-semibold">
                  Views
                </th>
              </tr>
            </thead>
            <tbody>
              {[...daily].reverse().map((d) => (
                <tr key={d.date} className="border-t border-border">
                  <td className="px-3 py-1.5">{dayFmt(d.date, { weekday: "short", month: "short", day: "numeric" })}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{d.views}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
