"use client";

import { useId, useState } from "react";
import { X } from "lucide-react";
import { cn } from "@open-talent/ui";

/** Chips with an inline text box: Enter or comma adds, Backspace on empty removes the last. */
export function TagInput({
  id,
  value,
  onChange,
  max = 30,
  maxLength = 60,
  placeholder,
  suggestions = [],
  invalid,
  testId,
}: {
  id: string;
  value: string[];
  onChange: (v: string[]) => void;
  max?: number;
  maxLength?: number;
  placeholder?: string;
  suggestions?: string[];
  invalid?: boolean;
  testId?: string;
}) {
  const [draft, setDraft] = useState("");
  const listId = useId();
  const add = (raw: string) => {
    const t = raw.trim().replace(/,$/, "").trim();
    if (!t || value.length >= max) return;
    if (value.some((v) => v.toLowerCase() === t.toLowerCase())) return;
    onChange([...value, t.slice(0, maxLength)]);
  };
  const lower = new Set(value.map((v) => v.toLowerCase()));
  const open = suggestions.filter((s) => !lower.has(s.toLowerCase()));

  return (
    <div>
      <div
        className={cn(
          "flex min-h-10 w-full flex-wrap items-center gap-1.5 rounded-md border border-input bg-card px-2 py-1.5 shadow-sm focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30",
          invalid && "border-danger",
        )}
        data-testid={testId}
      >
        {value.map((t) => (
          <span key={t} className="inline-flex h-7 items-center gap-1 rounded-full bg-primary-soft pl-2.5 pr-1 text-xs font-semibold text-primary-soft-foreground">
            {t}
            <button type="button" onClick={() => onChange(value.filter((v) => v !== t))} className="inline-flex size-5 items-center justify-center rounded-full hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`Remove ${t}`}>
              <X className="size-3" />
            </button>
          </span>
        ))}
        <input
          id={id}
          list={open.length ? listId : undefined}
          value={draft}
          maxLength={maxLength}
          disabled={value.length >= max}
          placeholder={value.length ? undefined : placeholder}
          onChange={(e) => {
            const v = e.target.value;
            if (v.endsWith(",")) {
              add(v);
              setDraft("");
            } else setDraft(v);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add(draft);
              setDraft("");
            } else if (e.key === "Backspace" && !draft && value.length) onChange(value.slice(0, -1));
          }}
          onBlur={() => {
            if (draft.trim()) {
              add(draft);
              setDraft("");
            }
          }}
          className="h-7 min-w-[8rem] flex-1 bg-transparent px-1 text-sm text-foreground outline-none placeholder:text-subtle-foreground"
        />
      </div>
      {open.length ? (
        <datalist id={listId}>
          {open.slice(0, 50).map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      ) : null}
    </div>
  );
}
