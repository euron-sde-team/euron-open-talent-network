"use client";

import Link from "next/link";
import { Bookmark } from "lucide-react";
import { Button, Card, EmptyState } from "@open-talent/ui";
import type { Job } from "@open-talent/types";
import { api } from "@/lib/api";
import { usePagedList } from "@/lib/hooks/queries";
import { qk } from "@/lib/query-keys";
import { ErrorState, LoadMore, PageTitle } from "@/components/common/states";
import { useSaveJob } from "./job-cache";
import { JobCard, JobCardSkeleton } from "./job-bits";
import { jobHref } from "./job-query";

/** /jobs/saved. Unsaving keeps the row (marked) until the next visit, so it can be undone. */
export function SavedJobsPage() {
  const list = usePagedList<Job>({ queryKey: qk.savedJobs, fetchPage: (cursor) => api().jobs.saved({ cursor, limit: 20 }) });
  const save = useSaveJob();
  return (
    <div data-testid="saved-jobs-page">
      <PageTitle
        title="Saved jobs"
        description="Jobs you bookmarked to come back to."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/jobs/applications">My applications</Link>
          </Button>
        }
      />
      <Card className="overflow-hidden">
        {list.isPending ? (
          <JobCardSkeleton n={4} />
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        ) : !list.items.length ? (
          <EmptyState
            icon={<Bookmark />}
            title="No saved jobs yet"
            description="Save jobs from search with the bookmark button, and they wait for you here."
            action={
              <Button asChild size="sm">
                <Link href="/jobs">Find jobs</Link>
              </Button>
            }
          />
        ) : (
          <>
            <ul data-testid="saved-jobs">
              {list.items.map((job) => (
                <li key={job.id}>
                  <JobCard job={job} href={jobHref(job.id)} signedIn onToggleSave={() => save.toggle(job)} />
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
