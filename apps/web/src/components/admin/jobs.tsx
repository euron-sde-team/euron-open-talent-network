"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation } from "@tanstack/react-query";
import { Briefcase, XCircle } from "lucide-react";
import { Badge, Button, Card, EmptyState, toast } from "@open-talent/ui";
import type { Job, JobStatus } from "@open-talent/types";
import { api } from "@/lib/api";
import { useDebounced } from "@/lib/hooks/use-debounced";
import { usePagedList } from "@/lib/hooks/queries";
import { qk } from "@/lib/query-keys";
import { compactNumber, fullTimestamp } from "@/lib/time";
import { EMPLOYMENT_LABEL, formatPlace } from "@/components/jobs/job-format";
import { CompanyLogo, companyHref, profileHref } from "@/components/common/user-bits";
import { ErrorState, LoadMore } from "@/components/common/states";
import { TimeAgo } from "@/components/common/time-ago";
import { AreaHeader, FilterTabs, ListSkeleton, ReasonDialog, SearchField, filtersOf, useRowCache } from "./admin-bits";

type Tab = "ALL" | JobStatus;
const TABS: { value: Tab; label: string }[] = [
  { value: "OPEN", label: "Open" },
  { value: "ALL", label: "All" },
  { value: "DRAFT", label: "Drafts" },
  { value: "CLOSED", label: "Closed" },
  { value: "FILLED", label: "Filled" },
];
const TONE: Record<JobStatus, "success" | "neutral" | "warning" | "primary"> = { OPEN: "success", DRAFT: "neutral", CLOSED: "warning", FILLED: "primary" };

export function AdminJobs() {
  const [tab, setTab] = useState<Tab>("OPEN");
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim(), 250);
  const filters = { status: tab === "ALL" ? undefined : tab, q: q || undefined };
  const list = usePagedList<Job>({ queryKey: qk.adminJobs(filters), fetchPage: (cursor) => api().admin.jobs({ cursor, ...filters }) });
  const [closing, setClosing] = useState<Job | null>(null);
  const cache = useRowCache<Job>(qk.adminJobsAll);
  const close = useMutation({
    mutationFn: (v: { job: Job; reason: string }) => api().admin.closeJob(v.job.id, v.reason),
    onMutate: (v) => {
      const snap = cache.snapshot();
      cache.patch(v.job.id, (row, key) => {
        const s = filtersOf(key).status;
        return s && s !== "CLOSED" ? null : { ...row, status: "CLOSED" };
      });
      return { snap };
    },
    onError: (_e, _v, ctx) => ctx && cache.restore(ctx.snap),
    onSuccess: (_d, v) => toast.success({ title: `"${v.job.title}" is closed`, description: "It no longer accepts applications. Existing applicants keep their status." }),
    onSettled: () => void cache.invalidate(),
  });

  return (
    <div>
      <AreaHeader title="Jobs" description="Every job posting on the network. Close a posting that breaks the rules; the hiring team keeps its pipeline." />
      <FilterTabs label="Job status" value={tab} onChange={setTab} options={TABS} testId="job-tabs" />
      <SearchField value={search} onChange={setSearch} placeholder="Search job titles" className="mb-3 max-w-md" testId="job-search" />
      <Card className="overflow-hidden">
        {list.isPending ? (
          <ListSkeleton rows={6} height="h-14" />
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        ) : !list.items.length ? (
          <EmptyState icon={<Briefcase />} title="No jobs here" description={q ? "Try a different search." : "Jobs posted by recruiters appear here."} />
        ) : (
          <>
            <table className="hidden w-full text-left text-sm md:table" data-testid="job-table">
              <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-subtle-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Job</th>
                  <th className="px-3 py-2.5 font-semibold">Status</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Applications</th>
                  <th className="px-3 py-2.5 font-semibold">Posted</th>
                  <th className="px-3 py-2.5" aria-label="Actions" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {list.items.map((j) => (
                  <tr key={j.id} data-testid="job-row">
                    <td className="max-w-0 px-4 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <CompanyLogo company={j.company} size="sm" />
                        <div className="min-w-0">
                          <Link href={`/jobs?job=${encodeURIComponent(j.id)}`} className="block truncate font-medium hover:underline">
                            {j.title}
                          </Link>
                          <p className="truncate text-xs text-subtle-foreground">
                            <Link href={companyHref(j.company.slug)} className="hover:underline">
                              {j.company.name}
                            </Link>
                            , {EMPLOYMENT_LABEL[j.employmentType]}, {formatPlace(j.location, j.workplaceType)}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge tone={TONE[j.status]}>{j.status.charAt(0) + j.status.slice(1).toLowerCase()}</Badge>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{compactNumber(j.applicationCount)}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-xs text-muted-foreground" title={fullTimestamp(j.createdAt)}>
                      <TimeAgo value={j.createdAt} />
                      {j.postedBy ? (
                        <>
                          {" by "}
                          <Link href={profileHref(j.postedBy.username)} className="hover:underline">
                            {j.postedBy.displayName}
                          </Link>
                        </>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {j.status === "OPEN" ? (
                        <Button size="sm" variant="danger-ghost" onClick={() => setClosing(j)} data-testid="job-close">
                          <XCircle /> Close
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ul className="divide-y divide-border md:hidden">
              {list.items.map((j) => (
                <li key={j.id} className="space-y-2 px-4 py-3" data-testid="job-row">
                  <div className="flex items-start gap-2.5">
                    <CompanyLogo company={j.company} size="sm" />
                    <div className="min-w-0 flex-1">
                      <Link href={`/jobs?job=${encodeURIComponent(j.id)}`} className="font-medium hover:underline">
                        {j.title}
                      </Link>
                      <p className="text-xs text-subtle-foreground">
                        {j.company.name}, {compactNumber(j.applicationCount)} applications, <TimeAgo value={j.createdAt} />
                      </p>
                    </div>
                    <Badge tone={TONE[j.status]}>{j.status.charAt(0) + j.status.slice(1).toLowerCase()}</Badge>
                  </div>
                  {j.status === "OPEN" ? (
                    <Button size="sm" variant="danger-ghost" onClick={() => setClosing(j)}>
                      <XCircle /> Close posting
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
            <LoadMore sentinelRef={list.sentinelRef} loading={list.isFetchingNextPage} hasMore={!!list.hasNextPage} onClick={() => void list.fetchNextPage()} />
          </>
        )}
      </Card>
      <ReasonDialog
        open={!!closing}
        onOpenChange={(o) => !o && setClosing(null)}
        title={closing ? `Close "${closing.title}"?` : ""}
        description="The posting stops accepting applications at once. The hiring team can see it was closed by the platform."
        confirmLabel="Close posting"
        destructive
        onConfirm={({ reason }) => close.mutateAsync({ job: closing!, reason })}
        testId="job-close-dialog"
      />
    </div>
  );
}
