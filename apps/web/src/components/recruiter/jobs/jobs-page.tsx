"use client";

import { useState } from "react";
import Link from "next/link";
import { BriefcaseBusiness, Plus, Users } from "lucide-react";
import type { Job, JobStatus } from "@open-talent/types";
import { Badge, Button, Card, EmptyState, Skeleton, Tabs, TabsList, TabsTrigger } from "@open-talent/ui";
import { api } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { qk } from "@/lib/query-keys";
import { usePagedList } from "@/lib/hooks/queries";
import { ErrorState, LoadMore, PageTitle } from "@/components/common/states";
import { TimeAgo } from "@/components/common/time-ago";
import { EMPLOYMENT_LABEL, SENIORITY_LABEL, formatPlace, formatSalary } from "@/components/jobs/job-format";
import { JOB_STATUS_LABEL, JOB_STATUS_TONE, shortDate } from "../format";
import { JobActionsMenu } from "./job-actions";

const TABS: { value: JobStatus | "ALL"; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "OPEN", label: "Open" },
  { value: "DRAFT", label: "Drafts" },
  { value: "CLOSED", label: "Closed" },
  { value: "FILLED", label: "Filled" },
];

export function RecruiterJobsPage() {
  const me = useMe();
  const slug = me.recruiter!.company.slug;
  const [tab, setTab] = useState<JobStatus | "ALL">("ALL");
  const status = tab === "ALL" ? undefined : tab;
  const list = usePagedList<Job>({
    queryKey: qk.companyJobs(slug, status),
    fetchPage: (cursor) => api().companies.jobs(slug, { status, cursor, limit: 20 }),
  });

  return (
    <div data-testid="recruiter-jobs">
      <PageTitle
        title="Jobs"
        description={`Every posting for ${me.recruiter!.company.name}. Your whole team shares these.`}
        actions={
          <Button asChild>
            <Link href="/recruiter/jobs/new" data-testid="jobs-new">
              <Plus /> Post a job
            </Link>
          </Button>
        }
      />
      <Card>
        <Tabs value={tab} onValueChange={(v) => setTab(v as JobStatus | "ALL")}>
          <TabsList className="px-2" aria-label="Job status">
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value} data-testid={`jobs-tab-${t.value.toLowerCase()}`}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        {list.isPending ? (
          <ul className="divide-y divide-border">
            {Array.from({ length: 4 }, (_, i) => (
              <li key={i} className="space-y-2 p-4">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-3 w-1/2" />
              </li>
            ))}
          </ul>
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : !list.items.length ? (
          <EmptyState
            icon={<BriefcaseBusiness />}
            title={tab === "ALL" ? "No jobs yet" : `No ${JOB_STATUS_LABEL[tab].toLowerCase()} jobs`}
            description={tab === "DRAFT" ? "Save a job as a draft to finish it later." : "Post a job: candidates apply in one step with their talent page, and your team reviews them on a shared board."}
            action={
              <Button asChild size="sm" variant="soft">
                <Link href="/recruiter/jobs/new">Post a job</Link>
              </Button>
            }
          />
        ) : (
          <ul className="divide-y divide-border">
            {list.items.map((job) => (
              <JobRow key={job.id} job={job} />
            ))}
          </ul>
        )}
        <LoadMore sentinelRef={list.sentinelRef} loading={list.isFetchingNextPage} hasMore={!!list.hasNextPage} onClick={() => list.fetchNextPage()} />
      </Card>
    </div>
  );
}

function JobRow({ job }: { job: Job }) {
  const salary = formatSalary(job.salary);
  return (
    <li className="flex items-start gap-3 p-4 transition-colors hover:bg-muted/50" data-testid="job-row">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/recruiter/jobs/${job.id}`} className="truncate text-base font-semibold hover:underline">
            {job.title}
          </Link>
          <Badge tone={JOB_STATUS_TONE[job.status]}>{JOB_STATUS_LABEL[job.status]}</Badge>
        </div>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {[formatPlace(job.location, job.workplaceType), EMPLOYMENT_LABEL[job.employmentType], job.seniority ? SENIORITY_LABEL[job.seniority] : null, salary].filter(Boolean).join(" · ")}
        </p>
        <p className="mt-1 text-xs text-subtle-foreground">
          {job.status === "DRAFT" ? (
            <>
              Draft saved <TimeAgo value={job.createdAt} />
            </>
          ) : job.openedAt ? (
            <>
              Opened <TimeAgo value={job.openedAt} />
            </>
          ) : (
            <>
              Created <TimeAgo value={job.createdAt} />
            </>
          )}
          {job.closesAt ? ` · Closes ${shortDate(job.closesAt)}` : ""}
          {job.postedBy ? ` · Posted by ${job.postedBy.displayName}` : ""}
        </p>
      </div>
      <Link
        href={`/recruiter/jobs/${job.id}`}
        className="hidden shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-sm font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:inline-flex"
        aria-label={`${job.applicationCount} applicants`}
      >
        <Users className="size-4" aria-hidden />
        <span className="tabular-nums">{job.applicationCount}</span>
      </Link>
      <JobActionsMenu job={job} />
    </li>
  );
}
