"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Briefcase, Newspaper, Users } from "lucide-react";
import { Button, Card, EmptyState, Skeleton } from "@open-talent/ui";
import type { Company, Job, UserSummary } from "@open-talent/types";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { usePagedList } from "@/lib/hooks/queries";
import { qk } from "@/lib/query-keys";
import { compactNumber } from "@/lib/time";
import { PersonRow, profileHref } from "@/components/common/user-bits";
import { ErrorState, LoadMore } from "@/components/common/states";
import { PostFeed } from "@/components/posts/post-feed";
import { PostCard, PostSkeleton } from "@/components/posts/post-card";
import { useSaveJob } from "@/components/jobs/job-cache";
import { JobCard, JobCardSkeleton, SectionCard } from "@/components/jobs/job-bits";
import { jobHref } from "@/components/jobs/job-query";

export type CompanyTab = "home" | "about" | "jobs" | "people" | "posts" | "team";

const ABOUT_EXCERPT = 360;

function safeHref(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

export function websiteHref(company: Pick<Company, "website">): string | null {
  return company.website ? safeHref(company.website) : null;
}

export function websiteLabel(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function SeeAll({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <Button variant="link" size="sm" onClick={onClick}>
      {children}
    </Button>
  );
}

export function HomeTab({ company, onTab }: { company: Company; onTab: (t: CompanyTab) => void }) {
  const { status } = useAuth();
  const signedIn = status === "signed-in";
  const save = useSaveJob();
  const jobs = useQuery({
    queryKey: [...qk.companyJobs(company.slug, "OPEN"), "preview"],
    queryFn: async () => (await api().companies.jobs(company.slug, { status: "OPEN", limit: 3 })).items,
    enabled: company.openJobCount > 0,
  });
  const posts = useQuery({
    queryKey: [...qk.companyPosts(company.slug), "preview"],
    queryFn: async () => (await api().companies.posts(company.slug, { limit: 2 })).items,
  });
  const about = company.about ?? "";
  return (
    <div className="space-y-4">
      <SectionCard title="Overview" action={about.length > ABOUT_EXCERPT ? <SeeAll onClick={() => onTab("about")}>See more</SeeAll> : null}>
        {about ? (
          <p className="whitespace-pre-line text-sm leading-relaxed">{about.length > ABOUT_EXCERPT ? `${about.slice(0, ABOUT_EXCERPT).trimEnd()}...` : about}</p>
        ) : (
          <p className="text-sm text-muted-foreground">{company.name} has not written an overview yet.</p>
        )}
      </SectionCard>

      <Card className="overflow-hidden" data-testid="company-home-jobs">
        <div className="flex items-center justify-between px-4 pb-2 pt-4 sm:px-5">
          <h2 className="text-xl font-semibold">Open jobs</h2>
          {company.openJobCount > 0 ? <SeeAll onClick={() => onTab("jobs")}>{`See all ${company.openJobCount}`}</SeeAll> : null}
        </div>
        {company.openJobCount === 0 ? (
          <p className="px-4 pb-4 text-sm text-muted-foreground sm:px-5">No open jobs right now. Follow {company.name} to hear when they post one.</p>
        ) : jobs.isPending ? (
          <JobCardSkeleton n={2} />
        ) : jobs.isError ? (
          <ErrorState error={jobs.error} onRetry={() => void jobs.refetch()} compact />
        ) : (
          <ul className="border-t border-border">
            {(jobs.data ?? []).map((j: Job) => (
              <li key={j.id}>
                <JobCard job={j} href={jobHref(j.id)} signedIn={signedIn} onToggleSave={j.viewer.canManage ? undefined : () => save.toggle(j)} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div data-testid="company-home-posts">
        <div className="mb-2 flex items-center justify-between px-1">
          <h2 className="text-xl font-semibold">Recent posts</h2>
          {posts.data?.length ? <SeeAll onClick={() => onTab("posts")}>See all posts</SeeAll> : null}
        </div>
        {posts.isPending ? (
          <PostSkeleton media={false} />
        ) : posts.isError ? (
          <Card>
            <ErrorState error={posts.error} onRetry={() => void posts.refetch()} compact />
          </Card>
        ) : posts.data.length ? (
          <div className="space-y-4">
            {posts.data.map((p) => (
              <PostCard key={p.id} post={p} />
            ))}
          </div>
        ) : (
          <Card>
            <EmptyState compact icon={<Newspaper />} title="No posts yet" description={`When ${company.name} posts updates, they show up here.`} />
          </Card>
        )}
      </div>
    </div>
  );
}

function FactRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5 sm:grid-cols-[180px_minmax(0,1fr)] sm:gap-4">
      <dt className="text-sm font-semibold">{label}</dt>
      <dd className="min-w-0 break-words text-sm text-muted-foreground">{children}</dd>
    </div>
  );
}

export function AboutTab({ company }: { company: Company }) {
  const site = websiteHref(company);
  return (
    <SectionCard title="About" testId="company-about">
      {company.about ? <p className="whitespace-pre-line text-sm leading-relaxed">{company.about}</p> : <p className="text-sm text-muted-foreground">No overview yet.</p>}
      <dl className="mt-5 space-y-3 border-t border-border pt-4">
        {site ? (
          <FactRow label="Website">
            <a href={site} target="_blank" rel="noopener noreferrer nofollow" className="font-medium text-link hover:underline">
              {websiteLabel(site)}
            </a>
          </FactRow>
        ) : null}
        {company.industry ? <FactRow label="Industry">{company.industry}</FactRow> : null}
        {company.sizeBand ? <FactRow label="Company size">{company.sizeBand} employees</FactRow> : null}
        {company.headquarters ? <FactRow label="Headquarters">{company.headquarters}</FactRow> : null}
        {company.foundedYear ? <FactRow label="Founded">{company.foundedYear}</FactRow> : null}
        <FactRow label="Followers">{compactNumber(company.followerCount)}</FactRow>
        <FactRow label="Recruiters here">{company.memberCount}</FactRow>
        {company.rating.count > 0 && company.rating.average != null ? (
          <FactRow label="Rating">
            {company.rating.average.toFixed(1)} out of 5 from {company.rating.count === 1 ? "1 rating" : `${company.rating.count} ratings`} by people who worked with this team
          </FactRow>
        ) : null}
        <FactRow label="Verification">{company.status === "VERIFIED" ? "Verified: the team signed in with work email on the company domain" : company.status === "SUSPENDED" ? "Suspended" : "Not verified yet"}</FactRow>
      </dl>
    </SectionCard>
  );
}

export function JobsTab({ company }: { company: Company }) {
  const { status } = useAuth();
  const save = useSaveJob();
  const list = usePagedList<Job>({
    queryKey: qk.companyJobs(company.slug, "OPEN"),
    fetchPage: (cursor) => api().companies.jobs(company.slug, { status: "OPEN", cursor, limit: 20 }),
  });
  return (
    <Card className="overflow-hidden" data-testid="company-jobs">
      <div className="border-b border-border px-4 py-3 sm:px-5">
        <h2 className="text-xl font-semibold">Open jobs</h2>
      </div>
      {list.isPending ? (
        <JobCardSkeleton n={4} />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : !list.items.length ? (
        <EmptyState
          icon={<Briefcase />}
          title="No open jobs right now"
          description={`Follow ${company.name} to hear when they post one.`}
          action={
            <Button asChild variant="outline" size="sm">
              <Link href="/jobs">Browse all jobs</Link>
            </Button>
          }
        />
      ) : (
        <>
          <ul>
            {list.items.map((j) => (
              <li key={j.id}>
                <JobCard job={j} href={jobHref(j.id)} signedIn={status === "signed-in"} onToggleSave={j.viewer.canManage ? undefined : () => save.toggle(j)} />
              </li>
            ))}
          </ul>
          <LoadMore sentinelRef={list.sentinelRef} loading={list.isFetchingNextPage} hasMore={!!list.hasNextPage} onClick={() => void list.fetchNextPage()} />
        </>
      )}
    </Card>
  );
}

export function PeopleTab({ company }: { company: Company }) {
  const list = usePagedList<UserSummary>({ queryKey: qk.companyPeople(company.slug), fetchPage: (cursor) => api().companies.people(company.slug, { cursor, limit: 20 }) });
  return (
    <SectionCard title={`People at ${company.name}`} testId="company-people">
      <p className="-mt-2 mb-2 text-sm text-muted-foreground">Members whose published profile lists a current role here.</p>
      {list.isPending ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="size-10 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3 w-1/3" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} compact />
      ) : !list.items.length ? (
        <EmptyState compact icon={<Users />} title="No one listed yet" description="People appear here when their profile shows a current role at this company." />
      ) : (
        <>
          <ul className="divide-y divide-border">
            {list.items.map((u) => (
              <li key={u.id}>
                <PersonRow
                  user={u}
                  action={
                    <Button asChild variant="outline" size="sm">
                      <Link href={profileHref(u.username)}>View</Link>
                    </Button>
                  }
                />
              </li>
            ))}
          </ul>
          <LoadMore sentinelRef={list.sentinelRef} loading={list.isFetchingNextPage} hasMore={!!list.hasNextPage} onClick={() => void list.fetchNextPage()} />
        </>
      )}
    </SectionCard>
  );
}

export function PostsTab({ company }: { company: Company }) {
  return (
    <PostFeed
      queryKey={qk.companyPosts(company.slug)}
      fetchPage={(cursor) => api().companies.posts(company.slug, { cursor })}
      empty={
        <Card>
          <EmptyState icon={<Newspaper />} title="No posts yet" description={`When ${company.name} posts updates, they show up here.`} />
        </Card>
      }
    />
  );
}
