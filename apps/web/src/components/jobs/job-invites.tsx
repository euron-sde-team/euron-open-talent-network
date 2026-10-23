"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Mail, Sparkles } from "lucide-react";
import { Button, Card } from "@open-talent/ui";
import type { JobInvite } from "@open-talent/types";
import { api } from "@/lib/api";
import { qk } from "@/lib/query-keys";
import { CompanyLogo, UserName } from "@/components/common/user-bits";
import { TimeAgo } from "@/components/common/time-ago";
import { formatPlace, formatSalary } from "./job-format";
import { MatchChip } from "./job-bits";
import { jobHref } from "./job-query";

type Response = "VIEWED" | "INTERESTED" | "DECLINED";

/** Invitations to apply that still wait for an answer. INTERESTED hands over to Easy Apply. */
export function JobInvites({ onOpenJob }: { onOpenJob: (jobId: string, apply: boolean) => void }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: qk.jobInvites, queryFn: () => api().jobs.invites(), meta: { silent: true } });
  const respond = useMutation({
    mutationFn: ({ invite, response }: { invite: JobInvite; response: Response }) => api().jobs.respondInvite(invite.id, response),
    onMutate: ({ invite, response }) => {
      const prev = qc.getQueryData<JobInvite[]>(qk.jobInvites);
      qc.setQueryData<JobInvite[]>(qk.jobInvites, (list) => list?.map((i) => (i.id === invite.id ? { ...i, status: response } : i)));
      return prev;
    },
    onError: (_e, _v, prev) => qc.setQueryData(qk.jobInvites, prev),
    onSuccess: ({ jobId }, { response }) => {
      if (response === "INTERESTED") onOpenJob(jobId, true);
    },
  });
  const pending = (data ?? []).filter((i) => i.status === "SENT" || i.status === "VIEWED");
  if (!pending.length) return null;
  return (
    <Card className="overflow-hidden" data-testid="job-invites">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Mail className="size-4 text-primary" aria-hidden />
        <h2 className="text-base font-semibold">Invitations to apply</h2>
        <span className="text-sm text-subtle-foreground tabular-nums">({pending.length})</span>
      </div>
      <ul>
        {pending.map((inv) => (
          <li key={inv.id} className="border-b border-border px-4 py-3 last:border-b-0" data-testid="job-invite">
            <div className="flex gap-3">
              <CompanyLogo company={inv.job.company} size="md" />
              <div className="min-w-0 flex-1">
                <Link
                  href={jobHref(inv.job.id)}
                  onClick={(e) => {
                    e.preventDefault();
                    onOpenJob(inv.job.id, false);
                    if (inv.status === "SENT") respond.mutate({ invite: inv, response: "VIEWED" });
                  }}
                  className="font-semibold text-link hover:underline"
                >
                  {inv.job.title}
                </Link>
                <p className="truncate text-sm text-muted-foreground">
                  {inv.job.company.name}, {formatPlace(inv.job.location, inv.job.workplaceType)}
                </p>
                <p className="mt-0.5 text-xs text-subtle-foreground">
                  <UserName user={inv.invitedBy} className="text-xs" /> invited you <TimeAgo value={inv.createdAt} />
                </p>
                {inv.message ? <p className="mt-2 line-clamp-3 whitespace-pre-line rounded-md bg-muted px-3 py-2 text-sm">{inv.message}</p> : null}
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => respond.mutate({ invite: inv, response: "INTERESTED" })} disabled={respond.isPending} data-testid="invite-interested">
                    I am interested
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => respond.mutate({ invite: inv, response: "DECLINED" })} disabled={respond.isPending} data-testid="invite-decline">
                    Not for me
                  </Button>
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** "Recommended for you": open jobs that fit the viewer's skills and open-to roles. */
export function RecommendedJobs({ onOpenJob, selectedId }: { onOpenJob: (jobId: string) => void; selectedId: string | null }) {
  const { data } = useQuery({ queryKey: qk.recommendedJobs, queryFn: () => api().jobs.recommended(), staleTime: 120_000, meta: { silent: true } });
  const jobs = (data ?? []).filter((j) => !j.viewer.application).slice(0, 6);
  if (!jobs.length) return null;
  return (
    <Card className="overflow-hidden" data-testid="jobs-recommended">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Sparkles className="size-4 text-primary" aria-hidden />
        <h2 className="text-base font-semibold">Recommended for you</h2>
      </div>
      <ul className="flex snap-x gap-3 overflow-x-auto p-3 [scrollbar-width:thin]">
        {jobs.map((j) => {
          const salary = formatSalary(j.salary);
          return (
            <li key={j.id} className="w-56 shrink-0 snap-start">
              <Link
                href={jobHref(j.id)}
                scroll={false}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey) return;
                  e.preventDefault();
                  onOpenJob(j.id);
                }}
                aria-current={selectedId === j.id ? "true" : undefined}
                className="flex h-full flex-col gap-1 rounded-md border border-border p-3 transition-colors hover:bg-muted aria-[current=true]:border-primary aria-[current=true]:bg-primary/10"
              >
                <CompanyLogo company={j.company} size="sm" />
                <span className="mt-1 line-clamp-2 text-sm font-semibold">{j.title}</span>
                <span className="truncate text-xs text-muted-foreground">{j.company.name}</span>
                <span className="truncate text-xs text-subtle-foreground">{formatPlace(j.location, j.workplaceType)}</span>
                {salary ? <span className="truncate text-xs text-subtle-foreground">{salary}</span> : null}
                {j.viewer.matchScore ? <MatchChip score={j.viewer.matchScore} className="mt-auto self-start" /> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
