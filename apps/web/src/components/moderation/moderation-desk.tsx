"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Inbox, Scale, Shield, ShieldCheck } from "lucide-react";
import { Badge, Button, Card, EmptyState, Select, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger, cn } from "@open-talent/ui";
import type { Appeal, CaseSource, ModerationCase, ModerationTarget, UserSummary } from "@open-talent/types";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { usePagedList } from "@/lib/hooks/queries";
import { TARGETS, TARGET_LABEL, caseSnippet, humanize } from "@/lib/moderation";
import { qk } from "@/lib/query-keys";
import { useSignals } from "@/lib/stores/signals";
import { compactNumber } from "@/lib/time";
import { ErrorState, LoadMore, PageTitle } from "@/components/common/states";
import { TimeAgo } from "@/components/common/time-ago";
import { UserAvatar } from "@/components/common/user-bits";
import { AppealDecision } from "./appeal-decision";
import { CaseDrawer } from "./case-drawer";
import { Reasons, SourceBadge, StatusBadge, TargetBadge } from "./case-bits";
import { PriorityBar, ScoreBars } from "./score-bars";

const ALL = "__all__";

/** Who holds a case, in the queue rows (the drawer has the full line). */
function Assignee({ user, className }: { user: UserSummary; className?: string }) {
  return (
    <span className={cn("flex min-w-0 items-center gap-1", className)} title={`Assigned to ${user.displayName}`} data-testid="moderation-case-assignee">
      <UserAvatar user={user} size="xs" link={false} />
      <span className="truncate">{user.displayName}</span>
    </span>
  );
}

function StatTile({ label, value, icon }: { label: string; value: number | undefined; icon: React.ReactNode }) {
  return (
    <Card className="flex items-center gap-3 p-4">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary-soft-foreground">{icon}</span>
      <div className="min-w-0">
        <p className="text-2xl font-bold tabular-nums">{value === undefined ? <Skeleton className="h-7 w-10" /> : compactNumber(value)}</p>
        <p className="truncate text-xs text-subtle-foreground">{label}</p>
      </div>
    </Card>
  );
}

/** The staff case desk. `embedded` renders it as an area of /admin (no page title). */
export function ModerationDesk({ embedded }: { embedded?: boolean }) {
  const { isStaff } = useAuth();
  const liveOpen = useSignals((s) => s.modOpenCases);
  const stats = useQuery({ queryKey: qk.modStats, queryFn: () => api().moderation.stats(), enabled: isStaff, refetchInterval: 60_000, meta: { silent: true } });
  const [openCase, setOpenCase] = useState<string | null>(null);
  const [tab, setTab] = useState("queue");

  if (!isStaff) {
    return (
      <Card>
        <EmptyState icon={<Shield />} title="No moderation access" description="The moderation desk is for network moderators and admins." />
      </Card>
    );
  }

  const openCount = liveOpen ?? stats.data?.openCases;
  const heading = (
    <PageTitle
      title={embedded ? <span className="text-xl font-semibold">Moderation</span> : "Moderation desk"}
      description="Flagged and reported posts, comments, messages, profiles, company pages, jobs, recruiter approaches and accounts."
      actions={
        openCount !== undefined ? (
          <Badge tone="warning" size="md" data-testid="moderation-open-count">
            {openCount} open
          </Badge>
        ) : null
      }
    />
  );
  return (
    <div>
      {heading}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="moderation-stats">
        <StatTile label="Open cases" value={openCount} icon={<Inbox className="size-5" />} />
        <StatTile label="Open appeals" value={stats.data?.openAppeals} icon={<Scale className="size-5" />} />
        <StatTile label="Actions today" value={stats.data?.actionsToday} icon={<ShieldCheck className="size-5" />} />
        <StatTile label="Auto-hidden today" value={stats.data?.autoHiddenToday} icon={<Shield className="size-5" />} />
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="queue" data-testid="tab-queue">
            Queue
          </TabsTrigger>
          <TabsTrigger value="appeals" data-testid="tab-appeals">
            Appeals
            {stats.data?.openAppeals ? <span className="ml-1.5 rounded-full bg-primary px-1.5 text-2xs font-bold text-primary-foreground">{stats.data.openAppeals}</span> : null}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="queue">
          <Queue onOpen={setOpenCase} />
        </TabsContent>
        <TabsContent value="appeals">
          <Appeals onOpenCase={setOpenCase} />
        </TabsContent>
      </Tabs>
      <CaseDrawer caseId={openCase} onOpenChange={(o) => !o && setOpenCase(null)} />
    </div>
  );
}

