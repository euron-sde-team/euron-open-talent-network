"use client";

import { useState } from "react";
import { Star } from "lucide-react";
import { cn } from "@open-talent/ui";
import type { RatingSummary } from "@open-talent/types";

/** Read-only stars for an average (partial stars by clipping). */
export function Stars({ value, className, size = "size-3.5" }: { value: number; className?: string; size?: string }) {
  return (
    <span className={cn("relative inline-flex", className)} aria-hidden>
      <span className="flex text-border">
        {Array.from({ length: 5 }, (_, i) => (
          <Star key={i} className={cn(size, "fill-current")} />
        ))}
      </span>
      <span className="absolute inset-y-0 left-0 flex overflow-hidden text-warning" style={{ width: `${Math.max(0, Math.min(5, value)) * 20}%` }}>
        {Array.from({ length: 5 }, (_, i) => (
          <Star key={i} className={cn(size, "shrink-0 fill-current")} />
        ))}
      </span>
    </span>
  );
}

/** "4.6 (12 ratings)" with stars; nothing when there are no ratings yet. */
export function RatingLine({ rating, className }: { rating: RatingSummary; className?: string }) {
  if (!rating.count || rating.average == null) return null;
  const avg = rating.average.toFixed(1);
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs text-muted-foreground", className)} aria-label={`Rated ${avg} out of 5 from ${rating.count} rating${rating.count === 1 ? "" : "s"}`}>
      <Stars value={rating.average} />
      <span className="font-semibold text-foreground">{avg}</span>
      <span>({rating.count})</span>
    </span>
  );
}

/** Interactive 1 to 5 star input, a radio group under the hood. */
export function StarInput({ value, onChange, label, testId }: { value: number; onChange: (v: number) => void; label: string; testId?: string }) {
  const [hover, setHover] = useState(0);
  const shown = hover || value;
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex items-center gap-0.5" onMouseLeave={() => setHover(0)} data-testid={testId}>
      {Array.from({ length: 5 }, (_, i) => {
        const n = i + 1;
        return (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={`${n} star${n === 1 ? "" : "s"}`}
            onMouseEnter={() => setHover(n)}
            onClick={() => onChange(n)}
            onKeyDown={(e) => {
              let next = 0;
              if (e.key === "ArrowRight" || e.key === "ArrowUp") next = Math.min(5, (value || 0) + 1);
              else if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = Math.max(1, (value || 2) - 1);
              if (!next) return;
              e.preventDefault();
              onChange(next);
              (e.currentTarget.parentElement?.children[next - 1] as HTMLElement | undefined)?.focus();
            }}
            tabIndex={value ? (value === n ? 0 : -1) : n === 1 ? 0 : -1}
            className="rounded p-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Star className={cn("size-6 transition-colors", n <= shown ? "fill-warning text-warning" : "text-border")} />
          </button>
        );
      })}
    </div>
  );
}
