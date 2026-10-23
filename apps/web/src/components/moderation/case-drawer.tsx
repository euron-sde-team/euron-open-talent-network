"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { ExternalLink, History, Scale, UserCheck, UserPlus } from "lucide-react";
import { Badge, Button, DialogTitle, Field, Input, Sheet, SheetContent, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger, Textarea, toast } from "@open-talent/ui";
import type { Appeal, ModerationActionType, ModerationCase, Page, UserSummary } from "@open-talent/types";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { ACCOUNT_ACTIONS, DESTRUCTIVE, TARGET_LABEL, actionLabel, availableActions, humanize, targetHref } from "@/lib/moderation";
import { qk } from "@/lib/query-keys";
import { fullTimestamp, relativeTime } from "@/lib/time";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { ErrorState } from "@/components/common/states";
import { UserAvatar, profileHref, userTagline } from "@/components/common/user-bits";
import { MediaMosaic } from "@/components/media/media-mosaic";
import { RichText } from "@/components/posts/rich-text";
import { AppealDecision } from "./appeal-decision";
import { Reasons, SourceBadge, StatusBadge, TargetBadge } from "./case-bits";
import { PriorityBar, ScoreBars } from "./score-bars";

type CasePages = InfiniteData<Page<ModerationCase>, string | undefined>;

/** Apply a decided case to every cached queue: drop it from OPEN lists, replace it elsewhere. */
export function applyResolvedCase(qc: ReturnType<typeof useQueryClient>, updated: ModerationCase) {
  qc.setQueryData(qk.modCase(updated.id), updated);
  for (const [key, data] of qc.getQueriesData<CasePages>({ queryKey: qk.modCasesAll })) {
    if (!data) continue;
    const filters = (key[1] ?? {}) as Record<string, string | undefined>;
    const dropFromOpen = updated.status === "RESOLVED" && (filters.status ?? "OPEN") === "OPEN";
    qc.setQueryData<CasePages>(key, {
      ...data,
      pages: data.pages.map((p) => ({
        ...p,
        items: dropFromOpen ? p.items.filter((c) => c.id !== updated.id) : p.items.map((c) => (c.id === updated.id ? updated : c)),
      })),
    });
  }
}

type CaseSnapshot = [readonly unknown[], unknown][];

/** Snapshot the case detail and every cached queue, for rolling back an optimistic change. */
function snapshotCase(qc: ReturnType<typeof useQueryClient>, id: string): CaseSnapshot {
  return [[qk.modCase(id), qc.getQueryData(qk.modCase(id))], ...qc.getQueriesData({ queryKey: qk.modCasesAll })];
}

/** The summary fields of the signed-in user, as the API would present them on a case. */
const asSummary = (u: UserSummary): UserSummary => ({ id: u.id, username: u.username, displayName: u.displayName, avatarUrl: u.avatarUrl, headline: u.headline, role: u.role, openToWork: u.openToWork, recruiterAt: u.recruiterAt });

export function CaseDrawer({ caseId, onOpenChange }: { caseId: string | null; onOpenChange: (open: boolean) => void }) {
  return (
    <Sheet open={!!caseId} onOpenChange={onOpenChange}>
      <SheetContent width="max-w-xl" data-testid="case-drawer" aria-describedby={undefined}>
        {caseId ? <CaseDetail key={caseId} id={caseId} onClose={() => onOpenChange(false)} /> : null}
      </SheetContent>
    </Sheet>
  );
}

function CaseDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { user: me } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: qk.modCase(id), queryFn: () => api().moderation.case(id) });
  const c = q.data;
  const assign = useMutation({
    mutationFn: () => api().moderation.assign(id, me!.id),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: qk.modCase(id) });
      const snapshot = snapshotCase(qc, id);
      if (c && me) applyResolvedCase(qc, { ...c, assignedTo: asSummary(me) });
      return { snapshot };
    },
    onError: (_e, _v, ctx) => {
      for (const [key, data] of ctx?.snapshot ?? []) qc.setQueryData(key, data);
    },
    onSuccess: (updated) => {
      applyResolvedCase(qc, updated);
      toast.success({ title: "Assigned to you", description: "Other moderators can see you are on it." });
    },
  });
  const mine = !!me && c?.assignedTo?.id === me.id;
  const href = c ? targetHref(c) : null;

  return (
    <>
      <div className="shrink-0 border-b border-border px-5 py-4 pr-12">
        <DialogTitle>{c ? `${TARGET_LABEL[c.targetType]} case` : "Case review"}</DialogTitle>
        {c ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <TargetBadge type={c.targetType} />
            <SourceBadge source={c.source} />
            <StatusBadge status={c.targetStatus} />
            {c.status === "RESOLVED" ? <Badge tone="success">Resolved{c.resolution ? `: ${humanize(c.resolution)}` : ""}</Badge> : null}
          </div>
        ) : null}
        {c && c.status === "OPEN" ? (
          <div className="mt-2 flex items-center gap-3">
            <PriorityBar value={c.priority} />
            {mine ? null : (
              <Button size="sm" variant="ghost" onClick={() => assign.mutate()} disabled={!me || assign.isPending} data-testid="case-assign-me">
                <UserPlus /> {c.assignedTo ? "Take over" : "Assign to me"}
              </Button>
            )}
          </div>
        ) : null}
        {c ? <Assignee user={c.assignedTo} mine={mine} /> : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {q.isPending ? (
          <div className="space-y-3">
            <Skeleton className="h-24" />
            <Skeleton className="h-16" />
            <Skeleton className="h-32" />
          </div>
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} compact />
        ) : c ? (
          <Tabs defaultValue={c.appeal?.status === "PENDING" ? "appeal" : "case"}>
            <TabsList className="mb-4">
              <TabsTrigger value="case">Case</TabsTrigger>
              <TabsTrigger value="history" data-testid="case-tab-history">
                History
              </TabsTrigger>
              {c.appeal ? (
                <TabsTrigger value="appeal" data-testid="case-tab-appeal">
                  Appeal
                </TabsTrigger>
              ) : null}
            </TabsList>
            <TabsContent value="case" className="space-y-5">
              <section aria-labelledby="snap-h">
                <div className="mb-2 flex items-center justify-between">
                  <h3 id="snap-h" className="text-sm font-semibold">
                    Content when the case opened
                  </h3>
                  {href ? (
                    <Link href={href} target="_blank" className="inline-flex items-center gap-1 text-xs font-medium text-link hover:underline">
                      Open <ExternalLink className="size-3" />
                    </Link>
                  ) : null}
                </div>
                <div className="rounded-lg border border-border bg-muted/30" data-testid="case-snapshot">
                  {typeof c.snapshot.title === "string" && c.snapshot.title ? <p className="px-4 pt-3 font-semibold">{c.snapshot.title}</p> : null}
                  {typeof c.snapshot.body === "string" && c.snapshot.body ? (
                    <p className="whitespace-pre-wrap break-words px-4 py-3 text-sm leading-relaxed">
                      <RichText text={c.snapshot.body} />
                    </p>
                  ) : (
                    <p className="px-4 py-3 text-sm text-subtle-foreground">No text</p>
                  )}
                  {Array.isArray(c.snapshot.media) && c.snapshot.media.length ? <MediaMosaic media={c.snapshot.media} className="pb-3" /> : null}
                </div>
                <p className="mt-2 text-xs text-subtle-foreground" title={fullTimestamp(c.openedAt)}>
                  Opened {relativeTime(c.openedAt)}
                  {c.resolvedAt ? `, resolved ${relativeTime(c.resolvedAt)}${c.resolvedBy ? ` by ${c.resolvedBy.displayName}` : ""}` : ""}
                </p>
              </section>

              <section className="grid gap-4 sm:grid-cols-2">
                <div>
                  <h3 className="mb-2 text-sm font-semibold">AI scores</h3>
                  <ScoreBars scores={c.aiScores} max={8} />
                  {c.aiProvider ? <p className="mt-1 text-xs text-subtle-foreground">Scored by {c.aiProvider}</p> : null}
                  {c.aiCategories.length ? <p className="mt-1 text-xs text-subtle-foreground">Flagged: {c.aiCategories.map(humanize).join(", ")}</p> : null}
                </div>
                <div>
                  <h3 className="mb-2 text-sm font-semibold">Reports</h3>
                  {c.reportCount ? (
                    <>
                      <p className="mb-1.5 text-xs text-subtle-foreground">
                        {c.reportCount} {c.reportCount === 1 ? "report" : "reports"}. Reporters stay private.
                      </p>
                      <Reasons reasons={c.reasons} />
                    </>
                  ) : (
                    <p className="text-xs text-subtle-foreground">No reports</p>
                  )}
                </div>
              </section>

              {c.author ? (
                <section className="flex items-center gap-3 rounded-lg border border-border p-3" data-testid="case-author">
                  <UserAvatar user={c.author} />
                  <div className="min-w-0 flex-1">
                    <Link href={profileHref(c.author.username)} className="text-sm font-semibold hover:underline">
                      {c.author.displayName}
                    </Link>
                    <p className="truncate text-xs text-subtle-foreground">{userTagline(c.author)}</p>
                  </div>
                  {c.author.role !== "USER" ? <Badge tone="primary">{humanize(c.author.role)}</Badge> : null}
                </section>
              ) : null}
            </TabsContent>
            <TabsContent value="history">
              <TargetHistory c={c} />
            </TabsContent>
            {c.appeal ? (
              <TabsContent value="appeal">
                <AppealPanel appeal={c.appeal} />
              </TabsContent>
            ) : null}
          </Tabs>
        ) : null}
      </div>
      {c ? <ActionBar c={c} onDone={onClose} /> : null}
    </>
  );
}

