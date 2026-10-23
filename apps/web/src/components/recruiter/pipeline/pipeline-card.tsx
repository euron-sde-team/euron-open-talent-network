"use client";

import { Fragment, memo } from "react";
import { ArrowRightLeft, MessageSquareText, MoreHorizontal, Star } from "lucide-react";
import type { Application, ApplicationStage } from "@open-talent/types";
import { Avatar, Badge, Checkbox, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, IconButton, Tooltip, cn } from "@open-talent/ui";
import { TimeAgo } from "@/components/common/time-ago";
import { SOURCE_LABEL, STAGE_DOT, STAGE_LABEL, matchTone, moveTargets } from "../format";

export function MoveToMenu({
  from,
  onMove,
  trigger,
  align = "end",
}: {
  from: ApplicationStage;
  onMove: (to: ApplicationStage) => void;
  trigger: React.ReactNode;
  align?: "start" | "end";
}) {
  const targets = moveTargets(from);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align={align} onClick={(e) => e.stopPropagation()}>
        <DropdownMenuLabel>Move to</DropdownMenuLabel>
        {targets.length ? (
          targets.map((s, i) => (
            <Fragment key={s}>
              {s === "REJECTED" && i > 0 ? <DropdownMenuSeparator /> : null}
              <DropdownMenuItem onSelect={() => onMove(s)} data-testid={`move-to-${s.toLowerCase()}`} className={cn(s === "REJECTED" && "text-danger")}>
                <span className={cn("size-2 rounded-full", STAGE_DOT[s])} aria-hidden />
                {STAGE_LABEL[s]}
              </DropdownMenuItem>
            </Fragment>
          ))
        ) : (
          <DropdownMenuItem disabled>{from === "WITHDRAWN" ? "The candidate withdrew" : "This application is closed"}</DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export const PipelineCard = memo(function PipelineCard({
  app,
  selected,
  selecting,
  pending,
  onToggle,
  onOpen,
  onMove,
  onDragStart,
  onDragEnd,
}: {
  app: Application;
  selected: boolean;
  selecting: boolean;
  pending: boolean;
  onToggle: (app: Application) => void;
  onOpen: (app: Application) => void;
  onMove: (app: Application, to: ApplicationStage) => void;
  onDragStart: (app: Application, e: React.DragEvent) => void;
  onDragEnd: () => void;
}) {
  const headline = app.snapshot.headline ?? app.candidate.headline;
  const movable = moveTargets(app.stage).length > 0;
  return (
    <article
      draggable={movable}
      onDragStart={(e) => onDragStart(app, e)}
      onDragEnd={onDragEnd}
      onClick={() => onOpen(app)}
      aria-label={`${app.candidate.displayName}, ${STAGE_LABEL[app.stage]}`}
      data-testid="pipeline-card"
      data-stage={app.stage}
      className={cn(
        "group relative cursor-pointer rounded-lg border bg-card p-3 shadow-card transition-[box-shadow,border-color,opacity] hover:border-primary/40 hover:shadow-popover",
        selected ? "border-primary ring-1 ring-primary" : "border-border",
        pending && "opacity-70",
        movable && "active:cursor-grabbing",
      )}
    >
      <div className="flex items-start gap-2.5">
        <div className="relative shrink-0">
          <Avatar name={app.candidate.displayName} seed={app.candidate.id} src={app.candidate.avatarUrl} size="md" openToWork={app.candidate.openToWork} />
          <span
            className={cn(
              "absolute -left-1.5 -top-1.5 rounded-[6px] bg-card transition-opacity",
              selecting || selected ? "opacity-100" : "opacity-0 focus-within:opacity-100 group-hover:opacity-100",
            )}
            onClick={(e) => e.stopPropagation()}
          >
            <Checkbox checked={selected} onCheckedChange={() => onToggle(app)} aria-label={`Select ${app.candidate.displayName}`} data-testid="pipeline-card-select" />
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpen(app);
            }}
            className="block max-w-full truncate text-left text-sm font-semibold text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-testid="pipeline-card-open"
          >
            {app.candidate.displayName}
          </button>
          {headline ? <p className="line-clamp-2 text-xs text-muted-foreground">{headline}</p> : null}
        </div>
        <span onClick={(e) => e.stopPropagation()}>
          <MoveToMenu
            from={app.stage}
            onMove={(to) => onMove(app, to)}
            trigger={
              <IconButton label={`Move ${app.candidate.displayName}`} size="sm" className="-mr-1 -mt-1" data-testid="pipeline-card-menu">
                <MoreHorizontal />
              </IconButton>
            }
          />
        </span>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {app.matchScore !== null ? (
          <Tooltip content={app.matchDetail ? `Matches ${app.matchDetail.matched.length} of ${app.matchDetail.matched.length + app.matchDetail.missing.length} job skills` : "Skill match"}>
            <Badge tone={matchTone(app.matchScore)} className="tabular-nums">
              {app.matchScore}% match
            </Badge>
          </Tooltip>
        ) : null}
        {app.source !== "DIRECT" ? <Badge tone="primary">{SOURCE_LABEL[app.source]}</Badge> : null}
        {app.averageRating !== null ? (
          <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-foreground" aria-label={`Team rating ${app.averageRating.toFixed(1)} of 5`}>
            <Star className="size-3.5 fill-warning text-warning" aria-hidden />
            {app.averageRating.toFixed(1)}
          </span>
        ) : null}
        {app.noteCount ? (
          <span className="inline-flex items-center gap-0.5 text-xs font-medium text-muted-foreground" aria-label={`${app.noteCount} team notes`}>
            <MessageSquareText className="size-3.5" aria-hidden />
            {app.noteCount}
          </span>
        ) : null}
      </div>
      {app.stage === "REJECTED" && app.rejectionReason ? <p className="mt-2 line-clamp-2 rounded bg-muted px-2 py-1 text-xs text-muted-foreground">{app.rejectionReason}</p> : null}
      <p className="mt-2 flex items-center justify-between gap-2 text-2xs text-subtle-foreground">
        <span>
          Applied <TimeAgo value={app.createdAt} />
        </span>
        {pending ? (
          <span className="inline-flex items-center gap-1 font-medium text-primary">
            <ArrowRightLeft className="size-3" aria-hidden /> Moving
          </span>
        ) : null}
      </p>
    </article>
  );
});
