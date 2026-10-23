"use client";

import { Star } from "lucide-react";
import { cn } from "@open-talent/ui";

/** A 1 to 5 star picker (radio group). Clicking the current value clears it when `clearable`. */
export function StarInput({
  value,
  onChange,
  label,
  clearable,
  size = "md",
  testId,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  label: string;
  clearable?: boolean;
  size?: "sm" | "md";
  testId?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex items-center gap-0.5" data-testid={testId}>
      {[1, 2, 3, 4, 5].map((n) => {
        const on = value !== null && n <= value;
        return (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={`${n} star${n > 1 ? "s" : ""}`}
            onClick={() => onChange(clearable && value === n ? null : n)}
            className="rounded-sm p-0.5 transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Star className={cn(size === "sm" ? "size-4" : "size-6", on ? "fill-warning text-warning" : "text-border")} aria-hidden />
          </button>
        );
      })}
    </div>
  );
}

export function StarDisplay({ value, className }: { value: number; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)} aria-label={`${value} out of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} className={cn("size-3.5", n <= Math.round(value) ? "fill-warning text-warning" : "text-border")} aria-hidden />
      ))}
    </span>
  );
}