function Assignee({ user, mine }: { user: UserSummary | null; mine: boolean }) {
  return (
    <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="case-assignee">
      {user ? (
        <>
          <UserCheck className="size-3.5" aria-hidden />
          <UserAvatar user={user} size="xs" link={false} />
          <span>{mine ? "Assigned to you" : `Assigned to ${user.displayName}`}</span>
        </>
      ) : (
        <span>Nobody is assigned</span>
      )}
    </p>
  );
}

function TargetHistory({ c }: { c: ModerationCase }) {
  const history = useQuery({ queryKey: qk.modHistory(c.targetType, c.targetId), queryFn: () => api().moderation.history(c.targetType, c.targetId), meta: { silent: true } });
  return (
    <section>
      <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold">
        <History className="size-4" /> Every action on this {TARGET_LABEL[c.targetType].toLowerCase()}
      </h3>
      {history.isPending ? (
        <Skeleton className="h-12" />
      ) : history.isError ? (
        <ErrorState error={history.error} onRetry={() => void history.refetch()} compact />
      ) : !history.data.length ? (
        <p className="text-xs text-subtle-foreground">No earlier actions.</p>
      ) : (
        <ol className="space-y-3 border-l border-border pl-4" data-testid="case-history">
          {history.data.map((h) => (
            <li key={h.id} className="relative text-sm">
              <span className="absolute -left-[21px] top-1.5 size-2 rounded-full bg-primary" aria-hidden />
              <span className="font-semibold">{humanize(h.action)}</span> by {h.actor?.displayName ?? "the system"}
              {h.caseId === c.id ? <Badge tone="outline" className="ml-1.5">This case</Badge> : null}
              <span className="block text-xs text-subtle-foreground" title={fullTimestamp(h.createdAt)}>
                {relativeTime(h.createdAt)}
                {h.reason ? `: ${h.reason}` : ""}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function AppealPanel({ appeal }: { appeal: Appeal }) {
  return (
    <section className="rounded-lg border border-primary/30 bg-primary-soft/50 p-3" data-testid="case-appeal">
      <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold">
        <Scale className="size-4" /> Appeal from {appeal.appellant.displayName}
        <Badge tone={appeal.status === "PENDING" ? "warning" : appeal.status === "OVERTURNED" ? "success" : "neutral"} className="ml-auto">
          {humanize(appeal.status)}
        </Badge>
      </h3>
      <p className="text-xs text-subtle-foreground">Filed {relativeTime(appeal.createdAt)}</p>
      <p className="mt-2 whitespace-pre-wrap text-sm">{appeal.statement}</p>
      {appeal.status === "PENDING" ? (
        <div className="mt-3 border-t border-border pt-3">
          <AppealDecision appeal={appeal} />
        </div>
      ) : appeal.decisionNote ? (
        <p className="mt-2 text-xs text-muted-foreground">Decision note: {appeal.decisionNote}</p>
      ) : null}
    </section>
  );
}

function ActionBar({ c, onDone }: { c: ModerationCase; onDone: () => void }) {
  const { isStaff, isAdmin } = useAuth();
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const [days, setDays] = useState("7");
  const [confirm, setConfirm] = useState<ModerationActionType | null>(null);
  const actions = availableActions(c, { isStaff, isAdmin });
  const suspendDays = Math.min(3650, Math.max(1, Math.round(Number(days)) || 1));
  const act = useMutation({
    mutationFn: (action: ModerationActionType) => api().moderation.act(c.id, { action, reason: reason.trim() || undefined, suspendDays: action === "SUSPEND" ? suspendDays : undefined }),
    onSuccess: (updated, action) => {
      applyResolvedCase(qc, updated);
      void qc.invalidateQueries({ queryKey: qk.modStats });
      void qc.invalidateQueries({ queryKey: qk.modHistory(c.targetType, c.targetId) });
      toast.success({ title: `${actionLabel(action, c.targetType)}: done`, description: action === "DISMISS" ? "Case closed with no change." : "The case is resolved and the author was told." });
      setReason("");
      onDone();
    },
  });
  if (c.status !== "OPEN") {
    return <p className="shrink-0 border-t border-border bg-card px-5 py-3 text-xs text-subtle-foreground">This case is resolved. If the author appeals, the decision is reviewed in the Appeal tab.</p>;
  }
  if (!actions.length) return null;
  const run = (a: ModerationActionType) => (DESTRUCTIVE.has(a) ? setConfirm(a) : act.mutate(a));
  const contentActions = actions.filter((a) => !ACCOUNT_ACTIONS.has(a));
  const accountActions = actions.filter((a) => ACCOUNT_ACTIONS.has(a));
  return (
    <div className="shrink-0 space-y-3 border-t border-border bg-card px-5 py-4">
      <Field label="Reason" htmlFor="mod-reason" optional hint="Shown to the author with the decision, and kept in the history.">
        <Textarea id="mod-reason" rows={2} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example: unsolicited sales pitch" data-testid="mod-reason" />
      </Field>
      <div className="flex flex-wrap gap-2">
        {contentActions.map((a) => (
          <Button
            key={a}
            size="sm"
            variant={a === "APPROVE" || a === "RESTORE" ? "primary" : a === "REMOVE" ? "danger" : a === "DISMISS" ? "ghost" : "outline"}
            onClick={() => run(a)}
            loading={act.isPending && act.variables === a}
            disabled={act.isPending}
            data-testid={`case-action-${a.toLowerCase()}`}
          >
            {actionLabel(a, c.targetType)}
          </Button>
        ))}
      </div>
      {accountActions.length ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-subtle-foreground">Account</span>
          {accountActions.map((a) =>
            a === "SUSPEND" ? (
              <span key={a} className="flex items-center gap-1.5">
                <Input type="number" inputMode="numeric" min={1} max={3650} value={days} onChange={(e) => setDays(e.target.value)} className="h-8 w-16" aria-label="Suspension days" data-testid="suspend-days" />
                <span className="text-xs text-muted-foreground">days</span>
                <Button size="sm" variant="outline" onClick={() => run(a)} disabled={act.isPending} data-testid="case-action-suspend">
                  Suspend
                </Button>
              </span>
            ) : (
              <Button key={a} size="sm" variant={a === "BAN" ? "danger" : "outline"} onClick={() => run(a)} disabled={act.isPending} data-testid={`case-action-${a.toLowerCase()}`}>
                {actionLabel(a, c.targetType)}
              </Button>
            ),
          )}
        </div>
      ) : null}
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm ? `${actionLabel(confirm, c.targetType)}?` : ""}
        description={
          confirm === "BAN"
            ? "The account is banned and every session revoked. The author can not sign in to appeal."
            : confirm === "SUSPEND"
              ? `The account can read but not post, message or recruit for ${suspendDays} day${suspendDays === 1 ? "" : "s"}. They can appeal.`
              : `The ${TARGET_LABEL[c.targetType].toLowerCase()} is removed for everyone. The author can appeal.`
        }
        confirmLabel={confirm ? actionLabel(confirm, c.targetType) : "Confirm"}
        destructive
        onConfirm={() => (confirm ? act.mutateAsync(confirm) : undefined)}
      >
        {reason.trim() ? (
          <p className="text-sm text-muted-foreground">Reason: {reason.trim()}</p>
        ) : (
          <p className="text-sm text-warning">No reason given. Add one above so the author understands the decision.</p>
        )}
      </ConfirmDialog>
    </div>
  );
}
