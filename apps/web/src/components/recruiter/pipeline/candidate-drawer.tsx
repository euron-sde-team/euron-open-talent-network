"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRightLeft, Briefcase, ChevronDown, ExternalLink, FileText, GraduationCap, Handshake, MapPin, MessageSquareText, UserRound } from "lucide-react";
import type { Application, ApplicationStage, CandidateNote } from "@open-talent/types";
import { Avatar, Badge, Button, DialogDescription, DialogTitle, Sheet, SheetContent, Skeleton, Textarea, toast } from "@open-talent/ui";
import { api } from "@/lib/api";
import { qk } from "@/lib/query-keys";
import { ErrorState } from "@/components/common/states";
import { TimeAgo } from "@/components/common/time-ago";
import { UserAvatar, profileHref } from "@/components/common/user-bits";
import { formatMonth } from "@/components/jobs/job-format";
import { SOURCE_LABEL, STAGE_LABEL, STAGE_TONE, matchTone } from "../format";
import { ProposeEngagementDialog } from "../engagements/propose-dialog";
import { StarDisplay, StarInput } from "../stars";
import { MoveToMenu } from "./pipeline-card";

export function CandidateDrawer({ app, jobId, onClose, onMove }: { app: Application | null; jobId: string; onClose: () => void; onMove: (app: Application, to: ApplicationStage) => void }) {
  return (
    <Sheet open={!!app} onOpenChange={(o) => !o && onClose()}>
      <SheetContent width="max-w-xl" data-testid="candidate-drawer">
        {app ? <DrawerBody key={app.id} initial={app} jobId={jobId} onMove={onMove} /> : null}
      </SheetContent>
    </Sheet>
  );
}

function Section({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="border-t border-border px-5 py-4">
      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold [&_svg]:size-4 [&_svg]:text-muted-foreground">
        {icon}
        {title}
      </h3>
      {children}
    </section>
  );
}