function Queue({ onOpen }: { onOpen: (id: string) => void }) {
  const [status, setStatus] = useState<"OPEN" | "RESOLVED">("OPEN");
  const [source, setSource] = useState<string>(ALL);
  const [target, setTarget] = useState<string>(ALL);
  const filters = { status, source: source === ALL ? undefined : source, targetType: target === ALL ? undefined : target };
  const list = usePagedList<ModerationCase>({
    queryKey: qk.modCases(filters),
    fetchPage: (cursor) => api().moderation.cases({ cursor, status, source: filters.source as CaseSource | undefined, targetType: filters.targetType as ModerationTarget | undefined }),
  });
  const liveOpen = useSignals((s) => s.modOpenCases);
  const qc = useQueryClient();
  // The open count changed somewhere (moderation:queue): refresh the open queue in the background.
  useEffect(() => {
    if (liveOpen !== null && status === "OPEN") void qc.invalidateQueries({ queryKey: qk.modCasesAll, refetchType: "active" });
  }, [liveOpen, status, qc]);

  return (
    <div>
      <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Select aria-label="Status" value={status} onValueChange={(v) => setStatus(v as "OPEN" | "RESOLVED")} options={[{ value: "OPEN", label: "Open" }, { value: "RESOLVED", label: "Resolved" }]} data-testid="filter-status" />
        <Select
          aria-label="Source"
          value={source}
          onValueChange={setSource}
          options={[{ value: ALL, label: "All sources" }, { value: "AI", label: "AI flags" }, { value: "REPORT", label: "Reports" }, { value: "PREMODERATION", label: "Pre-moderation" }]}
          data-testid="filter-source"
        />
        <Select aria-label="Content type" value={target} onValueChange={setTarget} options={[{ value: ALL, label: "All content" }, ...TARGETS.map((t) => ({ value: t, label: TARGET_LABEL[t] }))]} data-testid="filter-type" />
      </div>
      <Card className="overflow-hidden" data-testid="moderation-queue">
        {list.isPending ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-14" />
            ))}
          </div>
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        ) : !list.items.length ? (
          <EmptyState
            icon={<ShieldCheck />}
            title={status === "OPEN" ? "The queue is clear" : "No resolved cases"}
            description={status === "OPEN" ? "Nothing needs a decision right now. New flags and reports show up here live." : "Decisions are listed here."}
          />
        ) : (
          <>
            <table className="hidden w-full table-fixed text-left text-sm lg:table">
              <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-subtle-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Content</th>
                  <th className="w-40 px-3 py-2.5 font-semibold">Source</th>
                  <th className="w-48 px-3 py-2.5 font-semibold">AI scores</th>
                  <th className="w-24 px-3 py-2.5 font-semibold">Priority</th>
                  <th className="w-24 px-3 py-2.5 font-semibold">Opened</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {list.items.map((c) => (
                  <tr key={c.id} onClick={() => onOpen(c.id)} className="cursor-pointer transition-colors hover:bg-muted" data-testid="moderation-case">
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        className="block w-full min-w-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpen(c.id);
                        }}
                      >
                        <span className="flex flex-wrap items-center gap-1.5">
                          <TargetBadge type={c.targetType} />
                          <StatusBadge status={c.targetStatus} />
                          {c.resolution ? <Badge tone="outline">{humanize(c.resolution)}</Badge> : null}
                        </span>
                        <span className="mt-1 block truncate font-medium">{caseSnippet(c)}</span>
                        {c.author ? (
                          <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                            <UserAvatar user={c.author} size="xs" link={false} /> {c.author.displayName}
                          </span>
                        ) : null}
                      </button>
                    </td>
                    <td className="px-3 py-3 align-top">
                      <div className="space-y-1.5">
                        <SourceBadge source={c.source} />
                        {c.reportCount ? <p className="text-xs text-muted-foreground">{c.reportCount} {c.reportCount === 1 ? "report" : "reports"}</p> : null}
                        <Reasons reasons={c.reasons} />
                      </div>
                    </td>
                    <td className="px-3 py-3 align-top">
                      <ScoreBars scores={c.aiScores} compact />
                    </td>
                    <td className="px-3 py-3 align-top">
                      <PriorityBar value={c.priority} />
                    </td>
                    <td className="px-3 py-3 align-top text-xs text-muted-foreground">
                      <span className="block whitespace-nowrap">
                        <TimeAgo value={c.openedAt} />
                      </span>
                      {c.assignedTo ? <Assignee user={c.assignedTo} className="mt-1" /> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ul className="divide-y divide-border lg:hidden">
              {list.items.map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => onOpen(c.id)} className="block w-full space-y-2 px-4 py-3 text-left hover:bg-muted" data-testid="moderation-case">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <TargetBadge type={c.targetType} />
                      <SourceBadge source={c.source} />
                      <StatusBadge status={c.targetStatus} />
                      <span className="ml-auto text-xs text-subtle-foreground">
                        <TimeAgo value={c.openedAt} />
                      </span>
                    </span>
                    <span className="block text-sm font-medium">{caseSnippet(c)}</span>
                    <span className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span className="truncate">{c.author ? c.author.displayName : "Unknown author"}</span>
                      {c.assignedTo ? <Assignee user={c.assignedTo} /> : null}
                      <PriorityBar value={c.priority} />
                    </span>
                    <ScoreBars scores={c.aiScores} />
                    <Reasons reasons={c.reasons} />
                  </button>
                </li>
              ))}
            </ul>
            <LoadMore sentinelRef={list.sentinelRef} loading={list.isFetchingNextPage} hasMore={!!list.hasNextPage} onClick={() => void list.fetchNextPage()} />
          </>
        )}
      </Card>
    </div>
  );
}

