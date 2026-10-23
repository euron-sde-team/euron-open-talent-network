"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Circle, EyeOff, Handshake, Star } from "lucide-react";
import type { Engagement, SubScores } from "@open-talent/types";
import { Badge, Button, Card, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, EmptyState, Field, Skeleton, Textarea, toast } from "@open-talent/ui";
import { api } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { qk } from "@/lib/query-keys";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { ErrorState, PageTitle } from "@/components/common/states";
import { TimeAgo } from "@/components/common/time-ago";
import { UserAvatar, UserName } from "@/components/common/user-bits";
import { ENGAGEMENT_LABEL, ENGAGEMENT_TONE, shortDate } from "../format";
import { StarInput } from "../stars";

type Action = "confirm" | "cancel" | "complete" | "dispute";

export function EngagementsPage() {
  const me = useMe();
  const list = useQuery({ queryKey: qk.engagements, queryFn: () => api().trust.engagements() });
  const mine = (list.data ?? []).filter((e) => e.recruiter.id === me.id);
  const open = mine.filter((e) => e.status === "PROPOSED" || e.status === "ACTIVE" || (e.status === "COMPLETED" && e.rating.canRate && !e.rating.viewerRated));
  const rest = mine.filter((e) => !open.includes(e));

  return (
    <div data-testid="recruiter-engagements">
      <PageTitle title="Engagements" description="Work that came out of an accepted approach or a hire. Both sides confirm the start and the finish, then rate each other." />
      <Card className="mb-4 flex items-start gap-3 p-4">
        <EyeOff className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
        <p className="text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">Ratings are double-blind.</span> Neither of you sees the other&apos;s rating until both are in or the rating window closes, so nobody rates in reaction. A rating can be edited once before it is revealed, never after.
        </p>
      </Card>
      {list.isPending ? (
        <div className="space-y-3">
          {Array.from({ length: 2 }, (_, i) => (
            <Card key={i} className="space-y-2 p-4">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-3 w-1/2" />
            </Card>
          ))}
        </div>
      ) : list.isError ? (
        <Card>
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        </Card>
      ) : !mine.length ? (
        <Card>
          <EmptyState
            icon={<Handshake />}
            title="No engagements yet"
            description="When a candidate accepts an approach, or you hire someone, record the engagement from the approach or the pipeline."
            action={
              <Button asChild size="sm" variant="soft">
                <Link href="/recruiter/approaches">Go to approaches</Link>
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="space-y-6">
          {open.length ? (
            <section>
              <h2 className="mb-2 text-xl font-semibold">Needs attention</h2>
              <div className="space-y-3">
                {open.map((e) => (
                  <EngagementCard key={e.id} e={e} viewerId={me.id} />
                ))}
              </div>
            </section>
          ) : null}
          {rest.length ? (
            <section>
              <h2 className="mb-2 text-xl font-semibold">History</h2>
              <div className="space-y-3">
                {rest.map((e) => (
                  <EngagementCard key={e.id} e={e} viewerId={me.id} />
                ))}
              </div>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}

function Check({ done, label }: { done: boolean; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      {done ? <CheckCircle2 className="size-4 text-success" aria-hidden /> : <Circle className="size-4 text-subtle-foreground" aria-hidden />}
      <span className={done ? "font-medium" : "text-muted-foreground"}>{label}</span>
    </span>
  );
}

function EngagementCard({ e, viewerId }: { e: Engagement; viewerId: string }) {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState<Action | null>(null);
  const [rating, setRating] = useState(false);
  const act = useMutation({
    mutationFn: (a: Action) => api().trust[a](e.id),
    onSuccess: (updated, a) => {
      qc.setQueryData<Engagement[]>(qk.engagements, (old) => old?.map((x) => (x.id === updated.id ? updated : x)));
      toast.success({ title: { confirm: "Confirmed", cancel: "Engagement cancelled", complete: updated.status === "COMPLETED" ? "Marked complete" : "Completion requested", dispute: "Completion disputed" }[a] });
    },
  });
  const name = e.candidate.displayName;
  const requestedByMe = e.completionRequestedBy === viewerId;
  const requestedByThem = !!e.completionRequestedBy && !requestedByMe;

  return (
    <Card className="p-4" data-testid="engagement-card">
      <div className="flex items-start gap-3">
        <UserAvatar user={e.candidate} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold">{e.title}</p>
            <Badge tone={ENGAGEMENT_TONE[e.status]}>{ENGAGEMENT_LABEL[e.status]}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            With <UserName user={e.candidate} className="text-sm" /> · {e.company.name}
          </p>
          <p className="mt-0.5 text-xs text-subtle-foreground">
            Proposed <TimeAgo value={e.createdAt} />
            {e.completedAt ? ` · Completed ${shortDate(e.completedAt)}` : ""}
            {e.approachId ? " · From an approach" : e.applicationId ? " · From a hire" : ""}
          </p>

          {e.status === "PROPOSED" ? (
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
              <Check done={e.recruiterConfirmed} label="You confirmed" />
              <Check done={e.candidateConfirmed} label={`${name} confirmed`} />
            </div>
          ) : null}
          {e.status === "ACTIVE" && e.completionRequestedBy ? (
            <p className="mt-3 text-sm text-muted-foreground">{requestedByMe ? `Waiting for ${name} to confirm it is complete. It completes automatically if they do not answer.` : `${name} marked this complete. Confirm, or dispute it if the work is not done.`}</p>
          ) : null}
          {e.status === "COMPLETED" ? (
            <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <Check done={e.rating.viewerRated} label="You rated" />
              <Check done={e.rating.counterpartRated} label={`${name} rated`} />
              {e.rating.windowClosesAt ? <span className="text-xs">Rating window closes {shortDate(e.rating.windowClosesAt)}</span> : null}
            </p>
          ) : null}
          {e.status === "DISPUTED" ? <p className="mt-3 text-sm text-muted-foreground">The completion is disputed. If something went wrong, you can file a complaint from the candidate&apos;s profile and our team will review it.</p> : null}

          <div className="mt-3 flex flex-wrap gap-2">
            {e.status === "PROPOSED" && !e.recruiterConfirmed ? (
              <Button size="sm" loading={act.isPending && act.variables === "confirm"} onClick={() => act.mutate("confirm")} data-testid="eng-confirm">
                Confirm start
              </Button>
            ) : null}
            {e.status === "PROPOSED" ? (
              <Button size="sm" variant="ghost" onClick={() => setConfirm("cancel")} data-testid="eng-cancel">
                Cancel
              </Button>
            ) : null}
            {e.status === "ACTIVE" && !e.completionRequestedBy ? (
              <Button size="sm" variant="outline" loading={act.isPending && act.variables === "complete"} onClick={() => act.mutate("complete")} data-testid="eng-complete">
                Mark complete
              </Button>
            ) : null}
            {e.status === "ACTIVE" && requestedByThem ? (
              <>
                <Button size="sm" loading={act.isPending && act.variables === "complete"} onClick={() => act.mutate("complete")} data-testid="eng-confirm-complete">
                  Confirm complete
                </Button>
                <Button size="sm" variant="danger-ghost" onClick={() => setConfirm("dispute")} data-testid="eng-dispute">
                  Dispute
                </Button>
              </>
            ) : null}
            {e.status === "COMPLETED" && e.rating.canRate && !e.rating.viewerRated ? (
              <Button size="sm" onClick={() => setRating(true)} data-testid="eng-rate">
                <Star /> Rate {name}
              </Button>
            ) : null}
          </div>
        </div>
      </div>
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm === "dispute" ? "Dispute the completion?" : "Cancel this engagement?"}
        description={confirm === "dispute" ? `The engagement stops and no ratings open. If the work went wrong, you can file a complaint about it.` : "It has not started yet. Either of you can propose it again later."}
        confirmLabel={confirm === "dispute" ? "Dispute" : "Cancel engagement"}
        destructive
        onConfirm={() => act.mutateAsync(confirm!)}
      />
      {rating ? <RateDialog e={e} onClose={() => setRating(false)} /> : null}
    </Card>
  );
}

const SUBS: { key: keyof SubScores; label: string }[] = [
  { key: "communication", label: "Communication" },
  { key: "quality", label: "Quality of work" },
  { key: "reliability", label: "Reliability" },
  { key: "professionalism", label: "Professionalism" },
];

function RateDialog({ e, onClose }: { e: Engagement; onClose: () => void }) {
  const qc = useQueryClient();
  const [score, setScore] = useState<number | null>(null);
  const [subs, setSubs] = useState<Partial<SubScores>>({});
  const [comment, setComment] = useState("");
  const [touched, setTouched] = useState(false);
  const rate = useMutation({
    mutationFn: () => api().trust.rate(e.id, { score: score!, subScores: Object.keys(subs).length ? subs : undefined, comment: comment.trim() || null }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: qk.engagements });
      toast.success({ title: "Rating submitted", description: r.revealed ? "Both ratings are in and now visible." : "It stays hidden until the other rating is in or the window closes." });
      onClose();
    },
  });
  return (
    <Dialog open onOpenChange={(o) => !o && !rate.isPending && onClose()}>
      <DialogContent size="md" data-testid="rate-dialog">
        <form
          noValidate
          className="flex min-h-0 flex-col"
          onSubmit={(ev) => {
            ev.preventDefault();
            setTouched(true);
            if (score) rate.mutate();
          }}
        >
          <DialogHeader>
            <DialogTitle>Rate {e.candidate.displayName}</DialogTitle>
            <DialogDescription>For {e.title}. Your rating is hidden until both of you have rated or the window closes{e.rating.windowClosesAt ? ` on ${shortDate(e.rating.windowClosesAt)}` : ""}.</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-5">
            <div>
              <p className="mb-1 text-sm font-medium">Overall</p>
              <StarInput value={score} onChange={setScore} label="Overall rating" testId="rate-overall" />
              {touched && !score ? (
                <p role="alert" className="mt-1 text-xs font-medium text-danger">
                  Choose an overall rating.
                </p>
              ) : null}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {SUBS.map((s) => (
                <div key={s.key}>
                  <p className="mb-0.5 text-xs font-medium text-muted-foreground">
                    {s.label} <span className="text-subtle-foreground">(optional)</span>
                  </p>
                  <StarInput
                    value={subs[s.key] ?? null}
                    size="sm"
                    clearable
                    label={s.label}
                    onChange={(v) =>
                      setSubs((cur) => {
                        const next = { ...cur };
                        if (v === null) delete next[s.key];
                        else next[s.key] = v;
                        return next;
                      })
                    }
                  />
                </div>
              ))}
            </div>
            <Field label="Comment" htmlFor="rate-comment" optional>
              <Textarea id="rate-comment" rows={3} maxLength={1000} value={comment} onChange={(ev) => setComment(ev.target.value)} placeholder="What was it like to work together?" />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={rate.isPending} data-testid="rate-submit">
              Submit rating
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
