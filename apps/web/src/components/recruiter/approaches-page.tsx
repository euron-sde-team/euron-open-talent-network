"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Eye, Handshake, Lock, Mail, MessageSquareText, Phone, Send, Undo2 } from "lucide-react";
import { isApiError } from "@open-talent/api-client";
import type { Approach, ApproachStatus, ContactReveal } from "@open-talent/types";
import {
  Badge,
  Button,
  Card,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Skeleton,
  Tabs,
  TabsList,
  TabsTrigger,
  toast,
} from "@open-talent/ui";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { qk } from "@/lib/query-keys";
import { usePagedList } from "@/lib/hooks/queries";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { ErrorState, LoadMore, PageTitle } from "@/components/common/states";
import { TimeAgo } from "@/components/common/time-ago";
import { UserAvatar, UserName, userTagline } from "@/components/common/user-bits";
import { EMPLOYMENT_LABEL, formatSalary } from "@/components/jobs/job-format";
import { ProposeEngagementDialog } from "./engagements/propose-dialog";
import { APPROACH_STATUS_LABEL, APPROACH_STATUS_TONE, shortDate } from "./format";

const TABS: ApproachStatus[] = ["PENDING", "ACCEPTED", "DECLINED", "WITHDRAWN", "EXPIRED"];