function Appeals({ onOpenCase }: { onOpenCase: (id: string) => void }) {
  const [status, setStatus] = useState("PENDING");
  const list = usePagedList<Appeal>({ queryKey: qk.modAppeals(status), fetchPage: (cursor) => api().moderation.appeals({ cursor, status }) });
  return (
    <div>
      <div className="mb-3 w-full sm:w-48">
        <Select aria-label="Appeal status" value={status} onValueChange={setStatus} options={[{ value: "PENDING", label: "Pending" }, { value: "UPHELD", label: "Upheld" }, { value: "OVERTURNED", label: "Overturned" }]} data-testid="appeal-filter" />
      </div>
      {list.isPending ? (
        <Skeleton className="h-32" />
      ) : list.isError ? (
        <Card>
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        </Card>
      ) : !list.items.length ? (
        <Card>
          <EmptyState icon={<Scale />} title="No appeals here" description="Appeals from members who disagree with a decision appear here. A different moderator decides each one." />
        </Card>
      ) : (
        <div className="space-y-3" data-testid="appeals-list">
          {list.items.map((a) => (
            <AppealCard key={a.id} appeal={a} onOpenCase={onOpenCase} />
          ))}
          <LoadMore sentinelRef={list.sentinelRef} loading={list.isFetchingNextPage} hasMore={!!list.hasNextPage} onClick={() => void list.fetchNextPage()} />
        </div>
      )}
    </div>
  );
}

function AppealCard({ appeal, onOpenCase }: { appeal: Appeal; onOpenCase: (id: string) => void }) {
  return (
    <Card className="p-4" data-testid="appeal-card">
      <div className="flex items-start gap-3">
        <UserAvatar user={appeal.appellant} />
        <div className="min-w-0 flex-1">
          <p className="text-sm">
            <span className="font-semibold">{appeal.appellant.displayName}</span> appealed <TimeAgo value={appeal.createdAt} className="text-subtle-foreground" />
          </p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{appeal.statement}</p>
          <Button variant="link" size="sm" className="mt-1" onClick={() => onOpenCase(appeal.caseId)} data-testid="appeal-open-case">
            Review the case
          </Button>
        </div>
        <Badge tone={appeal.status === "PENDING" ? "warning" : appeal.status === "OVERTURNED" ? "success" : "neutral"}>{humanize(appeal.status)}</Badge>
      </div>
      {appeal.status === "PENDING" ? (
        <div className="mt-3 border-t border-border pt-3">
          <AppealDecision appeal={appeal} />
        </div>
      ) : appeal.decisionNote ? (
        <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">Note: {appeal.decisionNote}</p>
      ) : null}
    </Card>
  );
}
