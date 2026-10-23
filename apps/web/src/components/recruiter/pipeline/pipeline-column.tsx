"use client";

import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { flattenPages, nextCursor } from "@open-talent/api-client";
import type { Application, ApplicationStage, PipelineColumn as Column } from "@open-talent/types";
import { Button, Checkbox, Spinner, cn } from "@open-talent/ui";
import { api } from "@/lib/api";
import { qk } from "@/lib/query-keys";
import { STAGE_DOT, STAGE_LABEL } from "../format";
import { PipelineCard } from "./pipeline-card";

export interface MoveOverlay {
  app: Application;
  from: ApplicationStage;
  to: ApplicationStage;
}

const EMPTY_COPY: Record<ApplicationStage, string> = {
  APPLIED: "New applications land here.",
  SCREENING: "Drag a card here to start reviewing.",
  INTERVIEW: "Candidates you are interviewing.",
  OFFER: "Offers out.",
  HIRED: "Hires show up here.",
  REJECTED: "Not moving forward.",
  WITHDRAWN: "Candidates who withdrew.",
};

/** Applies in-flight moves on top of what the server last said, so a drop shows at once. */
export function overlayColumn(stage: ApplicationStage, base: Application[], baseCount: number, overlays: MoveOverlay[]) {
  const moving = new Set(overlays.map((o) => o.app.id));
  const incoming = overlays.filter((o) => o.to === stage).map((o) => ({ ...o.app, stage }));
  const leaving = overlays.filter((o) => o.from === stage && o.to !== stage).length;
  const arriving = overlays.filter((o) => o.to === stage && o.from !== stage).length;
  return { items: [...incoming, ...base.filter((a) => !moving.has(a.id))], count: Math.max(0, baseCount - leaving + arriving) };
}

export function PipelineColumnView({
  jobId,
  stage,
  column,
  overlays,
  filter,
  selectedIds,
  selecting,
  dropState,
  onToggle,
  onToggleAll,
  onOpen,
  onMove,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  jobId: string;
  stage: ApplicationStage;
  column: Column | undefined;
  overlays: MoveOverlay[];
  filter: string;
  selectedIds: Set<string>;
  selecting: boolean;
  /** During a drag: whether this column accepts the card(s), and whether it is hovered. */
  dropState: "none" | "allowed" | "blocked" | "over";
  onToggle: (app: Application) => void;
  onToggleAll: (apps: Application[], on: boolean) => void;
  onOpen: (app: Application) => void;
  onMove: (app: Application, to: ApplicationStage) => void;
  onDragStart: (app: Application, e: React.DragEvent) => void;
  onDragEnd: () => void;
  onDragOver: (stage: ApplicationStage, e: React.DragEvent) => void;
  onDragLeave: (stage: ApplicationStage) => void;
  onDrop: (stage: ApplicationStage, e: React.DragEvent) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const more = useInfiniteQuery({
    queryKey: [...qk.pipeline(jobId), "stage", stage],
    queryFn: ({ pageParam }) => api().jobs.stage(jobId, stage, { cursor: pageParam, limit: 30 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextCursor,
    enabled: expanded,
  });
  const serverItems = expanded && more.data ? flattenPages(more.data.pages) : (column?.items ?? []);
  const { items, count } = overlayColumn(stage, serverItems, column?.count ?? 0, overlays);
  const q = filter.trim().toLowerCase();
  const shown = q
    ? items.filter((a) => a.candidate.displayName.toLowerCase().includes(q) || (a.snapshot.headline ?? "").toLowerCase().includes(q) || a.snapshot.skills.some((s) => s.toLowerCase().includes(q)))
    : items;
  const hasMore = expanded ? !!more.hasNextPage : count > items.length;
  const allSelected = shown.length > 0 && shown.every((a) => selectedIds.has(a.id));
  const selectable = shown.filter((a) => a.stage !== "HIRED" && a.stage !== "WITHDRAWN");

  return (
    <section
      aria-label={`${STAGE_LABEL[stage]}, ${count}`}
      data-testid={`pipeline-column-${stage.toLowerCase()}`}
      onDragOver={(e) => onDragOver(stage, e)}
      onDragLeave={() => onDragLeave(stage)}
      onDrop={(e) => onDrop(stage, e)}
      className={cn(
        "flex h-full w-[284px] shrink-0 flex-col rounded-xl border bg-muted/60 transition-[background-color,border-color,opacity] sm:w-[300px]",
        dropState === "over" ? "border-primary bg-primary/10" : dropState === "allowed" ? "border-dashed border-primary/50" : "border-border",
        dropState === "blocked" && "opacity-50",
      )}
    >
      <header className="sticky top-0 z-10 flex items-center gap-2 rounded-t-xl border-b border-border bg-muted px-3 py-2.5">
        <span className={cn("size-2.5 shrink-0 rounded-full", STAGE_DOT[stage])} aria-hidden />
        <h2 className="text-sm font-semibold">{STAGE_LABEL[stage]}</h2>
        <span className="rounded-full bg-card px-2 text-xs font-semibold tabular-nums text-muted-foreground" data-testid="pipeline-column-count">
          {count}
        </span>
        {selecting && selectable.length ? (
          <label className="ml-auto flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Checkbox checked={allSelected} onCheckedChange={(c) => onToggleAll(selectable, c === true)} aria-label={`Select all in ${STAGE_LABEL[stage]}`} />
            All
          </label>
        ) : null}
      </header>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2 [scrollbar-width:thin]">
        {shown.map((app) => (
          <PipelineCard
            key={app.id}
            app={app}
            selected={selectedIds.has(app.id)}
            selecting={selecting}
            pending={overlays.some((o) => o.app.id === app.id)}
            onToggle={onToggle}
            onOpen={onOpen}
            onMove={onMove}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
          />
        ))}
        {!shown.length ? (
          <p className={cn("rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-subtle-foreground", dropState === "over" && "border-primary text-primary")}>
            {q ? "No loaded cards match." : dropState === "over" ? `Drop to move to ${STAGE_LABEL[stage]}` : EMPTY_COPY[stage]}
          </p>
        ) : null}
        {hasMore ? (
          <div className="flex justify-center py-1">
            {more.isFetching ? (
              <Spinner size="sm" />
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => (expanded ? void more.fetchNextPage() : setExpanded(true))}
                data-testid="pipeline-column-more"
              >
                Show more ({Math.max(0, count - items.length)})
              </Button>
            )}
          </div>
        ) : null}
      </div>
    </section>
  );
}
