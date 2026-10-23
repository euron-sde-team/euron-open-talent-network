"use client";

import type { ReactNode } from "react";
import { Eye, Lock, Pencil, Plus } from "lucide-react";
import { Badge, Card, IconButton, Tooltip, cn } from "@open-talent/ui";
import type { ProfileSection, SectionAudience } from "@open-talent/types";
import { AUDIENCE_LABEL, AUDIENCE_SHORT, SECTION_LABEL } from "./profile-utils";

/** One profile section: heading row with owner controls, then the content. */
export function SectionCard({
  id,
  title,
  onEdit,
  onAdd,
  editLabel,
  audience,
  children,
  className,
  footer,
  testId,
}: {
  id?: string;
  title: ReactNode;
  onEdit?: () => void;
  onAdd?: () => void;
  editLabel?: string;
  audience?: SectionAudience;
  children: ReactNode;
  className?: string;
  footer?: ReactNode;
  testId?: string;
}) {
  return (
    <Card id={id} className={cn("scroll-mt-20", className)} data-testid={testId}>
      <div className="flex items-center justify-between gap-2 px-4 pb-1 pt-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="truncate text-xl font-semibold text-foreground">{title}</h2>
          {audience && audience !== "PUBLIC" ? (
            <Tooltip content={`Visible to: ${AUDIENCE_LABEL[audience]}`}>
              <span tabIndex={0} className="inline-flex rounded-full focus-visible:ring-2">
                <Badge tone="neutral" className="gap-1">
                  <Lock /> {AUDIENCE_SHORT[audience]}
                </Badge>
              </span>
            </Tooltip>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {onAdd ? <IconButton label={`Add to ${typeof title === "string" ? title.toLowerCase() : "section"}`} onClick={onAdd} data-testid={`${testId ?? "section"}-add`}><Plus /></IconButton> : null}
          {onEdit ? (
            <IconButton label={editLabel ?? `Edit ${typeof title === "string" ? title.toLowerCase() : "section"}`} onClick={onEdit} data-testid={`${testId ?? "section"}-edit`}>
              <Pencil />
            </IconButton>
          ) : null}
        </div>
      </div>
      <div className="px-4 pb-4 sm:px-6">{children}</div>
      {footer ? <div className="border-t border-border">{footer}</div> : null}
    </Card>
  );
}

/** Shown in place of a section the viewer is not allowed to see. */
export function HiddenSectionRow({ section }: { section: ProfileSection }) {
  return (
    <Card className="flex items-center gap-3 px-4 py-3 sm:px-6" data-testid={`hidden-section-${section}`}>
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Eye className="size-4" />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground">{SECTION_LABEL[section]}</p>
        <p className="text-sm text-muted-foreground">Shared only with a limited audience the owner chose, such as their connections.</p>
      </div>
    </Card>
  );
}

/** The empty state an owner sees in a section with nothing in it yet. */
export function OwnerEmpty({ text, action }: { text: string; action: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-md border border-dashed border-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-muted-foreground">{text}</p>
      {action}
    </div>
  );
}

/** Thin divider list used by every section. */
export function ItemList({ children }: { children: ReactNode }) {
  return <ul className="divide-y divide-border">{children}</ul>;
}
