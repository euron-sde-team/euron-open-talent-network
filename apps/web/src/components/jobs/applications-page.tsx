"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMutation, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { Check, FileText, MessageSquareText, X } from "lucide-react";
import { Button, Card, EmptyState, Segmented, Skeleton, cn, toast } from "@open-talent/ui";
import type { ApplicationStage, MyApplication, Page } from "@open-talent/types";
import { api } from "@/lib/api";
import { usePagedList } from "@/lib/hooks/queries";
import { qk } from "@/lib/query-keys";
import { CompanyLink, CompanyLogo } from "@/components/common/user-bits";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { ErrorState, LoadMore, PageTitle } from "@/components/common/states";
import { TimeAgo } from "@/components/common/time-ago";
import { updateJobEverywhere } from "./job-cache";
import { EMPLOYMENT_LABEL, formatPlace } from "./job-format";
import { OPEN_STAGES, STAGE_LABEL, StageBadge } from "./job-bits";
import { jobHref } from "./job-query";

const PATH: ApplicationStage[] = ["APPLIED", "SCREENING", "INTERVIEW", "OFFER", "HIRED"];

const shortDate = (iso: string) => new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(iso));

/** The five forward stages, or the stages reached followed by Rejected / Withdrawn. */
export function StageTimeline({ stage, timeline }: { stage: ApplicationStage; timeline: MyApplication["timeline"] }) {
  const at = new Map<ApplicationStage, string>();
  for (const t of timeline) at.set(t.stage, t.at);
  const terminal = stage === "REJECTED" || stage === "WITHDRAWN";
  let steps: ApplicationStage[] = PATH;
  if (terminal) {
    const reached = Math.max(0, ...timeline.map((t) => PATH.indexOf(t.stage)));
    steps = [...PATH.slice(0, reached + 1), stage];
  }
  const current = steps.indexOf(stage);
  return (
    <ol className="grid" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }} aria-label="Application progress" data-testid="stage-timeline">
      {steps.map((s, i) => {
        const done = i < current;
        const active = i === current;
        const bad = active && terminal;
        return (
          <li key={s} className="relative flex flex-col items-center text-center" aria-current={active ? "step" : undefined}>
            {i > 0 ? <span aria-hidden className={cn("absolute right-1/2 top-3 h-0.5 w-full -translate-y-1/2", i <= current ? (bad ? "bg-border" : "bg-primary") : "bg-border")} /> : null}
            <span
              className={cn(
                "relative z-[1] flex size-6 items-center justify-center rounded-full border-2 text-2xs font-bold",
                done && "border-primary bg-primary text-primary-foreground",
                active && !bad && "border-primary bg-card text-primary ring-4 ring-primary/15",
                bad && (stage === "REJECTED" ? "border-danger bg-danger text-danger-foreground" : "border-subtle-foreground bg-muted text-muted-foreground"),
                !done && !active && "border-border bg-card text-subtle-foreground",
              )}
              aria-hidden
            >
              {done ? <Check className="size-3.5" strokeWidth={3} /> : bad ? <X className="size-3.5" strokeWidth={3} /> : i + 1}
            </span>
            <span className={cn("mt-1.5 w-full truncate px-0.5 text-2xs font-semibold sm:text-xs", active ? "text-foreground" : done ? "text-muted-foreground" : "text-subtle-foreground")}>{STAGE_LABEL[s]}</span>
            <span className="text-2xs text-subtle-foreground tabular-nums">{at.get(s) && (done || active) ? shortDate(at.get(s)!) : " "}</span>
          </li>
        );
      })}
    </ol>
  );
}

type AppPages = InfiniteData<Page<MyApplication>>;

function ApplicationCard({ app, highlighted, onWithdraw }: { app: MyApplication; highlighted: boolean; onWithdraw: () => void }) {
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (highlighted) ref.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [highlighted]);
  const canWithdraw = OPEN_STAGES.includes(app.stage);
  return (
    <li ref={ref} className={cn("border-b border-border p-4 last:border-b-0 sm:p-5", highlighted && "bg-primary/10")} data-testid="application-card" data-application-id={app.id}>
      <div className="flex gap-3">
        <CompanyLogo company={app.job.company} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
            <div className="min-w-0">
              <Link href={jobHref(app.job.id)} className="font-semibold text-link hover:underline">
                {app.job.title}
              </Link>
              <CompanyLink company={app.job.company} className="block text-sm" />
            </div>
            <StageBadge stage={app.stage} size="md" />
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {formatPlace(app.job.location, app.job.workplaceType)}, {EMPLOYMENT_LABEL[app.job.employmentType]}
          </p>
          <p className="text-xs text-subtle-foreground">
            Applied <TimeAgo value={app.createdAt} />
            {app.job.status !== "OPEN" ? ", this job is no longer accepting applications" : null}
          </p>
        </div>
      </div>
      <div className="mt-4">
        <StageTimeline stage={app.stage} timeline={app.timeline} />
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {app.threadId ? (
          <Button asChild size="sm" variant="soft">
            <Link href={`/messaging/${encodeURIComponent(app.threadId)}`} data-testid="application-message">
              <MessageSquareText aria-hidden />
              Message recruiter
            </Link>
          </Button>
        ) : null}
        <Button asChild size="sm" variant="outline">
          <Link href={jobHref(app.job.id)}>
            <FileText aria-hidden />
            View job
          </Link>
        </Button>
        {canWithdraw ? (
          <Button size="sm" variant="danger-ghost" onClick={onWithdraw} data-testid="application-withdraw">
            Withdraw
          </Button>
        ) : null}
      </div>
    </li>
  );
}

