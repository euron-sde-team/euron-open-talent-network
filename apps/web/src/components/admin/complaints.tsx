"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation } from "@tanstack/react-query";
import { ArrowRight, ChevronDown, Copy, FileText, Flag, Gavel, Paperclip } from "lucide-react";
import { Badge, Button, Card, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, EmptyState, Field, Input, Segmented, Textarea, toast } from "@open-talent/ui";
import type { AdminComplaintRow, ComplaintStatus, Media } from "@open-talent/types";
import { api } from "@/lib/api";
import { daysSince } from "@/lib/admin";
import { usePagedList } from "@/lib/hooks/queries";
import { humanize } from "@/lib/moderation";
import { qk } from "@/lib/query-keys";
import { fullTimestamp } from "@/lib/time";
import { UserAvatar, profileHref } from "@/components/common/user-bits";
import { ErrorState, LoadMore } from "@/components/common/states";
import { TimeAgo } from "@/components/common/time-ago";
import { AreaHeader, FilterTabs, ListSkeleton, useRowCache } from "./admin-bits";
import { HideRatingTool, RatingsBetween } from "./ratings";

type Tab = "ACTIVE" | Exclude<ComplaintStatus, "OPEN">;
const TABS: { value: Tab; label: string }[] = [
  { value: "ACTIVE", label: "Needs a decision" },
  { value: "UNDER_REVIEW", label: "Under review" },
  { value: "ACTION_TAKEN", label: "Action taken" },
  { value: "DISMISSED", label: "Dismissed" },
];
const TONE: Record<ComplaintStatus, "warning" | "primary" | "success" | "neutral"> = { OPEN: "warning", UNDER_REVIEW: "primary", ACTION_TAKEN: "success", DISMISSED: "neutral" };

export function AdminComplaints() {
  const [tab, setTab] = useState<Tab>("ACTIVE");
  const list = usePagedList<AdminComplaintRow>({
    queryKey: qk.adminComplaints(tab),
    fetchPage: (cursor) => api().admin.complaints({ cursor, status: tab === "ACTIVE" ? undefined : tab }),
  });
  const [resolving, setResolving] = useState<AdminComplaintRow | null>(null);

  return (
    <div className="space-y-4">
      <AreaHeader title="Complaints" description="Disputes members file about someone they worked with or talked to. Oldest first. Both sides read your note when you close one." />
      <div>
        <FilterTabs label="Complaint status" value={tab} onChange={setTab} options={TABS} testId="complaint-tabs" />
        {list.isPending ? (
          <Card>
            <ListSkeleton rows={3} height="h-32" />
          </Card>
        ) : list.isError ? (
          <Card>
            <ErrorState error={list.error} onRetry={() => void list.refetch()} />
          </Card>
        ) : !list.items.length ? (
          <Card>
            <EmptyState icon={<Flag />} title={tab === "ACTIVE" ? "No open complaints" : "Nothing here"} description={tab === "ACTIVE" ? "When a member files a complaint it waits here for a decision." : "Complaints with this outcome are listed here."} />
          </Card>
        ) : (
          <ul className="space-y-3" data-testid="complaint-list">
            {list.items.map((c) => (
              <ComplaintCard key={c.id} c={c} onResolve={() => setResolving(c)} />
            ))}
            <LoadMore sentinelRef={list.sentinelRef} loading={list.isFetchingNextPage} hasMore={!!list.hasNextPage} onClick={() => void list.fetchNextPage()} />
          </ul>
        )}
      </div>
      <HideRatingTool />
      {resolving ? <ResolveDialog c={resolving} onClose={() => setResolving(null)} /> : null}
    </div>
  );
}

function Party({ label, user }: { label: string; user: AdminComplaintRow["complainant"] }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <UserAvatar user={user} size="sm" />
      <div className="min-w-0">
        <p className="text-2xs font-semibold uppercase tracking-wide text-subtle-foreground">{label}</p>
        <Link href={profileHref(user.username)} className="block truncate text-sm font-medium hover:underline">
          {user.displayName}
        </Link>
        <p className="truncate text-xs text-subtle-foreground">
          {user.recruiterAt ? `Recruiter at ${user.recruiterAt.name}, ` : ""}
          {user.email}
        </p>
      </div>
    </div>
  );
}

