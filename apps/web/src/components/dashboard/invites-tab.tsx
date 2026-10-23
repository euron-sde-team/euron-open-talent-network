"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MailOpen, ThumbsUp } from "lucide-react";
import { Badge, Button, Card, EmptyState, Skeleton, toast } from "@open-talent/ui";
import type { JobInvite } from "@open-talent/types";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { qk } from "@/lib/query-keys";
import { ErrorState } from "@/components/common/states";
import { TimeAgo } from "@/components/common/time-ago";
import { CompanyLogo, UserName, VerifiedMark } from "@/components/common/user-bits";
import { EMPLOYMENT_LABEL, formatPlace } from "@/components/jobs/job-format";
import { INVITE_STATUS } from "./labels";

type Response = "VIEWED" | "INTERESTED" | "DECLINED";

function InviteRow({ invite }: { invite: JobInvite }) {
  const qc = useQueryClient();
  const respond = useMutation({
    mutationFn: (r: Response) => api().jobs.respondInvite(invite.id, r),
    onMutate: async (r) => {
      await qc.cancelQueries({ queryKey: qk.jobInvites });
      const prev = qc.getQueryData<JobInvite[]>(qk.jobInvites);
      qc.setQueryData<JobInvite[]>(qk.jobInvites, (list) => list?.map((i) => (i.id === invite.id ? { ...i, status: r } : i)));
      return { prev };
    },
    onSuccess: (_d, r) => {
      if (r === "INTERESTED") toast.success({ title: "We let the recruiter know you are interested", description: "Apply from the job page when you are ready." });
      else if (r === "DECLINED") toast.success({ title: "Invitation declined" });
    },
    onError: (e, _r, ctx) => {
      if (ctx?.prev) qc.setQueryData(qk.jobInvites, ctx.prev);
      toast.error({ title: "That did not go through", description: errorMessage(e) });
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: qk.jobInvites }),
  });
  const s = INVITE_STATUS[invite.status];
  const j = invite.job;
  const href = `/jobs?job=${encodeURIComponent(j.id)}`;
  const closed = j.status !== "OPEN";

  return (
    <li className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start" data-testid="job-invite">
      <CompanyLogo company={j.company} size="lg" />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={href} className="font-semibold text-link hover:underline" onClick={() => invite.status === "SENT" && respond.mutate("VIEWED")}>
            {j.title}
          </Link>
          <Badge tone={s.tone}>{s.label}</Badge>
          {closed ? <Badge tone="outline">No longer open</Badge> : null}
        </div>
        <p className="flex items-center gap-1 text-sm">
          {j.company.name}
          <VerifiedMark status={j.company.status} className="[&_svg]:size-3.5" />
        </p>
        <p className="text-xs text-subtle-foreground">
          {formatPlace(j.location, j.workplaceType)}, {EMPLOYMENT_LABEL[j.employmentType]}
        </p>
        <p className="text-xs text-subtle-foreground">
          Invited by <UserName user={invite.invitedBy} className="text-xs" /> <TimeAgo value={invite.createdAt} />
        </p>
        {invite.message ? <p className="mt-1 whitespace-pre-line rounded-md bg-muted/50 px-3 py-2 text-sm">{invite.message}</p> : null}
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        {invite.status === "SENT" || invite.status === "VIEWED" ? (
          <>
            <Button size="sm" onClick={() => respond.mutate("INTERESTED")} disabled={respond.isPending || closed} data-testid="job-invite-interested">
              <ThumbsUp /> Interested
            </Button>
            <Button size="sm" variant="ghost" onClick={() => respond.mutate("DECLINED")} disabled={respond.isPending} data-testid="job-invite-decline">
              Not for me
            </Button>
          </>
        ) : (
          <Button asChild size="sm" variant="outline">
            <Link href={href}>View job</Link>
          </Button>
        )}
      </div>
    </li>
  );
}

export function InvitesTab() {
  const q = useQuery({ queryKey: qk.jobInvites, queryFn: () => api().jobs.invites(), staleTime: 30_000 });
  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-xl font-semibold">Job invitations</h2>
        <p className="text-sm text-muted-foreground">Recruiters who think a specific job fits you. Saying you are interested does not apply for you.</p>
      </div>
      <Card>
        {q.isPending ? (
          <div className="space-y-4 p-4">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="flex gap-3">
                <Skeleton className="size-12 rounded-md" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3 w-1/2" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
              </div>
            ))}
          </div>
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : !q.data.length ? (
          <EmptyState
            icon={<MailOpen />}
            title="No job invitations yet"
            description="When a recruiter invites you to apply for a job, it shows up here."
            action={
              <Button asChild variant="soft" size="sm">
                <Link href="/jobs">Browse jobs</Link>
              </Button>
            }
          />
        ) : (
          <ul className="divide-y divide-border">
            {q.data.map((i) => (
              <InviteRow key={i.id} invite={i} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
