"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRightLeft, ChevronDown, Megaphone, Pencil, Radio, Search, Users, X } from "lucide-react";
import { isApiError } from "@open-talent/api-client";
import type { Application, ApplicationStage, PipelineColumn } from "@open-talent/types";
import { Badge, Button, Card, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger, IconButton, Input, Skeleton, cn, toast } from "@open-talent/ui";
import { api } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import { qk } from "@/lib/query-keys";
import { useRoom, useSocketEvent } from "@/lib/realtime/provider";
import { ErrorState, NotFoundState } from "@/components/common/states";
import { ComposerDialog } from "@/components/posts/composer";
import { EMPLOYMENT_LABEL, formatPlace } from "@/components/jobs/job-format";
import { JOB_STATUS_LABEL, JOB_STATUS_TONE, STAGES, STAGE_DOT, STAGE_LABEL, canTeamMove } from "../format";
import { JobActionsMenu } from "../jobs/job-actions";
import { CandidateDrawer } from "./candidate-drawer";
import { PipelineColumnView, type MoveOverlay } from "./pipeline-column";
import { RejectDialog } from "./reject-dialog";

/** Codes after which our picture of the board is stale: refetch it. */
const STALE_CODES = new Set(["APPLICATION_CHANGED", "INVALID_TRANSITION", "STAGE_NOT_ALLOWED", "STAGE_FINAL", "SAME_STAGE", "APPLICATION_WITHDRAWN", "APPLICATION_NOT_FOUND"]);

/**
 * Put a card the server sent (a move, a live event) into the drawer's cache. Those carry
 * `history: []`, so keep the history already loaded and refetch it in the background.
 */
function putApplication(qc: ReturnType<typeof useQueryClient>, a: Application) {
  qc.setQueryData<Application>(qk.application(a.id), (old) => ({ ...a, history: old?.history ?? a.history }));
  void qc.invalidateQueries({ queryKey: qk.application(a.id) });
}

interface MoveVars {
  apps: Application[];
  to: ApplicationStage;
  reason?: string | null;
  note?: string | null;
}