/** What the complaint is about, as copyable id chips (support looks these up in the database or the audit log). */
function Subjects({ c }: { c: AdminComplaintRow }) {
  const ids = [
    { label: "Engagement", value: c.engagementId },
    { label: "Approach", value: c.approachId },
    { label: "Application", value: c.applicationId },
  ].filter((x): x is { label: string; value: string } => !!x.value);
  if (!ids.length) return null;
  return (
    <ul className="mt-2 flex flex-wrap gap-2" aria-label="What this complaint is about" data-testid="complaint-subjects">
      {ids.map((x) => (
        <li key={x.label}>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(x.value).then(() => toast.success({ title: `${x.label} id copied` }));
            }}
            className="inline-flex max-w-[20rem] items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
            title={`Copy the ${x.label.toLowerCase()} id`}
          >
            <span className="font-semibold">{x.label}</span>
            <span className="truncate font-mono text-muted-foreground">{x.value}</span>
            <Copy className="size-3.5 shrink-0" aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Evidence opens in a new tab: images as thumbnails, everything else as a file link. */
function Evidence({ media }: { media: Media[] }) {
  if (!media.length) return null;
  return (
    <ul className="mt-2 flex flex-wrap gap-2" data-testid="complaint-evidence">
      {media.map((m) => (
        <li key={m.id}>
          {m.kind === "IMAGE" ? (
            <a href={m.url} target="_blank" rel="noopener noreferrer" className="block overflow-hidden rounded-md border border-border hover:opacity-90" title={m.fileName}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={m.thumbUrl ?? m.url} alt={m.fileName} className="size-16 object-cover" loading="lazy" />
            </a>
          ) : (
            <a href={m.url} target="_blank" rel="noopener noreferrer" className="inline-flex h-16 max-w-[16rem] items-center gap-1.5 rounded-md border border-border px-2 text-xs hover:bg-muted">
              <FileText className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">{m.fileName}</span>
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}

function ComplaintCard({ c, onResolve }: { c: AdminComplaintRow; onResolve: () => void }) {
  const [showRatings, setShowRatings] = useState(false);
  const open = c.status === "OPEN" || c.status === "UNDER_REVIEW";
  const age = daysSince(c.createdAt);
  return (
    <li>
      <Card className="p-4" data-testid="complaint-row">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Badge tone="danger">{humanize(c.category)}</Badge>
          <Badge tone={TONE[c.status]}>{humanize(c.status)}</Badge>
          {c.priorComplaintsAgainst ? <Badge tone="warning">{c.priorComplaintsAgainst} earlier against this person</Badge> : null}
          <span className="ml-auto text-xs text-subtle-foreground" title={fullTimestamp(c.createdAt)}>
            Filed <TimeAgo value={c.createdAt} />
            {open && age >= 1 ? `, waiting ${age} day${age === 1 ? "" : "s"}` : ""}
          </span>
        </div>
        <div className="grid items-center gap-3 sm:grid-cols-[1fr_auto_1fr]">
          <Party label="Filed by" user={c.complainant} />
          <ArrowRight className="hidden size-4 text-subtle-foreground sm:block" aria-hidden />
          <Party label="About" user={c.against} />
        </div>
        <p className="mt-3 whitespace-pre-wrap rounded-md bg-muted/40 p-3 text-sm">{c.description}</p>
        <Subjects c={c} />
        <Evidence media={c.evidence} />
        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Paperclip className="size-3.5" aria-hidden /> {c.evidenceCount ? `${c.evidenceCount} evidence file${c.evidenceCount === 1 ? "" : "s"} attached` : "No evidence attached"}
          </span>
          {c.resolvedAt ? (
            <span>
              Closed <TimeAgo value={c.resolvedAt} />
            </span>
          ) : null}
        </div>
        {c.adminNote ? <p className="mt-2 border-l-2 border-primary pl-3 text-sm text-muted-foreground">Note: {c.adminNote}</p> : null}
        <div className="mt-3 border-t border-border pt-3">
          <button type="button" onClick={() => setShowRatings((v) => !v)} aria-expanded={showRatings} className="inline-flex items-center gap-1 text-xs font-medium text-link hover:underline">
            <ChevronDown className={showRatings ? "size-3.5 rotate-180 transition-transform" : "size-3.5 transition-transform"} aria-hidden /> Ratings between them
          </button>
          {showRatings ? (
            <div className="mt-2">
              <RatingsBetween a={c.complainant} b={c.against} />
            </div>
          ) : null}
        </div>
        {open ? (
          <div className="mt-3 flex justify-end">
            <Button size="sm" onClick={onResolve} data-testid="complaint-resolve">
              <Gavel /> Decide
            </Button>
          </div>
        ) : null}
      </Card>
    </li>
  );
}

type Outcome = "UNDER_REVIEW" | "ACTION_TAKEN" | "DISMISSED";
type Enforcement = "NONE" | "WARN" | "SUSPEND";

function ResolveDialog({ c, onClose }: { c: AdminComplaintRow; onClose: () => void }) {
  const [outcome, setOutcome] = useState<Outcome>(c.status === "UNDER_REVIEW" ? "ACTION_TAKEN" : "UNDER_REVIEW");
  const [note, setNote] = useState(c.adminNote ?? "");
  const [enforce, setEnforce] = useState<Enforcement>("NONE");
  const [days, setDays] = useState("7");
  const cache = useRowCache<AdminComplaintRow>(qk.adminComplaintsAll);
  const n = Number(days);
  const daysOk = enforce !== "SUSPEND" || (Number.isInteger(n) && n >= 1 && n <= 3650);
  const noteOk = outcome === "UNDER_REVIEW" || note.trim().length >= 3;
  const resolve = useMutation({
    mutationFn: () =>
      api().admin.resolveComplaint(c.id, {
        status: outcome,
        note: note.trim() || null,
        action: outcome === "ACTION_TAKEN" && enforce !== "NONE" ? { kind: enforce, ...(enforce === "SUSPEND" ? { days: n } : {}) } : undefined,
      }),
    onMutate: () => {
      const snap = cache.snapshot();
      // Keys are ["admin-complaints", tab]: keep the row only where its new status belongs.
      cache.patch(c.id, (row, key) => {
        const tab = key[1];
        const keep = tab === "ACTIVE" ? outcome === "UNDER_REVIEW" : tab === outcome;
        return keep ? { ...row, status: outcome, adminNote: note.trim() || null } : null;
      });
      return { snap };
    },
    onError: (_e, _v, ctx) => ctx && cache.restore(ctx.snap),
    onSuccess: () => {
      toast.success({
        title: outcome === "UNDER_REVIEW" ? "Marked under review" : outcome === "ACTION_TAKEN" ? "Complaint closed with action" : "Complaint dismissed",
        description: outcome === "UNDER_REVIEW" ? undefined : "Both people were notified.",
      });
      onClose();
    },
    onSettled: () => void cache.invalidate(),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && !resolve.isPending && onClose()}>
      <DialogContent size="md" data-testid="complaint-dialog">
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            if (noteOk && daysOk) resolve.mutate();
          }}
        >
          <DialogHeader>
            <DialogTitle>Decide on this complaint</DialogTitle>
            <DialogDescription>
              {humanize(c.category)} complaint from {c.complainant.displayName} about {c.against.displayName}.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <div>
              <p className="mb-1.5 text-sm font-medium">Outcome</p>
              <Segmented<Outcome>
                aria-label="Outcome"
                value={outcome}
                onChange={setOutcome}
                options={[
                  ...(c.status === "OPEN" ? [{ value: "UNDER_REVIEW" as const, label: "Under review" }] : []),
                  { value: "ACTION_TAKEN", label: "Take action" },
                  { value: "DISMISSED", label: "Dismiss" },
                ]}
              />
            </div>
            {outcome === "ACTION_TAKEN" ? (
              <div>
                <p className="mb-1.5 text-sm font-medium">Enforcement against {c.against.displayName}</p>
                <Segmented<Enforcement>
                  aria-label="Enforcement"
                  value={enforce}
                  onChange={setEnforce}
                  options={[
                    { value: "NONE", label: "None" },
                    { value: "WARN", label: "Warn" },
                    { value: "SUSPEND", label: "Suspend" },
                  ]}
                />
                {enforce === "SUSPEND" ? (
                  <Field label="Days" htmlFor="complaint-days" className="mt-3" error={daysOk ? undefined : "Between 1 and 3650 days."}>
                    <Input id="complaint-days" type="number" inputMode="numeric" min={1} max={3650} value={days} onChange={(e) => setDays(e.target.value)} className="w-28" data-testid="complaint-days" />
                  </Field>
                ) : null}
                {enforce !== "NONE" ? <p className="mt-2 text-xs text-muted-foreground">Recorded as a moderation action on the account and linked to this complaint. They can appeal it.</p> : null}
              </div>
            ) : null}
            <Field
              label="Note"
              htmlFor="complaint-note"
              optional={outcome === "UNDER_REVIEW"}
              hint={outcome === "UNDER_REVIEW" ? "Optional for now; nobody is notified until you close it." : "Both people read this note."}
              error={!noteOk && note.length > 0 ? "Write a short note both sides will read." : undefined}
            >
              <Textarea id="complaint-note" rows={4} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} data-testid="complaint-note" />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={resolve.isPending}>
              Cancel
            </Button>
            <Button type="submit" variant={outcome === "ACTION_TAKEN" && enforce !== "NONE" ? "danger" : "primary"} disabled={!noteOk || !daysOk} loading={resolve.isPending} data-testid="complaint-submit">
              {outcome === "UNDER_REVIEW" ? "Mark under review" : outcome === "DISMISSED" ? "Dismiss" : enforce === "NONE" ? "Close with action" : enforce === "WARN" ? "Warn and close" : `Suspend ${Number.isInteger(n) && n > 0 ? n : ""} days and close`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
