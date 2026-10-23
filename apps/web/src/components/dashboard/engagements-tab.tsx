"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, CheckCheck, Flag, Handshake, Star, TriangleAlert, X } from "lucide-react";
import { Badge, Button, Card, EmptyState, Skeleton, toast } from "@open-talent/ui";
import type { Engagement, EngagementStatus } from "@open-talent/types";
import { api } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import { qk } from "@/lib/query-keys";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { ErrorState } from "@/components/common/states";
import { TimeAgo } from "@/components/common/time-ago";
import { CompanyLink, CompanyLogo, PersonRow } from "@/components/common/user-bits";
import { ComplaintDialog } from "./complaint-dialog";
import { ENGAGEMENT_STATUS } from "./labels";
import { RateDialog } from "./rate-dialog";

type Step = "confirm" | "cancel" | "complete" | "dispute";

function useStep(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (step: Step) => api().trust[step](id),
    onSuccess: (fresh, step) => {
      qc.setQueryData<Engagement[]>(qk.engagements, (list) => list?.map((e) => (e.id === fresh.id ? fresh : e)));
      const copy: Record<Step, string> = {
        confirm: fresh.status === "ACTIVE" ? "Engagement started" : "Confirmed. Waiting for the other side.",
        cancel: "Engagement cancelled",
        complete: fresh.status === "COMPLETED" ? "Engagement completed. You can rate each other now." : "Marked complete. Waiting for the other side to confirm.",
        dispute: "Completion disputed. You can file a complaint if you need help.",
      };
      toast.success({ title: copy[step] });
    },
    onError: (e) => toast.error({ title: "That did not go through", description: errorMessage(e) }),
    onSettled: () => void qc.invalidateQueries({ queryKey: qk.engagements }),
  });
}

function EngagementRow({ e }: { e: Engagement }) {
  const me = useMe();
  const step = useStep(e.id);
  const [dialog, setDialog] = useState<"rate" | "cancel" | "dispute" | "complaint" | null>(null);
  const viewerIsCandidate = e.candidate.id === me.id;
  const other = viewerIsCandidate ? e.recruiter : e.candidate;
  const viewerConfirmed = viewerIsCandidate ? e.candidateConfirmed : e.recruiterConfirmed;
  const s = ENGAGEMENT_STATUS[e.status];
  const requestedByMe = e.completionRequestedBy === me.id;
  const requestedByOther = !!e.completionRequestedBy && !requestedByMe;
  const windowClosed = e.status === "COMPLETED" && !!e.rating.windowClosesAt && new Date(e.rating.windowClosesAt).getTime() < Date.now();
  const busy = step.isPending;

  let note: React.ReactNode = null;
  if (e.status === "PROPOSED") note = viewerConfirmed ? `Waiting for ${other.displayName} to confirm the start.` : `${other.displayName} proposed this. Confirm once the work has actually started.`;
  else if (e.status === "ACTIVE")
    note = requestedByMe ? `You marked it complete. Waiting for ${other.displayName} to confirm.` : requestedByOther ? `${other.displayName} marked this complete. Confirm, or dispute if the work is not done.` : "In progress. Mark it complete when the work is done.";
  else if (e.status === "COMPLETED") {
    if (e.rating.viewerRated)
      note = e.rating.counterpartRated ? "You have both rated. Ratings are visible on each profile." : `You rated ${other.displayName}. Your rating stays hidden until they rate you or the window closes.`;
    else if (windowClosed) note = "The rating window for this engagement has closed.";
    else if (e.rating.canRate)
      note = (
        <>
          {e.rating.counterpartRated ? `${other.displayName} has rated you. ` : ""}
          Rate by <TimeAgo value={e.rating.windowClosesAt!} />.
        </>
      );
  } else if (e.status === "DISPUTED") note = "This engagement is disputed. If you need help, file a complaint and the trust team will look at it.";

  return (
    <li className="space-y-3 p-4" data-testid="engagement-row" data-status={e.status}>
      <div className="flex items-start gap-3">
        <CompanyLogo company={e.company} size="md" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">{e.title}</h3>
            <Badge tone={s.tone}>{s.label}</Badge>
          </div>
          <CompanyLink company={e.company} className="text-sm" />
          <p className="text-xs text-subtle-foreground">
            Proposed <TimeAgo value={e.createdAt} />
            {e.completedAt ? (
              <>
                , completed <TimeAgo value={e.completedAt} />
              </>
            ) : null}
          </p>
        </div>
      </div>
      <div className="rounded-md border border-border bg-muted/40 px-3">
        <PersonRow user={other} meta={viewerIsCandidate ? `Recruiter at ${e.company.name}` : "Candidate"} />
      </div>
      {note ? <p className="text-sm text-muted-foreground">{note}</p> : null}
      <div className="flex flex-wrap gap-2">
        {e.status === "PROPOSED" && !viewerConfirmed ? (
          <Button size="sm" onClick={() => step.mutate("confirm")} disabled={busy} data-testid="engagement-confirm">
            <Check /> Confirm start
          </Button>
        ) : null}
        {e.status === "PROPOSED" ? (
          <Button size="sm" variant="ghost" onClick={() => setDialog("cancel")} disabled={busy} data-testid="engagement-cancel">
            <X /> Cancel
          </Button>
        ) : null}
        {e.status === "ACTIVE" && !e.completionRequestedBy ? (
          <Button size="sm" onClick={() => step.mutate("complete")} disabled={busy} data-testid="engagement-complete">
            <CheckCheck /> Mark complete
          </Button>
        ) : null}
        {e.status === "ACTIVE" && requestedByOther ? (
          <>
            <Button size="sm" onClick={() => step.mutate("complete")} disabled={busy} data-testid="engagement-confirm-complete">
              <CheckCheck /> Confirm completion
            </Button>
            <Button size="sm" variant="danger-ghost" onClick={() => setDialog("dispute")} disabled={busy} data-testid="engagement-dispute">
              <TriangleAlert /> Dispute
            </Button>
          </>
        ) : null}
        {e.status === "COMPLETED" && e.rating.canRate ? (
          <Button size="sm" onClick={() => setDialog("rate")} data-testid="engagement-rate">
            <Star /> Rate {other.displayName}
          </Button>
        ) : null}
        {e.status !== "PROPOSED" && e.status !== "CANCELLED" ? (
          <Button size="sm" variant="ghost" onClick={() => setDialog("complaint")} data-testid="engagement-report">
            <Flag /> Report a problem
          </Button>
        ) : null}
      </div>

      <RateDialog engagement={e} counterpart={other} open={dialog === "rate"} onOpenChange={(o) => setDialog(o ? "rate" : null)} />
      <ConfirmDialog
        open={dialog === "cancel"}
        onOpenChange={(o) => setDialog(o ? "cancel" : null)}
        title="Cancel this engagement?"
        description={`${other.displayName} will be told. A cancelled engagement can not be rated.`}
        confirmLabel="Cancel engagement"
        destructive
        onConfirm={() => step.mutateAsync("cancel")}
      />
      <ConfirmDialog
        open={dialog === "dispute"}
        onOpenChange={(o) => setDialog(o ? "dispute" : null)}
        title="Dispute the completion?"
        description="The engagement stops and can not be rated. If something went wrong, you can file a complaint afterwards."
        confirmLabel="Dispute"
        destructive
        onConfirm={() => step.mutateAsync("dispute")}
      />
      <ComplaintDialog open={dialog === "complaint"} onOpenChange={(o) => setDialog(o ? "complaint" : null)} prefill={{ engagementId: e.id, againstUsername: other.username }} />
    </li>
  );
}

