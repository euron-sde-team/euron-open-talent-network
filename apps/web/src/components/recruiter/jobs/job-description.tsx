"use client";

import { cn } from "@open-talent/ui";

/**
 * A light reading of plain text: blank lines split blocks, "- " or "* " lines become a
 * list, and a short single line with no closing punctuation reads as a heading. No HTML
 * is ever interpreted.
 */
export function JobDescription({ text, className }: { text: string; className?: string }) {
  const blocks = text.replace(/\r\n/g, "\n").split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  if (!blocks.length) return <p className={cn("text-sm text-subtle-foreground", className)}>Nothing to preview yet.</p>;
  return (
    <div className={cn("space-y-3 text-sm leading-relaxed text-foreground", className)}>
      {blocks.map((b, i) => {
        const lines = b.split("\n");
        if (lines.every((l) => /^\s*[-*]\s+/.test(l))) {
          return (
            <ul key={i} className="list-disc space-y-1 pl-5">
              {lines.map((l, j) => (
                <li key={j}>{l.replace(/^\s*[-*]\s+/, "")}</li>
              ))}
            </ul>
          );
        }
        if (lines.length === 1 && b.length <= 60 && !/[.!?:;,]$/.test(b)) {
          return (
            <h3 key={i} className="pt-1 text-base font-semibold">
              {b}
            </h3>
          );
        }
        return (
          <p key={i} className="whitespace-pre-wrap break-words">
            {b}
          </p>
        );
      })}
    </div>
  );
}
