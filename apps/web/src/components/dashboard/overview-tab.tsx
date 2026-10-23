"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Building2, Eye, Handshake, Search, Sparkles } from "lucide-react";
import { Button, Card, CardContent, CardHeader, CardTitle, EmptyState, Skeleton } from "@open-talent/ui";
import { api } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { qk } from "@/lib/query-keys";
import { compactNumber } from "@/lib/time";
import { ErrorState } from "@/components/common/states";
import { companyHref, profileHref } from "@/components/common/user-bits";
import { CompletenessMeter } from "@/components/shell/left-rail";
import { ViewsChart } from "./views-chart";

function Stat({ label, value, hint, icon, testId }: { label: string; value: number; hint?: string; icon: React.ReactNode; testId: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4" data-testid={testId}>
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground [&_svg]:size-4">
        {icon}
        {label}
      </div>
      <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">{compactNumber(value)}</p>
      {hint ? <p className="text-xs text-subtle-foreground">{hint}</p> : null}
    </div>
  );
}

function ProfileStrength() {
  const me = useMe();
  const mine = useQuery({ queryKey: qk.myProfile, queryFn: () => api().profiles.mine(), staleTime: 60_000, meta: { silent: true } });
  const pct = Math.round(me.profileCompleteness);
  const threshold = mine.data?.publishThreshold ?? 55;
  const draft = me.profileStatus === "DRAFT";
  const missing = mine.data?.missing ?? [];
  return (
    <Card data-testid="dashboard-strength">
      <CardHeader>
        <CardTitle className="text-base">Profile strength</CardTitle>
        <span className="text-sm font-semibold tabular-nums">{pct}%</span>
      </CardHeader>
      <CardContent className="space-y-3">
        <CompletenessMeter value={pct} threshold={threshold} />
        {draft ? (
          <>
            <p className="text-sm text-muted-foreground">
              Your profile is a draft, so recruiters can not find you yet. Publishing needs {threshold}% and at least one contact channel.
            </p>
            <Button asChild size="sm" data-testid="dashboard-setup-cta">
              <Link href="/profile/setup">
                <Sparkles /> Finish and publish your profile
              </Link>
            </Button>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Your profile is {me.profileStatus === "UNLISTED" ? "unlisted: people with the link can see it, but it is not in search" : me.profileStatus === "SUSPENDED" ? "suspended while a moderator reviews it" : "published and visible in the talent directory"}.
          </p>
        )}
        {missing.length ? (
          <div>
            <p className="text-xs font-semibold text-foreground">Next steps</p>
            <ul className="mt-1 list-inside list-disc space-y-0.5 text-sm text-muted-foreground marker:text-subtle-foreground">
              {missing.slice(0, 5).map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {!draft ? (
          <Link href={profileHref(me.username)} className="inline-flex items-center gap-1 text-sm font-medium text-link hover:underline">
            View your profile <ArrowRight className="size-3.5" />
          </Link>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function OverviewTab({ onTab }: { onTab: (tab: "approaches") => void }) {
  const q = useQuery({ queryKey: qk.profileAnalytics, queryFn: () => api().profiles.analytics(), staleTime: 60_000 });

  return (
    <div className="space-y-4">
      <ProfileStrength />
      {q.isPending ? (
        <Card className="space-y-4 p-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
          <Skeleton className="h-32" />
        </Card>
      ) : q.isError ? (
        <Card>
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        </Card>
      ) : (
        <>
          <section aria-labelledby="dash-analytics" className="space-y-3">
            <h2 id="dash-analytics" className="text-xl font-semibold">
              Profile analytics
            </h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="Views, 7 days" value={q.data.views7d} icon={<Eye />} testId="stat-views-7d" />
              <Stat label="Views, 30 days" value={q.data.views30d} icon={<Eye />} testId="stat-views-30d" />
              <Stat label="Search appearances" value={q.data.searchAppearances30d} hint="Last 30 days" icon={<Search />} testId="stat-search" />
              <Stat label="Approaches" value={q.data.approaches.total} hint={`${q.data.approaches.pending} pending, ${q.data.approaches.accepted} accepted`} icon={<Handshake />} testId="stat-approaches" />
            </div>
          </section>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Daily profile views</CardTitle>
              <span className="text-xs text-subtle-foreground">Last {q.data.daily.length} days</span>
            </CardHeader>
            <CardContent>
              <ViewsChart daily={q.data.daily} />
            </CardContent>
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            <Card data-testid="dashboard-recruiter-companies">
              <CardHeader>
                <CardTitle className="text-base">Recruiters who viewed you</CardTitle>
              </CardHeader>
              <CardContent>
                {q.data.recruiterCompanies.length ? (
                  <ul className="divide-y divide-border">
                    {q.data.recruiterCompanies.map((c) => (
                      <li key={c.slug} className="flex items-center justify-between gap-3 py-2 text-sm">
                        <Link href={companyHref(c.slug)} className="inline-flex min-w-0 items-center gap-2 font-medium hover:underline">
                          <Building2 className="size-4 shrink-0 text-subtle-foreground" aria-hidden />
                          <span className="truncate">{c.name}</span>
                        </Link>
                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                          {c.views} view{c.views === 1 ? "" : "s"}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyState compact icon={<Building2 />} title="No recruiter views in the last 30 days" description="A complete, published profile with clear skills shows up in more searches." />
                )}
              </CardContent>
            </Card>
            <Card data-testid="dashboard-approach-summary">
              <CardHeader>
                <CardTitle className="text-base">Recruiter approaches</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <dl className="grid grid-cols-3 gap-2 text-center">
                  {(
                    [
                      ["Pending", q.data.approaches.pending],
                      ["Accepted", q.data.approaches.accepted],
                      ["Total", q.data.approaches.total],
                    ] as const
                  ).map(([label, n]) => (
                    <div key={label} className="rounded-md bg-muted/60 py-2">
                      <dt className="text-xs text-muted-foreground">{label}</dt>
                      <dd className="text-lg font-bold tabular-nums">{n}</dd>
                    </div>
                  ))}
                </dl>
                <p className="text-sm text-muted-foreground">Recruiters can only reach you through an approach. Your contact details stay private until you accept one and choose what to share.</p>
                <Button variant="outline" size="sm" onClick={() => onTab("approaches")} data-testid="dashboard-open-approaches">
                  Open approaches inbox <ArrowRight />
                </Button>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