export function ApproachesPage() {
  const [tab, setTab] = useState<ApproachStatus>("PENDING");
  const list = usePagedList<Approach>({
    queryKey: qk.approachesSent(tab),
    fetchPage: (cursor) => api().approaches.sent({ status: tab, cursor, limit: 20 }),
  });

  return (
    <div data-testid="recruiter-approaches">
      <PageTitle
        title="Approaches"
        description="Messages you sent to candidates. Contact details unlock only when they accept, and only the channels they choose."
        actions={
          <Button asChild variant="outline">
            <Link href="/recruiter/talent">
              <Send /> Find people
            </Link>
          </Button>
        }
      />
      <Card>
        <Tabs value={tab} onValueChange={(v) => setTab(v as ApproachStatus)}>
          <TabsList className="px-2" aria-label="Approach status">
            {TABS.map((t) => (
              <TabsTrigger key={t} value={t} data-testid={`approaches-tab-${t.toLowerCase()}`}>
                {APPROACH_STATUS_LABEL[t]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        {list.isPending ? (
          <ul className="divide-y divide-border">
            {Array.from({ length: 3 }, (_, i) => (
              <li key={i} className="flex gap-3 p-4">
                <Skeleton className="size-10 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-3 w-2/3" />
                </div>
              </li>
            ))}
          </ul>
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : !list.items.length ? (
          <EmptyState
            icon={<Send />}
            title={tab === "PENDING" ? "No approaches waiting" : `No ${APPROACH_STATUS_LABEL[tab].toLowerCase()} approaches`}
            description={tab === "PENDING" ? "Find someone in talent search and approach them from their profile." : "Approaches move here as candidates respond."}
            action={
              tab === "PENDING" ? (
                <Button asChild size="sm" variant="soft">
                  <Link href="/recruiter/talent">Search talent</Link>
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ul className="divide-y divide-border">
            {list.items.map((a) => (
              <ApproachRow key={a.id} approach={a} />
            ))}
          </ul>
        )}
        <LoadMore sentinelRef={list.sentinelRef} loading={list.isFetchingNextPage} hasMore={!!list.hasNextPage} onClick={() => list.fetchNextPage()} />
      </Card>
    </div>
  );
}

function ApproachRow({ approach: a }: { approach: Approach }) {
  const qc = useQueryClient();
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [engage, setEngage] = useState(false);
  const withdraw = useMutation({
    mutationFn: () => api().approaches.withdraw(a.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.approachesSentAll });
      void qc.invalidateQueries({ queryKey: qk.recruiterMe });
      toast.success({ title: "Approach withdrawn" });
    },
  });
  const salary = formatSalary(a.salary);
  return (
    <li className="p-4" data-testid="approach-row">
      <div className="flex items-start gap-3">
        <UserAvatar user={a.candidate} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <UserName user={a.candidate} />
            <Badge tone={APPROACH_STATUS_TONE[a.status]}>{APPROACH_STATUS_LABEL[a.status]}</Badge>
          </div>
          <p className="truncate text-xs text-subtle-foreground">{userTagline(a.candidate)}</p>
          <p className="mt-1.5 text-sm font-semibold">
            {a.roleTitle}
            {a.job ? (
              <>
                {" "}
                <Link href={`/recruiter/jobs/${a.job.id}`} className="font-normal text-link hover:underline">
                  ({a.job.title})
                </Link>
              </>
            ) : null}
          </p>
          <p className="text-xs text-muted-foreground">{[a.employmentType ? EMPLOYMENT_LABEL[a.employmentType] : null, salary, a.recruiter ? `Sent by ${a.recruiter.displayName}` : null].filter(Boolean).join(" · ")}</p>
          <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{a.message}</p>
          <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-subtle-foreground">
            <div className="flex gap-1">
              <dt>Sent</dt>
              <dd>
                <TimeAgo value={a.createdAt} />
              </dd>
            </div>
            <div className="flex gap-1">
              <dt>Viewed</dt>
              <dd>{a.viewedAt ? <TimeAgo value={a.viewedAt} /> : "Not yet"}</dd>
            </div>
            {a.respondedAt ? (
              <div className="flex gap-1">
                <dt>Responded</dt>
                <dd>
                  <TimeAgo value={a.respondedAt} />
                </dd>
              </div>
            ) : null}
            {a.status === "PENDING" ? (
              <div className="flex gap-1">
                <dt>Expires</dt>
                <dd>{shortDate(a.expiresAt)}</dd>
              </div>
            ) : null}
          </dl>
          {a.status === "DECLINED" && a.declineReason ? <p className="mt-2 rounded-md bg-muted px-3 py-2 text-sm">&quot;{a.declineReason}&quot;</p> : null}
          {a.status === "ACCEPTED" && a.unlockRevoked ? (
            <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-warning-soft-foreground">
              <Lock className="size-3.5" aria-hidden /> The candidate stopped sharing contact details. You can still message them here.
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            {a.status === "PENDING" ? (
              <Button size="sm" variant="outline" onClick={() => setConfirmWithdraw(true)} data-testid="approach-withdraw">
                <Undo2 /> Withdraw
              </Button>
            ) : null}
            {a.status === "ACCEPTED" ? (
              <>
                <Button size="sm" variant={a.unlockRevoked ? "outline" : "primary"} disabled={a.unlockRevoked || !a.unlockedChannels.length} onClick={() => setReveal(true)} data-testid="approach-view-contact">
                  <Eye /> View contact
                </Button>
                {a.threadId ? (
                  <Button size="sm" variant="outline" asChild>
                    <Link href={`/messaging/${a.threadId}`} data-testid="approach-thread">
                      <MessageSquareText /> Open conversation
                    </Link>
                  </Button>
                ) : null}
                <Button size="sm" variant="ghost" onClick={() => setEngage(true)} data-testid="approach-engagement">
                  <Handshake /> Record an engagement
                </Button>
              </>
            ) : null}
          </div>
        </div>
      </div>
      <ConfirmDialog
        open={confirmWithdraw}
        onOpenChange={setConfirmWithdraw}
        title="Withdraw this approach?"
        description={`${a.candidate.displayName} will no longer be able to accept it. It still counts toward today's quota.`}
        confirmLabel="Withdraw"
        destructive
        onConfirm={() => withdraw.mutateAsync()}
      />
      {reveal ? <ContactDialog approach={a} onClose={() => setReveal(false)} /> : null}
      {engage ? <ProposeEngagementDialog open={engage} onOpenChange={setEngage} approachId={a.id} candidateName={a.candidate.displayName} defaultTitle={a.roleTitle} /> : null}
    </li>
  );
}

function ContactDialog({ approach: a, onClose }: { approach: Approach; onClose: () => void }) {
  const qc = useQueryClient();
  const [data, setData] = useState<ContactReveal | null>(null);
  const reveal = useMutation({
    mutationFn: () => api().approaches.contact(a.id),
    meta: { silent: true },
    onSuccess: setData,
    onError: (e) => {
      if (isApiError(e) && e.code === "CONTACT_NOT_SHARED") void qc.invalidateQueries({ queryKey: qk.approachesSentAll });
    },
  });
  const rows = data
    ? [
        data.email ? { icon: <Mail />, label: "Email", value: data.email, href: `mailto:${data.email}` } : null,
        data.phone ? { icon: <Phone />, label: "Phone", value: data.phone, href: `tel:${data.phone.replace(/\s/g, "")}` } : null,
        data.whatsapp ? { icon: <MessageSquareText />, label: "WhatsApp", value: data.whatsapp, href: data.whatsappLink ?? undefined } : null,
      ].filter((r): r is NonNullable<typeof r> => !!r)
    : [];
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="sm" data-testid="contact-dialog">
        <DialogHeader>
          <DialogTitle>Contact {a.candidate.displayName}</DialogTitle>
          <DialogDescription>
            {a.candidate.displayName} shared {a.unlockedChannels.map((c) => (c === "WHATSAPP" ? "WhatsApp" : c.toLowerCase())).join(", ")} with you for {a.roleTitle}.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          {!data ? (
            <div className="flex items-start gap-3 rounded-md bg-warning-soft px-3 py-3 text-sm text-warning-soft-foreground">
              <Eye className="mt-0.5 size-4 shrink-0" aria-hidden />
              <p>Every reveal is logged and shown to the candidate, with your name, company and the time. Use these details only for this opportunity.</p>
            </div>
          ) : (
            <ul className="divide-y divide-border rounded-md border border-border" data-testid="contact-details">
              {rows.map((r) => (
                <li key={r.label} className="flex items-center gap-3 px-3 py-2.5 [&_svg]:size-4 [&_svg]:text-muted-foreground">
                  {r.icon}
                  <div className="min-w-0 flex-1">
                    <p className="text-2xs font-medium text-subtle-foreground">{r.label}</p>
                    {r.href ? (
                      <a href={r.href} target={r.label === "WhatsApp" ? "_blank" : undefined} rel="noopener noreferrer" className="block truncate text-sm font-semibold text-link hover:underline">
                        {r.value}
                      </a>
                    ) : (
                      <p className="truncate text-sm font-semibold">{r.value}</p>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      void navigator.clipboard?.writeText(r.value).then(() => toast.success({ title: `${r.label} copied` }));
                    }}
                  >
                    Copy
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {reveal.error ? (
            <p role="alert" className="text-sm font-medium text-danger">
              {errorMessage(reveal.error)}
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {data ? "Done" : "Cancel"}
          </Button>
          {!data ? (
            <Button loading={reveal.isPending} onClick={() => reveal.mutate()} disabled={!!reveal.error} data-testid="contact-reveal">
              Reveal contact details
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