function ListSkeleton() {
  return (
    <div aria-hidden>
      {[0, 1, 2].map((i) => (
        <div key={i} className="space-y-4 border-b border-border p-5 last:border-b-0">
          <div className="flex gap-3">
            <Skeleton className="size-12 rounded-md" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          </div>
          <Skeleton className="h-10 w-full" />
        </div>
      ))}
    </div>
  );
}

/** /jobs/applications: every application with its stage timeline. Stage moves arrive live. */
export function ApplicationsPage() {
  const sp = useSearchParams();
  const highlight = sp.get("highlight");
  const [open, setOpen] = useState(true);
  const qc = useQueryClient();
  const list = usePagedList<MyApplication>({ queryKey: qk.myApplications(open), fetchPage: (cursor) => api().applications.mine({ cursor, limit: 20, open }) });
  const [confirm, setConfirm] = useState<MyApplication | null>(null);

  const withdraw = useMutation({
    mutationFn: (app: MyApplication) => api().applications.withdraw(app.id),
    onSuccess: (updated) => {
      qc.setQueryData<AppPages>(qk.myApplications(false), (d) => d && { ...d, pages: d.pages.map((p) => ({ ...p, items: p.items.map((a) => (a.id === updated.id ? updated : a)) })) });
      qc.setQueryData<AppPages>(qk.myApplications(true), (d) => d && { ...d, pages: d.pages.map((p) => ({ ...p, items: p.items.filter((a) => a.id !== updated.id) })) });
      updateJobEverywhere(qc, updated.job.id, (j) => ({ ...j, viewer: { ...j.viewer, application: j.viewer.application ? { ...j.viewer.application, stage: "WITHDRAWN" } : null } }));
      void qc.invalidateQueries({ queryKey: qk.myApplicationsAll });
      void qc.invalidateQueries({ queryKey: qk.job(updated.job.id) });
      toast.success({ title: "Application withdrawn", description: `${updated.job.company.name} will see that you withdrew.` });
    },
    onError: () => void qc.invalidateQueries({ queryKey: qk.myApplicationsAll }),
  });

  // A highlighted application might be closed already: show everything so it is on the page.
  useEffect(() => {
    if (!highlight || !open || list.isPending) return;
    if (!list.items.some((a) => a.id === highlight) && !list.hasNextPage) setOpen(false);
  }, [highlight, open, list.isPending, list.items, list.hasNextPage]);

  return (
    <div data-testid="applications-page">
      <PageTitle
        title="My applications"
        description="Where each application stands. Stage changes show up here as they happen."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/jobs/saved">Saved jobs</Link>
          </Button>
        }
      />
      <div className="mb-3">
        <Segmented
          aria-label="Which applications"
          value={open ? "open" : "all"}
          onChange={(v) => setOpen(v === "open")}
          options={[
            { value: "open", label: "In progress" },
            { value: "all", label: "All" },
          ]}
        />
      </div>
      <Card className="overflow-hidden">
        {list.isPending ? (
          <ListSkeleton />
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        ) : !list.items.length ? (
          <EmptyState
            icon={<FileText />}
            title={open ? "No applications in progress" : "You have not applied to any jobs yet"}
            description={open ? "Applications that were hired, not selected or withdrawn are under All." : "Use Easy Apply on any open job. Your profile snapshot goes with it."}
            action={
              <div className="flex gap-2">
                {open ? (
                  <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
                    Show all
                  </Button>
                ) : null}
                <Button asChild size="sm">
                  <Link href="/jobs">Find jobs</Link>
                </Button>
              </div>
            }
          />
        ) : (
          <>
            <ul data-testid="applications">
              {list.items.map((a) => (
                <ApplicationCard key={a.id} app={a} highlighted={a.id === highlight} onWithdraw={() => setConfirm(a)} />
              ))}
            </ul>
            <LoadMore sentinelRef={list.sentinelRef} loading={list.isFetchingNextPage} hasMore={!!list.hasNextPage} onClick={() => void list.fetchNextPage()} />
          </>
        )}
      </Card>
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Withdraw this application?"
        description={confirm ? `${confirm.job.company.name} stops considering you for ${confirm.job.title}. You can not apply to this job again.` : undefined}
        confirmLabel="Withdraw"
        destructive
        onConfirm={() => (confirm ? withdraw.mutateAsync(confirm) : undefined)}
        testId="withdraw-dialog"
      />
    </div>
  );
}