const GROUPS: { title: string; statuses: EngagementStatus[] }[] = [
  { title: "Waiting to start", statuses: ["PROPOSED"] },
  { title: "Active", statuses: ["ACTIVE"] },
  { title: "Completed", statuses: ["COMPLETED"] },
  { title: "Closed", statuses: ["DISPUTED", "CANCELLED"] },
];

export function EngagementsTab() {
  const q = useQuery({ queryKey: qk.engagements, queryFn: () => api().trust.engagements(), staleTime: 30_000 });
  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-xl font-semibold">Engagements and ratings</h2>
        <p className="text-sm text-muted-foreground">Work agreed through an accepted approach or a hire. Both sides confirm the start and the finish, then rate each other.</p>
      </div>
      {q.isPending ? (
        <Card className="space-y-4 p-4">
          {Array.from({ length: 2 }, (_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </Card>
      ) : q.isError ? (
        <Card>
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        </Card>
      ) : !q.data.length ? (
        <Card>
          <EmptyState icon={<Handshake />} title="No engagements yet" description="When you accept an approach or are hired through an application, the recruiter can propose an engagement. It appears here to confirm." />
        </Card>
      ) : (
        GROUPS.map((g) => {
          const items = q.data.filter((e) => g.statuses.includes(e.status));
          if (!items.length) return null;
          return (
            <section key={g.title} aria-label={g.title}>
              <h3 className="mb-2 px-1 text-sm font-semibold text-muted-foreground">
                {g.title} <span className="tabular-nums">({items.length})</span>
              </h3>
              <Card>
                <ul className="divide-y divide-border">
                  {items.map((e) => (
                    <EngagementRow key={e.id} e={e} />
                  ))}
                </ul>
              </Card>
            </section>
          );
        })
      )}
    </div>
  );
}
