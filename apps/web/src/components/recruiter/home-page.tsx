"use client";

import Link from "next/link";
import { useQueries, useQuery } from "@tanstack/react-query";
import { ArrowRight, BriefcaseBusiness, Building2, Inbox, Plus, Search, Send, Star, Users } from "lucide-react";
import type { Application } from "@open-talent/types";
import { Badge, Button, Card, EmptyState, Skeleton, cn } from "@open-talent/ui";
import { api } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { qk } from "@/lib/query-keys";
import { ErrorState, PageTitle } from "@/components/common/states";
import { TimeAgo } from "@/components/common/time-ago";
import { CompanyLogo, UserAvatar, VerifiedMark, companyHref } from "@/components/common/user-bits";
import { formatPlace } from "@/components/jobs/job-format";
import { STAGE_LABEL, matchTone } from "./format";
import { useOpenJobs, useRecruiterAccount } from "./use-recruiter";

export function RecruiterHome() {
  const me = useMe();
  const slug = me.recruiter!.company.slug;
  const account = useRecruiterAccount();
  const jobs = useOpenJobs(slug);
  const pending = useQuery({ queryKey: [...qk.approachesSent("PENDING"), "count"], queryFn: () => api().approaches.sent({ status: "PENDING", limit: 50 }), staleTime: 60_000 });

  const openJobs = jobs.data?.items ?? [];
  const recentJobs = [...openJobs].sort((a, b) => (b.openedAt ?? b.createdAt).localeCompare(a.openedAt ?? a.createdAt)).slice(0, 4);
  const recent = useQueries({
    queries: recentJobs.map((j) => ({
      queryKey: [...qk.pipeline(j.id), "stage", "APPLIED", "recent"],
      queryFn: () => api().jobs.stage(j.id, "APPLIED", { limit: 5 }),
      staleTime: 60_000,
    })),
  });
  const recentApps: Application[] = recent
    .flatMap((r) => r.data?.items ?? [])
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 6);
  const recentLoading = jobs.isPending || recent.some((r) => r.isPending);

  const applicants = openJobs.reduce((n, j) => n + j.applicationCount, 0);
  const a = account.data;
  const quotaPct = a ? Math.min(100, Math.round((a.quota.usedToday / Math.max(1, a.quota.approachesPerDay)) * 100)) : 0;

  return (
    <div data-testid="recruiter-home">
      <PageTitle
        title={`Good to see you, ${me.displayName.split(" ")[0]}`}
        description="Your hiring at a glance."
        actions={
          <Button asChild>
            <Link href="/recruiter/jobs/new" data-testid="recruiter-post-job">
              <Plus /> Post a job
            </Link>
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="overflow-hidden lg:col-span-2" data-testid="recruiter-company-card">
          {account.isPending ? (
            <div className="flex items-center gap-4 p-5">
              <Skeleton className="size-16 rounded-xl" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
          ) : account.isError ? (
            <ErrorState compact error={account.error} onRetry={() => account.refetch()} />
          ) : (
            <div className="flex flex-wrap items-center gap-4 p-5">
              <CompanyLogo company={a!.company} size="xl" />
              <div className="min-w-[12rem] flex-1">
                <p className="flex items-center gap-1.5 text-xl font-semibold">
                  <span className="truncate">{a!.company.name}</span>
                  <VerifiedMark status={a!.company.status} />
                </p>
                {a!.company.tagline ? <p className="mt-0.5 text-sm text-muted-foreground">{a!.company.tagline}</p> : null}
                <p className="mt-1 text-xs text-subtle-foreground">
                  {[a!.company.industry, a!.company.headquarters, a!.company.sizeBand ? `${a!.company.sizeBand} employees` : null].filter(Boolean).join(" · ")}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  You are {a!.role === "OWNER" ? "an owner" : a!.role === "ADMIN" ? "an admin" : "a recruiter"}
                  {a!.title ? `, ${a!.title}` : ""}. {a!.company.followerCount} follower{a!.company.followerCount === 1 ? "" : "s"}.
                </p>
              </div>
              <Button asChild variant="outline" size="sm">
                <Link href={companyHref(a!.company.slug)}>
                  <Building2 /> Company page
                </Link>
              </Button>
            </div>
          )}
        </Card>

        <Card className="p-5" data-testid="recruiter-quota">
          <h2 className="text-sm font-semibold text-muted-foreground">Approaches today</h2>
          {a ? (
            <>
              <p className="mt-2 text-3xl font-bold tabular-nums">
                {a.quota.usedToday}
                <span className="text-base font-medium text-subtle-foreground"> of {a.quota.approachesPerDay}</span>
              </p>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={a.quota.approachesPerDay} aria-valuenow={a.quota.usedToday} aria-label="Approaches used today">
                <div className={cn("h-full rounded-full transition-[width]", quotaPct >= 90 ? "bg-danger" : quotaPct >= 70 ? "bg-warning" : "bg-primary")} style={{ width: `${quotaPct}%` }} />
              </div>
              <p className="mt-2 text-xs text-subtle-foreground">
                {Math.max(0, a.quota.approachesPerDay - a.quota.usedToday)} left. The quota resets at midnight UTC.
              </p>
            </>
          ) : (
            <Skeleton className="mt-3 h-12 w-full" />
          )}
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat icon={<BriefcaseBusiness />} label="Open jobs" value={a ? a.company.openJobCount : null} href="/recruiter/jobs" testId="stat-open-jobs" />
        <Stat icon={<Users />} label="Applicants on open jobs" value={jobs.data ? applicants : null} href="/recruiter/jobs" testId="stat-applicants" suffix={jobs.data?.nextCursor ? "+" : ""} />
        <Stat icon={<Send />} label="Pending approaches" value={pending.data ? pending.data.items.length : null} suffix={pending.data?.nextCursor ? "+" : ""} href="/recruiter/approaches" testId="stat-pending-approaches" />
        <Stat icon={<Star />} label="Saved candidates" value={null} href="/recruiter/saved" testId="stat-saved" cta="Open list" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2" data-testid="recruiter-recent-applications">
          <div className="flex items-center justify-between px-5 pb-2 pt-4">
            <h2 className="text-xl font-semibold">New applications</h2>
            <Link href="/recruiter/jobs" className="text-sm font-medium text-link hover:underline">
              All jobs
            </Link>
          </div>
          {recentLoading ? (
            <ul className="space-y-3 px-5 pb-5">
              {Array.from({ length: 4 }, (_, i) => (
                <li key={i} className="flex items-center gap-3">
                  <Skeleton className="size-10 rounded-full" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3 w-1/3" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                </li>
              ))}
            </ul>
          ) : jobs.isError ? (
            <ErrorState compact error={jobs.error} onRetry={() => jobs.refetch()} />
          ) : !recentApps.length ? (
            <EmptyState
              compact
              icon={<Inbox />}
              title={openJobs.length ? "No new applications yet" : "No open jobs yet"}
              description={openJobs.length ? "New applicants on your open jobs show up here. Invite people from talent search to get things moving." : "Post a job to start receiving applications."}
              action={
                <Button asChild size="sm" variant="soft">
                  <Link href={openJobs.length ? "/recruiter/talent" : "/recruiter/jobs/new"}>{openJobs.length ? "Search talent" : "Post a job"}</Link>
                </Button>
              }
            />
          ) : (
            <ul className="divide-y divide-border">
              {recentApps.map((app) => (
                <li key={app.id}>
                  <Link href={`/recruiter/jobs/${app.job.id}?application=${app.id}`} className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-muted">
                    <UserAvatar user={app.candidate} link={false} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{app.candidate.displayName}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {STAGE_LABEL[app.stage]} for {app.job.title}
                      </p>
                    </div>
                    {app.matchScore !== null ? (
                      <Badge tone={matchTone(app.matchScore)} className="tabular-nums">
                        {app.matchScore}% match
                      </Badge>
                    ) : null}
                    <TimeAgo value={app.createdAt} className="hidden shrink-0 text-xs text-subtle-foreground sm:block" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="space-y-4">
          <Card className="p-5">
            <h2 className="text-base font-semibold">Shortcuts</h2>
            <ul className="mt-2 space-y-1">
              <Shortcut href="/recruiter/jobs/new" icon={<Plus />} label="Post a job" />
              <Shortcut href="/recruiter/talent" icon={<Search />} label="Search talent" />
              <Shortcut href="/recruiter/approaches" icon={<Send />} label="Review approaches" />
              <Shortcut href="/recruiter/saved" icon={<Star />} label="Saved candidates" />
            </ul>
          </Card>
          <Card className="p-5">
            <h2 className="text-base font-semibold">Open jobs</h2>
            {jobs.isPending ? (
              <Skeleton className="mt-3 h-16 w-full" />
            ) : !openJobs.length ? (
              <p className="mt-2 text-sm text-muted-foreground">Nothing open right now.</p>
            ) : (
              <ul className="mt-2 space-y-1">
                {openJobs.slice(0, 5).map((j) => (
                  <li key={j.id}>
                    <Link href={`/recruiter/jobs/${j.id}`} className="-mx-2 flex items-center justify-between gap-2 rounded-md px-2 py-2 transition-colors hover:bg-muted">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold">{j.title}</span>
                        <span className="block truncate text-xs text-subtle-foreground">{formatPlace(j.location, j.workplaceType)}</span>
                      </span>
                      <span className="shrink-0 text-xs font-semibold tabular-nums text-muted-foreground">{j.applicationCount}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function Stat({ icon, label, value, href, testId, suffix = "", cta }: { icon: React.ReactNode; label: string; value: number | null; href: string; testId: string; suffix?: string; cta?: string }) {
  return (
    <Link href={href} className="group rounded-lg border border-border bg-card p-4 shadow-card transition-colors hover:bg-muted" data-testid={testId}>
      <span className="flex size-9 items-center justify-center rounded-md bg-primary-soft text-primary-soft-foreground [&_svg]:size-[18px]">{icon}</span>
      {cta ? (
        <p className="mt-3 flex items-center gap-1 text-sm font-semibold text-link">
          {cta} <ArrowRight className="size-4" aria-hidden />
        </p>
      ) : value === null ? (
        <Skeleton className="mt-3 h-7 w-12" />
      ) : (
        <p className="mt-3 text-2xl font-bold tabular-nums">
          {value}
          {suffix}
        </p>
      )}
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
    </Link>
  );
}

function Shortcut({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <li>
      <Link href={href} className="-mx-2 flex items-center gap-3 rounded-md px-2 py-2 text-sm font-medium transition-colors hover:bg-muted [&_svg]:size-4 [&_svg]:text-muted-foreground">
        {icon}
        {label}
        <ArrowRight className="ml-auto" aria-hidden />
      </Link>
    </li>
  );
}
