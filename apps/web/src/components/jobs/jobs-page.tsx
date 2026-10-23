"use client";

import { useCallback, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { Briefcase, MousePointerClick, SearchX } from "lucide-react";
import { Button, Card, EmptyState, cn } from "@open-talent/ui";
import type { Job } from "@open-talent/types";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { usePagedList } from "@/lib/hooks/queries";
import { qk } from "@/lib/query-keys";
import { ErrorState, LoadMore } from "@/components/common/states";
import { useSaveJob } from "./job-cache";
import { JobCard, JobCardSkeleton } from "./job-bits";
import { JobDetail } from "./job-detail";
import { JobFilterBar } from "./job-filter-bar";
import { JobInvites, RecommendedJobs } from "./job-invites";
import { EMPTY_FILTERS, filtersToParams, hasAnyFilter, jobHref, parseFilters, toJobQuery, type JobFilters } from "./job-query";
import { useMediaQuery } from "./use-media-query";

const PAGE_SIZE = 20;

/** Updates the URL without a server round trip; Next keeps useSearchParams in sync. */
function writeUrl(sp: URLSearchParams, push: boolean) {
  const qs = sp.toString();
  const url = qs ? `/jobs?${qs}` : "/jobs";
  if (push) window.history.pushState(null, "", url);
  else window.history.replaceState(null, "", url);
}

function resultsTitle(f: JobFilters): string {
  if (f.q.trim() && f.location.trim()) return `${f.q.trim()} jobs in ${f.location.trim()}`;
  if (f.q.trim()) return `Jobs matching "${f.q.trim()}"`;
  if (f.location.trim()) return `Jobs in ${f.location.trim()}`;
  return hasAnyFilter(f) ? "Filtered jobs" : "Latest jobs";
}

/** /jobs: the split view search. Filters and the selected job live in the URL. */
export function JobsPage() {
  const sp = useSearchParams();
  const { status } = useAuth();
  const signedIn = status === "signed-in";
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const filters = useMemo(() => parseFilters(new URLSearchParams(sp.toString())), [sp]);
  const query = useMemo(() => toJobQuery(filters), [filters]);
  const selectedParam = sp.get("job");
  const autoApply = sp.get("apply") === "1";
  const save = useSaveJob();

  const list = usePagedList<Job>({
    queryKey: qk.jobs({ ...query, viewer: signedIn }),
    fetchPage: (cursor) => api().jobs.search({ ...query, cursor, limit: PAGE_SIZE }),
    enabled: status !== "loading",
  });

  const selectedId = selectedParam ?? (isDesktop ? (list.items[0]?.id ?? null) : null);

  const setFilters = (f: JobFilters) => {
    writeUrl(filtersToParams(f, new URLSearchParams(sp.toString())), false);
    window.scrollTo({ top: 0 });
  };

  const openJob = useCallback(
    (id: string, apply = false) => {
      const next = new URLSearchParams(sp.toString());
      next.set("job", id);
      if (apply) next.set("apply", "1");
      else next.delete("apply");
      writeUrl(next, !isDesktop);
      if (!isDesktop) window.scrollTo({ top: 0 });
    },
    [sp, isDesktop],
  );

  const closeJob = () => {
    const next = new URLSearchParams(sp.toString());
    next.delete("job");
    next.delete("apply");
    writeUrl(next, false);
  };

  const clearApply = useCallback(() => {
    const next = new URLSearchParams(window.location.search);
    if (!next.has("apply")) return;
    next.delete("apply");
    writeUrl(next, false);
  }, []);

  const showExtras = signedIn && !hasAnyFilter(filters);

  let results: React.ReactNode;
  if (list.isPending) results = <JobCardSkeleton n={6} />;
  else if (list.isError) results = <ErrorState error={list.error} onRetry={() => void list.refetch()} compact />;
  else if (!list.items.length) {
    results = hasAnyFilter(filters) ? (
      <EmptyState
        compact
        icon={<SearchX />}
        title="No jobs match these filters"
        description="Try fewer filters, a broader location, or different keywords. Remote jobs always match a location."
        action={
          <Button variant="outline" size="sm" onClick={() => setFilters({ ...EMPTY_FILTERS })} data-testid="jobs-empty-clear">
            Clear filters
          </Button>
        }
      />
    ) : (
      <EmptyState compact icon={<Briefcase />} title="No open jobs right now" description="When companies post jobs, they show up here. Follow companies to hear about new roles first." />
    );
  } else {
    results = (
      <>
        <ul data-testid="job-results">
          {list.items.map((job) => (
            <li key={job.id}>
              <JobCard job={job} href={jobHref(job.id)} selected={job.id === selectedId} onSelect={() => openJob(job.id)} signedIn={signedIn} onToggleSave={job.viewer.canManage ? undefined : () => save.toggle(job)} />
            </li>
          ))}
        </ul>
        <LoadMore
          sentinelRef={list.sentinelRef}
          loading={list.isFetchingNextPage}
          hasMore={!!list.hasNextPage}
          onClick={() => void list.fetchNextPage()}
          endLabel={list.items.length > 8 ? "You have seen every job that matches" : undefined}
        />
      </>
    );
  }

  return (
    <main id="main" className="mx-auto w-full max-w-[1180px] px-4 py-4" data-testid="jobs-page">
      <h1 className="sr-only">Jobs</h1>
      <Card className={cn("mb-4 p-3 sm:p-4", selectedParam && "max-md:hidden")}>
        <JobFilterBar filters={filters} onChange={setFilters} />
      </Card>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-[minmax(0,360px)_minmax(0,1fr)] lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <section aria-label="Job results" className={cn("min-w-0 space-y-4", selectedParam && "max-md:hidden")}>
          {showExtras ? (
            <>
              <JobInvites onOpenJob={openJob} />
              <RecommendedJobs onOpenJob={(id) => openJob(id)} selectedId={selectedId} />
            </>
          ) : null}
          <Card className="overflow-hidden">
            <div className="border-b border-border px-4 py-3">
              <h2 className="truncate text-base font-semibold">{resultsTitle(filters)}</h2>
              <p className="text-xs text-subtle-foreground">{query.sort === "relevance" ? "Most relevant first" : "Newest first"}</p>
            </div>
            {results}
          </Card>
        </section>
        <section aria-label="Job details" className={cn("min-w-0", !selectedParam && "max-md:hidden")}>
          <div className="scrollbar-thin md:sticky md:top-[calc(var(--header-height)+1rem)] md:max-h-[calc(100dvh-var(--header-height)-2rem)] md:overflow-y-auto md:overscroll-contain md:pb-2">
            {selectedId ? (
              <JobDetail key={selectedId} jobId={selectedId} onBack={closeJob} autoApply={autoApply} onAutoApplyHandled={clearApply} />
            ) : list.isPending || list.isError ? null : (
              <Card>
                <EmptyState icon={<MousePointerClick />} title="Pick a job to see the details" description="Select any job on the left to read the description and apply." />
              </Card>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
