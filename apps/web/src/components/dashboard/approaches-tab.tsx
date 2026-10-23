"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { mapPages } from "@open-talent/api-client";
import { Ban, BriefcaseBusiness, Clock, Flag, Handshake, MessageSquareText, MoreHorizontal, ShieldOff } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  IconButton,
  Segmented,
  Skeleton,
  toast,
} from "@open-talent/ui";
import type { Approach, ApproachStatus, ContactChannel, Page } from "@open-talent/types";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { usePagedList } from "@/lib/hooks/queries";
import { qk } from "@/lib/query-keys";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { ReportDialog } from "@/components/common/report-dialog";
import { ErrorState, LoadMore } from "@/components/common/states";
import { TimeAgo } from "@/components/common/time-ago";
import { CompanyLink, CompanyLogo, PersonRow } from "@/components/common/user-bits";
import { EMPLOYMENT_LABEL, formatSalary } from "@/components/jobs/job-format";
import { AcceptApproachDialog, DeclineApproachDialog } from "./approach-dialogs";
import { APPROACH_STATUS, CHANNEL_LABEL } from "./labels";

type Filter = "PENDING" | "ACCEPTED" | "DECLINED" | "ALL";

/** Patch one approach in every cached received list, then let the lists refetch. */
function useApproachCache() {
  const qc = useQueryClient();
  const patch = (id: string, fn: (a: Approach) => Approach) =>
    qc.setQueriesData<InfiniteData<Page<Approach>>>({ queryKey: qk.approachesAll }, (d) => (d ? { ...d, pages: mapPages(d.pages, (a) => (a.id === id ? fn(a) : a)) } : d));
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: qk.approachesAll });
    void qc.invalidateQueries({ queryKey: qk.profileAnalytics });
    void qc.invalidateQueries({ queryKey: qk.counts });
  };
  return { patch, refresh };
}