function DrawerBody({ initial, jobId, onMove }: { initial: Application; jobId: string; onMove: (app: Application, to: ApplicationStage) => void }) {
  const router = useRouter();
  const q = useQuery({ queryKey: qk.application(initial.id), queryFn: () => api().applications.get(initial.id), initialData: initial, initialDataUpdatedAt: 0 });
  const app = q.data;
  const [engage, setEngage] = useState(false);
  const thread = useMutation({
    mutationFn: () => api().applications.thread(app.id),
    onSuccess: ({ threadId }) => router.push(`/messaging/${threadId}`),
  });
  const s = app.snapshot;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-5 pb-4 pt-5 pr-12">
        <div className="flex items-start gap-3">
          <Avatar name={app.candidate.displayName} seed={app.candidate.id} src={app.candidate.avatarUrl} size="lg" openToWork={app.candidate.openToWork} />
          <div className="min-w-0 flex-1">
            <DialogTitle className="truncate text-lg">{app.candidate.displayName}</DialogTitle>
            <DialogDescription className="mt-0.5 line-clamp-2">{s.headline ?? app.candidate.headline ?? `@${app.candidate.username}`}</DialogDescription>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-subtle-foreground">
              {s.location ? (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="size-3.5" aria-hidden />
                  {s.location}
                </span>
              ) : null}
              {s.yearsExperience !== null ? <span>{s.yearsExperience} yrs experience</span> : null}
              <span>For {app.job.title}</span>
            </p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Badge tone={STAGE_TONE[app.stage]} size="md" data-testid="drawer-stage">
            {STAGE_LABEL[app.stage]}
          </Badge>
          <Badge tone="outline" size="md">
            {SOURCE_LABEL[app.source]}
          </Badge>
          {app.averageRating !== null ? (
            <span className="inline-flex items-center gap-1 text-xs font-semibold">
              <StarDisplay value={app.averageRating} /> {app.averageRating.toFixed(1)}
            </span>
          ) : null}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <MoveToMenu
            from={app.stage}
            align="start"
            onMove={(to) => onMove(app, to)}
            trigger={
              <Button size="sm" data-testid="drawer-move">
                <ArrowRightLeft /> Move to <ChevronDown />
              </Button>
            }
          />
          <Button size="sm" variant="outline" loading={thread.isPending} disabled={app.stage === "WITHDRAWN"} onClick={() => thread.mutate()} data-testid="drawer-message">
            <MessageSquareText /> Message
          </Button>
          <Button size="sm" variant="ghost" asChild>
            <Link href={profileHref(app.candidate.username)} target="_blank" data-testid="drawer-profile">
              <UserRound /> Full profile <ExternalLink className="size-3.5" />
            </Link>
          </Button>
          {app.stage === "HIRED" ? (
            <Button size="sm" variant="soft" onClick={() => setEngage(true)} data-testid="drawer-engagement">
              <Handshake /> Record an engagement
            </Button>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {q.isError ? <ErrorState compact error={q.error} onRetry={() => q.refetch()} /> : null}

        {app.matchDetail ? (
          <Section title={app.matchScore !== null ? `Skill match ${app.matchScore}%` : "Skill match"}>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div className={matchTone(app.matchScore) === "success" ? "h-full bg-success" : matchTone(app.matchScore) === "warning" ? "h-full bg-warning" : "h-full bg-subtle-foreground"} style={{ width: `${app.matchScore ?? 0}%` }} />
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {app.matchDetail.matched.map((m) => (
                <Badge key={m} tone="success">
                  {m}
                </Badge>
              ))}
              {app.matchDetail.missing.map((m) => (
                <Badge key={m} tone="outline" className="line-through decoration-1">
                  {m}
                </Badge>
              ))}
            </div>
            {app.matchDetail.missing.length ? <p className="mt-2 text-xs text-subtle-foreground">Struck through: job skills not on their profile.</p> : null}
          </Section>
        ) : null}

        {app.resume || app.coverNote ? (
          <Section title="Application" icon={<FileText />}>
            {app.resume ? (
              <a href={app.resume.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 rounded-md border border-border p-3 transition-colors hover:bg-muted" data-testid="drawer-resume">
                <FileText className="size-5 text-primary" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{app.resume.fileName}</span>
                <ExternalLink className="size-4 text-muted-foreground" aria-hidden />
              </a>
            ) : null}
            {app.coverNote ? <p className="mt-3 whitespace-pre-wrap rounded-md bg-muted px-3 py-2 text-sm">{app.coverNote}</p> : null}
          </Section>
        ) : null}

        {app.answers.length ? (
          <Section title="Screening answers">
            <dl className="space-y-3">
              {app.answers.map((a) => (
                <div key={a.questionId}>
                  <dt className="text-xs font-medium text-muted-foreground">{a.prompt}</dt>
                  <dd className="mt-0.5 whitespace-pre-wrap text-sm">{a.answer === "YES" ? "Yes" : a.answer === "NO" ? "No" : a.answer}</dd>
                </div>
              ))}
            </dl>
          </Section>
        ) : null}

        {s.experience.length ? (
          <Section title="Experience" icon={<Briefcase />}>
            <ul className="space-y-2.5">
              {s.experience.map((e, i) => (
                <li key={i} className="text-sm">
                  <p className="font-semibold">{e.title}</p>
                  <p className="text-muted-foreground">{e.companyName}</p>
                  <p className="text-xs text-subtle-foreground">
                    {formatMonth(e.startMonth)} to {e.endMonth ? formatMonth(e.endMonth) : "Present"}
                  </p>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        {s.education.length ? (
          <Section title="Education" icon={<GraduationCap />}>
            <ul className="space-y-2.5">
              {s.education.map((e, i) => (
                <li key={i} className="text-sm">
                  <p className="font-semibold">{e.institution}</p>
                  <p className="text-muted-foreground">{[e.degree, e.field].filter(Boolean).join(", ")}</p>
                  {e.endYear ? <p className="text-xs text-subtle-foreground">{e.endYear}</p> : null}
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        {s.skills.length ? (
          <Section title="Skills">
            <div className="flex flex-wrap gap-1.5">
              {s.skills.map((k) => (
                <Badge key={k} tone={app.matchDetail?.matched.some((m) => m.toLowerCase() === k.toLowerCase()) ? "primary" : "neutral"}>
                  {k}
                </Badge>
              ))}
            </div>
          </Section>
        ) : null}

        <Section title="Stage history">
          <StageHistory app={app} loading={q.isFetching} />
        </Section>

        <Notes app={app} jobId={jobId} />
      </div>
      {engage ? <ProposeEngagementDialog open={engage} onOpenChange={setEngage} applicationId={app.id} candidateName={app.candidate.displayName} defaultTitle={app.job.title} /> : null}
    </div>
  );
}

/** The real timeline from GET /api/applications/:id (board cards carry no history). */
function StageHistory({ app, loading }: { app: Application; loading: boolean }) {
  if (!app.history.length) {
    return loading ? (
      <div className="space-y-2" aria-hidden>
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    ) : (
      <p className="text-xs text-subtle-foreground">No stage changes recorded.</p>
    );
  }
  return (
    <ol className="space-y-3 border-l border-border pl-4 text-sm" data-testid="drawer-history">
      {app.history.map((h, i) => (
        <li key={`${h.at}-${i}`} className="relative">
          <span className="absolute -left-[21px] top-1.5 size-2 rounded-full bg-primary" aria-hidden />
          <div className="flex items-center justify-between gap-2">
            <span>
              {i === 0 && h.stage === "APPLIED" ? (
                <>Applied via {SOURCE_LABEL[app.source].toLowerCase()}</>
              ) : h.stage === "WITHDRAWN" && !h.by ? (
                <>Withdrawn by the candidate</>
              ) : (
                <>
                  Moved to <span className="font-semibold">{STAGE_LABEL[h.stage]}</span>
                  {h.by ? <> by {h.by.displayName}</> : null}
                </>
              )}
            </span>
            <TimeAgo value={h.at} className="shrink-0 text-xs text-subtle-foreground" />
          </div>
          {h.reason ? <p className="mt-1 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">{h.stage === "REJECTED" ? "Reason" : "Note"}: {h.reason}</p> : null}
        </li>
      ))}
    </ol>
  );
}

function Notes({ app, jobId }: { app: Application; jobId: string }) {
  const qc = useQueryClient();
  const notes = useQuery({ queryKey: qk.candidateNotes(app.candidate.id), queryFn: () => api().recruiter.notes(app.candidate.id) });
  const [body, setBody] = useState("");
  const [rating, setRating] = useState<number | null>(null);
  const add = useMutation({
    mutationFn: () => api().recruiter.addNote({ applicationId: app.id, body: body.trim(), rating }),
    onSuccess: (note) => {
      qc.setQueryData<CandidateNote[]>(qk.candidateNotes(app.candidate.id), (old) => [note, ...(old ?? [])]);
      void qc.invalidateQueries({ queryKey: qk.application(app.id) });
      void qc.invalidateQueries({ queryKey: qk.pipeline(jobId) });
      setBody("");
      setRating(null);
      toast.success({ title: "Note added" });
    },
  });
  return (
    <Section title="Team notes" icon={<MessageSquareText />}>
      <form
        className="rounded-md border border-border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (body.trim()) add.mutate();
        }}
        data-testid="note-form"
      >
        <label htmlFor="note-body" className="sr-only">
          Add a note for your team
        </label>
        <Textarea id="note-body" rows={2} maxLength={3000} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Add a note for your team. The candidate never sees it." className="border-0 px-0 shadow-none focus-visible:ring-0" data-testid="note-body" />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <StarInput value={rating} onChange={setRating} label="Rating" clearable size="sm" testId="note-rating" />
            {rating ? `${rating} of 5` : "Optional rating"}
          </div>
          <Button type="submit" size="sm" loading={add.isPending} disabled={!body.trim()} data-testid="note-submit">
            Add note
          </Button>
        </div>
      </form>
      {notes.isPending ? (
        <div className="mt-3 space-y-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : notes.isError ? (
        <ErrorState compact error={notes.error} onRetry={() => notes.refetch()} />
      ) : !notes.data.length ? (
        <p className="mt-3 text-center text-xs text-subtle-foreground">No notes yet. Notes are shared with everyone hiring at your company.</p>
      ) : (
        <ul className="mt-3 space-y-3" data-testid="note-list">
          {notes.data.map((n) => (
            <li key={n.id} className="flex gap-2.5">
              <UserAvatar user={n.author} size="sm" />
              <div className="min-w-0 flex-1 rounded-md bg-muted px-3 py-2">
                <div className="flex flex-wrap items-center gap-x-2 text-xs">
                  <span className="font-semibold">{n.author.displayName}</span>
                  <TimeAgo value={n.createdAt} className="text-subtle-foreground" />
                  {n.rating ? <StarDisplay value={n.rating} /> : null}
                  {n.applicationId && n.applicationId !== app.id ? <span className="text-subtle-foreground">on another application</span> : null}
                </div>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm">{n.body}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
