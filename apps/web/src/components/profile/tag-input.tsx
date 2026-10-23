"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { cn } from "@open-talent/ui";

/** Chips plus a text box: Enter or comma adds, Backspace on an empty box removes the last one. */
export function TagInput({
  id,
  value,
  onChange,
  max = 20,
  maxLength = 60,
  placeholder = "Type and press Enter",
  "aria-label": ariaLabel,
  testId,
}: {
  id?: string;
  value: string[];
  onChange: (v: string[]) => void;
  max?: number;
  maxLength?: number;
  placeholder?: string;
  "aria-label"?: string;
  testId?: string;
}) {
  const [draft, setDraft] = useState("");
  const add = (raw: string) => {
    const parts = raw
      .split(",")
      .map((s) => s.trim().slice(0, maxLength))
      .filter(Boolean);
    if (!parts.length) return;
    const seen = new Set(value.map((v) => v.toLowerCase()));
    const next = [...value];
    for (const p of parts) {
      if (next.length >= max) break;
      if (seen.has(p.toLowerCase())) continue;
      seen.add(p.toLowerCase());
      next.push(p);
    }
    onChange(next);
    setDraft("");
  };
  const full = value.length >= max;
  return (
    <div
      className="flex min-h-10 w-full flex-wrap items-center gap-1.5 rounded-md border border-input bg-card px-2 py-1.5 shadow-sm focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30"
      data-testid={testId}
    >
      {value.map((t) => (
        <span key={t} className="inline-flex h-6 items-center gap-1 rounded-full bg-muted pl-2.5 pr-1 text-xs font-semibold text-foreground">
          {t}
          <button type="button" onClick={() => onChange(value.filter((v) => v !== t))} className="inline-flex size-4 items-center justify-center rounded-full text-muted-foreground hover:bg-card hover:text-foreground" aria-label={`Remove ${t}`}>
            <X className="size-3" />
          </button>
        </span>
      ))}
      <input
        id={id}
        value={draft}
        disabled={full}
        aria-label={ariaLabel}
        onChange={(e) => {
          const v = e.target.value;
          if (v.includes(",")) add(v);
          else setDraft(v);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add(draft);
          } else if (e.key === "Backspace" && !draft && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={() => add(draft)}
        placeholder={full ? `Up to ${max}` : value.length ? "" : placeholder}
        className={cn("h-7 min-w-[8rem] flex-1 bg-transparent px-1 text-sm text-foreground outline-none placeholder:text-subtle-foreground disabled:cursor-not-allowed")}
      />
    </div>
  );
}
