"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, BriefcaseBusiness } from "lucide-react";
import { Card, Skeleton } from "@open-talent/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { qk } from "@/lib/query-keys";
import { CompanyLogo, UserAvatar, UserName, userTagline } from "@/components/common/user-bits";
import { ConnectButton } from "@/components/network/connect-button";
import { WORKPLACE_LABEL } from "@/components/jobs/job-format";

function RailCard({ title, action, children, testId }: { title: string; action?: React.ReactNode; children: React.ReactNode; testId?: string }) {
  return (
    <Card className="p-4" data-testid={testId}>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-base font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </Card>
  );
}

function RowSkeleton({ n = 3 }: { n?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="size-10 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

function PeopleYouMayKnow() {
  const { data, isPending } = useQuery({ queryKey: qk.suggestions, queryFn: () => api().network.suggestions(), staleTime: 300_000, meta: { silent: true } });
  if (!isPending && !data?.length) return null;
  return (
    <RailCard
      title="Add to your network"
      testId="rail-suggestions"
      action={
        <Link href="/network" className="text-sm font-medium text-link hover:underline">
          See all
        </Link>
      }
    >
      {isPending ? (
        <RowSkeleton />
      ) : (
        <ul className="space-y-3">
          {data!.slice(0, 4).map((e) => (
            <li key={e.user.id} className="flex items-start gap-3">
              <UserAvatar user={e.user} />
              <div className="min-w-0 flex-1">
                <UserName user={e.user} className="text-sm" />
                <p className="line-clamp-2 text-xs text-muted-foreground">{userTagline(e.user)}</p>
                {e.mutualCount ? <p className="text-xs text-subtle-foreground">{e.mutualCount} mutual connection{e.mutualCount > 1 ? "s" : ""}</p> : null}
                <div className="mt-1.5">
                  <ConnectButton user={e.user} state={e.connection} connectionId={e.connectionId} />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </RailCard>
  );
}

function JobsForYou() {
  const { data, isPending } = useQuery({ queryKey: qk.recommendedJobs, queryFn: () => api().jobs.recommended(), staleTime: 300_000, meta: { silent: true } });
  if (!isPending && !data?.length) return null;
  return (
    <RailCard
      title="Jobs for you"
      testId="rail-jobs"
      action={
        <Link href="/jobs" className="text-sm font-medium text-link hover:underline">
          All jobs
        </Link>
      }
    >
      {isPending ? (
        <RowSkeleton />
      ) : (
        <ul className="-mx-2">
          {data!.slice(0, 4).map((j) => (
            <li key={j.id}>
              <Link href={`/jobs?job=${encodeURIComponent(j.id)}`} className="flex items-start gap-3 rounded-md px-2 py-2 hover:bg-muted">
                <CompanyLogo company={j.company} size="md" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-link">{j.title}</span>
                  <span className="block truncate text-xs text-foreground">{j.company.name}</span>
                  <span className="block truncate text-xs text-subtle-foreground">
                    {j.location ? `${j.location}, ` : ""}
                    {WORKPLACE_LABEL[j.workplaceType]}
                    {j.viewer.matchScore != null ? `, ${j.viewer.matchScore}% skills match` : ""}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </RailCard>
  );
}

function HiringCallout() {
  const { user } = useAuth();
  if (!user || user.recruiter) return null;
  return (
    <Card className="p-4">
      <p className="flex items-center gap-2 text-sm font-semibold">
        <BriefcaseBusiness className="size-4 text-primary" /> Hiring?
      </p>
      <p className="mt-1 text-sm text-muted-foreground">Verify your work email, set up your company page, and reach candidates who said yes to hearing from you.</p>
      <Link href="/recruiter/join" className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-link hover:underline">
        Start hiring <ArrowRight className="size-3.5" />
      </Link>
    </Card>
  );
}

export function RightRail() {
  const { status } = useAuth();
  if (status !== "signed-in") return null;
  return (
    <aside aria-label="Sidebar" className="space-y-3 pb-8">
      <PeopleYouMayKnow />
      <JobsForYou />
      <HiringCallout />
    </aside>
  );
}