function ApproachCard({ a }: { a: Approach }) {
  const { patch, refresh } = useApproachCache();
  const [expanded, setExpanded] = useState(false);
  const [dialog, setDialog] = useState<"accept" | "decline" | "block" | "revoke" | "report" | null>(null);
  const salary = formatSalary(a.salary);
  const status = APPROACH_STATUS[a.status];
  const isNew = a.status === "PENDING" && !a.viewedAt;
  const long = a.message.length > 240;

  const markViewed = () => {
    if (a.viewedAt || a.status !== "PENDING") return;
    patch(a.id, (x) => ({ ...x, viewedAt: new Date().toISOString() }));
    void api().approaches.viewed(a.id).catch(() => undefined);
  };
  const done = (fresh: Approach) => {
    patch(a.id, () => fresh);
    refresh();
  };
  const accept = useMutation({
    mutationFn: (channels: ContactChannel[]) => api().approaches.accept(a.id, channels),
    onSuccess: (fresh) => {
      done(fresh);
      toast.success({ title: "Approach accepted", description: `${a.recruiter.displayName} can now see the details you shared, and you can talk in Messages.` });
    },
  });
  const decline = useMutation({
    mutationFn: (reason: string | null) => api().approaches.decline(a.id, reason),
    onSuccess: (fresh) => {
      done(fresh);
      toast.success({ title: "Approach declined" });
    },
  });
  const block = useMutation({
    mutationFn: () => api().approaches.block(a.id),
    onSuccess: () => {
      patch(a.id, (x) => ({ ...x, status: "BLOCKED" }));
      refresh();
      toast.success({ title: `${a.recruiter.displayName} is blocked`, description: "They can not approach or message you." });
    },
    onError: (e) => toast.error({ title: "Could not block", description: errorMessage(e) }),
  });
  const revoke = useMutation({
    mutationFn: () => api().approaches.revoke(a.id),
    onSuccess: (fresh) => {
      done(fresh);
      toast.success({ title: "Access revoked", description: "The recruiter can no longer see your contact details." });
    },
    onError: (e) => toast.error({ title: "Could not revoke access", description: errorMessage(e) }),
  });

  return (
    <li className="space-y-3 p-4" data-testid="approach-card" data-status={a.status}>
      <div className="flex items-start gap-3">
        <CompanyLogo company={a.company} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-foreground">{a.roleTitle}</h3>
            {isNew ? <Badge tone="solid">New</Badge> : null}
            <Badge tone={status.tone}>{status.label}</Badge>
          </div>
          <CompanyLink company={a.company} className="text-sm" />
          <p className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-subtle-foreground">
            {a.employmentType ? <span>{EMPLOYMENT_LABEL[a.employmentType]}</span> : null}
            {salary ? <span className="font-medium text-muted-foreground">{salary}</span> : null}
            <span>
              Received <TimeAgo value={a.createdAt} />
            </span>
            {a.status === "PENDING" ? (
              <span className="inline-flex items-center gap-1">
                <Clock className="size-3" aria-hidden /> Expires <TimeAgo value={a.expiresAt} />
              </span>
            ) : null}
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton label="More actions" size="sm" data-testid="approach-menu">
              <MoreHorizontal />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onSelect={() => setDialog("report")}>
              <Flag /> Report this approach
            </DropdownMenuItem>
            {a.status !== "BLOCKED" ? (
              <DropdownMenuItem destructive onSelect={() => setDialog("block")} data-testid="approach-block">
                <Ban /> Block {a.recruiter.displayName}
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="rounded-md border border-border bg-muted/40 px-3">
        <PersonRow user={a.recruiter} />
      </div>

      <div>
        <p className={expanded || !long ? "whitespace-pre-line text-sm text-foreground" : "line-clamp-3 whitespace-pre-line text-sm text-foreground"}>{a.message}</p>
        {long ? (
          <button
            type="button"
            className="mt-1 text-sm font-medium text-link hover:underline"
            aria-expanded={expanded}
            onClick={() => {
              setExpanded((v) => !v);
              markViewed();
            }}
          >
            {expanded ? "Show less" : "Read the full message"}
          </button>
        ) : null}
      </div>

      {a.job ? (
        <Link href={`/jobs?job=${encodeURIComponent(a.job.id)}`} className="inline-flex items-center gap-1.5 text-sm font-medium text-link hover:underline" onClick={markViewed}>
          <BriefcaseBusiness className="size-4" aria-hidden /> View the job: {a.job.title}
        </Link>
      ) : null}

      {a.status === "DECLINED" && a.declineReason ? <p className="text-sm text-muted-foreground">Your reason: {a.declineReason}</p> : null}

      {a.status === "ACCEPTED" ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
          {a.unlockRevoked ? (
            <span className="text-muted-foreground">You revoked access to your contact details.</span>
          ) : (
            <>
              <span className="text-muted-foreground">Shared:</span>
              {a.unlockedChannels.map((c) => (
                <Badge key={c} tone="success">
                  {CHANNEL_LABEL[c]}
                </Badge>
              ))}
            </>
          )}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {a.status === "PENDING" ? (
          <>
            <Button
              size="sm"
              onClick={() => {
                markViewed();
                setDialog("accept");
              }}
              data-testid="approach-accept"
            >
              <Handshake /> Accept
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                markViewed();
                setDialog("decline");
              }}
              data-testid="approach-decline"
            >
              Decline
            </Button>
          </>
        ) : null}
        {a.status === "ACCEPTED" && a.threadId ? (
          <Button asChild size="sm" variant="outline">
            <Link href={`/messaging/${encodeURIComponent(a.threadId)}`} data-testid="approach-thread">
              <MessageSquareText /> Open conversation
            </Link>
          </Button>
        ) : null}
        {a.status === "ACCEPTED" && !a.unlockRevoked ? (
          <Button size="sm" variant="danger-ghost" onClick={() => setDialog("revoke")} data-testid="approach-revoke">
            <ShieldOff /> Revoke access
          </Button>
        ) : null}
      </div>

      <AcceptApproachDialog approach={a} open={dialog === "accept"} onOpenChange={(o) => setDialog(o ? "accept" : null)} onAccept={(c) => accept.mutateAsync(c)} />
      <DeclineApproachDialog approach={a} open={dialog === "decline"} onOpenChange={(o) => setDialog(o ? "decline" : null)} onDecline={(r) => decline.mutateAsync(r)} />
      <ConfirmDialog
        open={dialog === "block"}
        onOpenChange={(o) => setDialog(o ? "block" : null)}
        title={`Block ${a.recruiter.displayName}?`}
        description="This declines the approach and blocks them: they can not approach you, message you or see your contact details. They are not told."
        confirmLabel="Block"
        destructive
        testId="approach-block-dialog"
        onConfirm={() => block.mutateAsync()}
      />
      <ConfirmDialog
        open={dialog === "revoke"}
        onOpenChange={(o) => setDialog(o ? "revoke" : null)}
        title="Revoke access to your contact details?"
        description={`${a.recruiter.displayName} will no longer be able to see what you shared. Your conversation stays open.`}
        confirmLabel="Revoke access"
        destructive
        testId="approach-revoke-dialog"
        onConfirm={() => revoke.mutateAsync()}
      />
      <ReportDialog open={dialog === "report"} onOpenChange={(o) => setDialog(o ? "report" : null)} targetType="APPROACH" targetId={a.id} />
    </li>
  );
}

const FILTERS: { value: Filter; label: string }[] = [
  { value: "PENDING", label: "Pending" },
  { value: "ACCEPTED", label: "Accepted" },
  { value: "DECLINED", label: "Declined" },
  { value: "ALL", label: "All" },
];

const EMPTY: Record<Filter, { title: string; description: string }> = {
  PENDING: { title: "No approaches waiting", description: "When a verified recruiter reaches out about a role, it lands here. Your contact details stay private until you accept." },
  ACCEPTED: { title: "No accepted approaches", description: "Approaches you accept show here, with what you shared and a link to the conversation." },
  DECLINED: { title: "Nothing declined", description: "Approaches you decline show here." },
  ALL: { title: "No approaches yet", description: "A complete, published profile with clear skills is the best way to be found." },
};

export function ApproachesTab() {
  const [filter, setFilter] = useState<Filter>("PENDING");
  const status: ApproachStatus | undefined = filter === "ALL" ? undefined : filter;
  const list = usePagedList<Approach>({
    queryKey: qk.approachesReceived(filter),
    fetchPage: (cursor) => api().approaches.received({ cursor, status }),
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Recruiter approaches</h2>
          <p className="text-sm text-muted-foreground">Accept to share the contact channels you choose, or decline. You decide.</p>
        </div>
        <Segmented<Filter> aria-label="Approach status" value={filter} onChange={setFilter} options={FILTERS} />
      </div>
      <Card>
        {list.isPending ? (
          <div className="space-y-6 p-4">
            {Array.from({ length: 2 }, (_, i) => (
              <div key={i} className="space-y-3">
                <div className="flex gap-3">
                  <Skeleton className="size-12 rounded-md" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-3 w-1/2" />
                    <Skeleton className="h-3 w-1/3" />
                  </div>
                </div>
                <Skeleton className="h-16" />
              </div>
            ))}
          </div>
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        ) : !list.items.length ? (
          <EmptyState icon={<Handshake />} title={EMPTY[filter].title} description={EMPTY[filter].description} />
        ) : (
          <ul className="divide-y divide-border" data-testid="approaches-list">
            {list.items.map((a) => (
              <ApproachCard key={a.id} a={a} />
            ))}
          </ul>
        )}
        <LoadMore sentinelRef={list.sentinelRef} loading={list.isFetchingNextPage} hasMore={!!list.hasNextPage} />
      </Card>
    </div>
  );
}