export function PipelinePage({ jobId }: { jobId: string }) {
  const me = useMe();
  const qc = useQueryClient();
  const params = useSearchParams();
  useRoom("job", jobId);

  const job = useQuery({ queryKey: qk.job(jobId), queryFn: () => api().jobs.get(jobId) });
  const board = useQuery({ queryKey: qk.pipeline(jobId), queryFn: () => api().jobs.pipeline(jobId), enabled: job.data?.viewer.canManage === true });

  const [overlays, setOverlays] = useState<Record<string, MoveOverlay>>({});
  const [selected, setSelected] = useState<Record<string, Application>>({});
  const [drag, setDrag] = useState<Application[] | null>(null);
  const [over, setOver] = useState<ApplicationStage | null>(null);
  const [rejecting, setRejecting] = useState<Application[] | null>(null);
  const [open, setOpen] = useState<Application | null>(null);
  const [filter, setFilter] = useState("");
  const [share, setShare] = useState(false);
  const deepLinked = useRef(false);

  // Open the drawer for ?application=<id> (links from the workspace home).
  useEffect(() => {
    const wanted = params?.get("application");
    if (!wanted || deepLinked.current || !board.data) return;
    deepLinked.current = true;
    const found = board.data.flatMap((c) => c.items).find((a) => a.id === wanted);
    if (found) setOpen(found);
    else void api().applications.get(wanted).then(setOpen, () => undefined);
  }, [params, board.data]);

  useSocketEvent("pipeline:card", ({ jobId: jid, application, movedBy }) => {
    if (jid !== jobId) return;
    putApplication(qc, application);
    if (movedBy && movedBy.id !== me.id) toast.info({ title: `${movedBy.displayName} moved ${application.candidate.displayName}`, description: `Now in ${STAGE_LABEL[application.stage]}.` });
  });

  const move = useMutation({
    mutationFn: ({ apps, to, reason, note }: MoveVars) =>
      apps.length === 1 ? api().applications.move(apps[0]!.id, { to, reason, note }).then((a) => [a]) : api().applications.bulkMove(apps.map((a) => a.id), { to, reason, note }),
    meta: { silent: true },
    onMutate: ({ apps, to }) => {
      setOverlays((o) => {
        const next = { ...o };
        for (const a of apps) next[a.id] = { app: a, from: a.stage, to };
        return next;
      });
      setOpen((cur) => (cur && apps.some((a) => a.id === cur.id) ? { ...cur, stage: to } : cur));
    },
    onSuccess: async (updated, { to }) => {
      for (const a of updated) putApplication(qc, a);
      setSelected({});
      toast.success({ title: updated.length === 1 ? `${updated[0]!.candidate.displayName} moved to ${STAGE_LABEL[to]}` : `${updated.length} candidates moved to ${STAGE_LABEL[to]}` });
      // Keep the optimistic picture until the board has the server's version.
      await qc.invalidateQueries({ queryKey: qk.pipeline(jobId) });
    },
    onError: (e, { apps }) => {
      setOpen((cur) => {
        const orig = cur ? apps.find((a) => a.id === cur.id) : undefined;
        return orig ? { ...cur!, stage: orig.stage } : cur;
      });
      toast.error({ title: apps.length > 1 ? "Those cards were not moved" : "That card was not moved", description: errorMessage(e) });
      if (isApiError(e) && STALE_CODES.has(e.code)) {
        void qc.invalidateQueries({ queryKey: qk.pipeline(jobId) });
        for (const a of apps) void qc.invalidateQueries({ queryKey: qk.application(a.id) });
      }
    },
    onSettled: (_d, _e, { apps }) => {
      setOverlays((o) => {
        const next = { ...o };
        for (const a of apps) delete next[a.id];
        return next;
      });
    },
  });

  const requestMove = useCallback(
    (apps: Application[], to: ApplicationStage) => {
      const movable = apps.filter((a) => canTeamMove(a.stage, to));
      if (!movable.length) {
        toast.error({ title: `Can not move to ${STAGE_LABEL[to]}`, description: "That move is not allowed from this stage." });
        return;
      }
      if (to === "REJECTED") setRejecting(movable);
      else move.mutate({ apps: movable, to });
    },
    [move],
  );

  const onCardMove = useCallback((app: Application, to: ApplicationStage) => requestMove([app], to), [requestMove]);
  const onToggle = useCallback((app: Application) => {
    setSelected((s) => {
      const next = { ...s };
      if (next[app.id]) delete next[app.id];
      else next[app.id] = app;
      return next;
    });
  }, []);
  const onToggleAll = useCallback((apps: Application[], on: boolean) => {
    setSelected((s) => {
      const next = { ...s };
      for (const a of apps) {
        if (on) next[a.id] = a;
        else delete next[a.id];
      }
      return next;
    });
  }, []);
  const onDragStart = useCallback(
    (app: Application, e: React.DragEvent) => {
      const group = selected[app.id] ? Object.values(selected) : [app];
      setDrag(group);
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", app.id);
    },
    [selected],
  );
  const onDragEnd = useCallback(() => {
    setDrag(null);
    setOver(null);
  }, []);
  const accepts = (stage: ApplicationStage) => !!drag && drag.some((a) => canTeamMove(a.stage, stage));
  const onDragOver = (stage: ApplicationStage, e: React.DragEvent) => {
    if (!accepts(stage)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (over !== stage) setOver(stage);
  };
  const onDrop = (stage: ApplicationStage, e: React.DragEvent) => {
    e.preventDefault();
    const group = drag;
    setDrag(null);
    setOver(null);
    if (group && accepts(stage)) requestMove(group, stage);
  };

  const overlayList = useMemo(() => Object.values(overlays), [overlays]);
  const selectedIds = useMemo(() => new Set(Object.keys(selected)), [selected]);
  const selectedList = Object.values(selected);
  const bulkTargets = STAGES.filter((s) => selectedList.length > 0 && selectedList.every((a) => canTeamMove(a.stage, s)));

  if (job.isPending) return <BoardSkeleton />;
  if (job.isError) return <Card><ErrorState error={job.error} onRetry={() => job.refetch()} /></Card>;
  const j = job.data;
  if (!j.viewer.canManage) return <Card><NotFoundState title="This pipeline is for the hiring team" description="Only recruiters at the company that posted this job can see its applicants." /></Card>;

  const columns = board.data ?? [];
  const byStage = new Map<ApplicationStage, PipelineColumn>(columns.map((c) => [c.stage, c]));
  const total = columns.reduce((n, c) => n + c.count, 0);

  return (
    <div data-testid="pipeline-page">
      <div className="mb-3 flex flex-wrap items-start gap-3">
        <IconButton label="Back to jobs" asChild>
          <Link href="/recruiter/jobs">
            <ArrowLeft />
          </Link>
        </IconButton>
        <div className="min-w-[14rem] flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="min-w-0 text-2xl font-bold tracking-tight" data-testid="pipeline-title">
              {j.title}
            </h1>
            <Badge tone={JOB_STATUS_TONE[j.status]}>{JOB_STATUS_LABEL[j.status]}</Badge>
            <span className="inline-flex items-center gap-1 text-xs font-medium text-success" title="Moves by teammates appear live">
              <Radio className="size-3.5" aria-hidden /> Live
            </span>
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {[formatPlace(j.location, j.workplaceType), EMPLOYMENT_LABEL[j.employmentType], `${j.openings} opening${j.openings === 1 ? "" : "s"}`].join(" · ")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href={`/recruiter/jobs/${j.id}/edit`} data-testid="pipeline-edit">
              <Pencil /> Edit
            </Link>
          </Button>
          {j.status === "OPEN" ? (
            <Button variant="outline" size="sm" onClick={() => setShare(true)} data-testid="pipeline-share">
              <Megaphone /> Share as a post
            </Button>
          ) : null}
          <JobActionsMenu job={j} />
        </div>
      </div>

      {total > 0 ? (
        <div className="mb-3" aria-label="Pipeline summary">
          <div className="flex h-2 overflow-hidden rounded-full bg-muted">
            {columns.filter((c) => c.count > 0).map((c) => (
              <div key={c.stage} className={cn("h-full", STAGE_DOT[c.stage])} style={{ width: `${(c.count / total) * 100}%` }} title={`${STAGE_LABEL[c.stage]}: ${c.count}`} />
            ))}
          </div>
          <p className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1 font-semibold text-foreground">
              <Users className="size-3.5" aria-hidden /> {total} applicant{total === 1 ? "" : "s"}
            </span>
            {columns.filter((c) => c.count > 0).map((c) => (
              <span key={c.stage} className="inline-flex items-center gap-1.5">
                <span className={cn("size-2 rounded-full", STAGE_DOT[c.stage])} aria-hidden />
                {STAGE_LABEL[c.stage]} {c.count}
              </span>
            ))}
          </p>
        </div>
      ) : null}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle-foreground" aria-hidden />
          <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by name, headline or skill" className="h-9 pl-9" aria-label="Filter cards" data-testid="pipeline-filter" />
        </div>
        <p className="hidden text-xs text-subtle-foreground md:block">Drag cards between columns, or use the menu on a card. Select several to move them together.</p>
      </div>

      {selectedList.length ? (
        <div className="sticky top-[calc(var(--header-height)+8px)] z-20 mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-primary/40 bg-card px-3 py-2 shadow-popover" data-testid="pipeline-bulk-bar">
          <span className="text-sm font-semibold">{selectedList.length} selected</span>
          <MoveToBulk targets={bulkTargets} onMove={(to) => requestMove(selectedList, to)} disabled={move.isPending} />
          <Button variant="ghost" size="sm" onClick={() => setSelected({})} className="ml-auto" data-testid="pipeline-bulk-clear">
            <X /> Clear
          </Button>
        </div>
      ) : null}

      {board.isError ? (
        <Card>
          <ErrorState error={board.error} onRetry={() => board.refetch()} />
        </Card>
      ) : board.isPending ? (
        <ColumnsSkeleton />
      ) : (
        <div className="-mx-4 overflow-x-auto px-4 pb-3 [scrollbar-width:thin]" data-testid="pipeline-board">
          <div className="flex h-[calc(100dvh-var(--header-height)-220px)] min-h-[460px] gap-3">
            {STAGES.map((stage) => (
              <PipelineColumnView
                key={stage}
                jobId={jobId}
                stage={stage}
                column={byStage.get(stage)}
                overlays={overlayList}
                filter={filter}
                selectedIds={selectedIds}
                selecting={selectedList.length > 0}
                dropState={!drag ? "none" : over === stage && accepts(stage) ? "over" : accepts(stage) ? "allowed" : "blocked"}
                onToggle={onToggle}
                onToggleAll={onToggleAll}
                onOpen={setOpen}
                onMove={onCardMove}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
                onDragOver={onDragOver}
                onDragLeave={(s) => setOver((cur) => (cur === s ? null : cur))}
                onDrop={onDrop}
              />
            ))}
          </div>
        </div>
      )}

      <CandidateDrawer app={open} jobId={jobId} onClose={() => setOpen(null)} onMove={onCardMove} />
      {rejecting ? (
        <RejectDialog
          open
          count={rejecting.length}
          name={rejecting[0]!.candidate.displayName}
          onCancel={() => setRejecting(null)}
          onConfirm={(reason, note) => {
            move.mutate({ apps: rejecting, to: "REJECTED", reason, note });
            setRejecting(null);
          }}
        />
      ) : null}
      {share ? <ComposerDialog open={share} onOpenChange={setShare} start="hiring" jobId={j.id} /> : null}
    </div>
  );
}

function MoveToBulk({ targets, onMove, disabled }: { targets: ApplicationStage[]; onMove: (to: ApplicationStage) => void; disabled?: boolean }) {
  if (!targets.length) return <span className="text-xs text-muted-foreground">These cards have no move in common.</span>;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" disabled={disabled} data-testid="pipeline-bulk-move">
          <ArrowRightLeft /> Move to <ChevronDown />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>Move selected to</DropdownMenuLabel>
        {targets.map((s) => (
          <DropdownMenuItem key={s} onSelect={() => onMove(s)} data-testid={`bulk-move-to-${s.toLowerCase()}`} className={cn(s === "REJECTED" && "text-danger")}>
            <span className={cn("size-2 rounded-full", STAGE_DOT[s])} aria-hidden />
            {STAGE_LABEL[s]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ColumnsSkeleton() {
  return (
    <div className="-mx-4 flex gap-3 overflow-hidden px-4">
      {STAGES.slice(0, 5).map((s) => (
        <div key={s} className="w-[284px] shrink-0 space-y-2 rounded-xl border border-border bg-muted/60 p-2 sm:w-[300px]">
          <Skeleton className="h-6 w-1/2" />
          <Skeleton className="h-24 w-full rounded-lg" />
          <Skeleton className="h-24 w-full rounded-lg" />
        </div>
      ))}
    </div>
  );
}

function BoardSkeleton() {
  return (
    <div>
      <Skeleton className="mb-2 h-7 w-1/3" />
      <Skeleton className="mb-4 h-4 w-1/4" />
      <ColumnsSkeleton />
    </div>
  );
}
