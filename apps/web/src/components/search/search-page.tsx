"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, BriefcaseBusiness, Building2, Search, SearchX, UsersRound } from "lucide-react";
import { Card, EmptyState, Skeleton, Tabs, TabsList, TabsTrigger } from "@open-talent/ui";
import type { CompanySummary, Job, Page } from "@open-talent/types";
import { api } from "@/lib/api";
import { usePagedList } from "@/lib/hooks/queries";
import { qk } from "@/lib/query-keys";
import { ErrorState, LoadMore } from "@/components/common/states";
import { TalentCardView } from "@/components/talent/talent-card";
import { fetchPeoplePage, type TalentRow } from "@/components/talent/talent-query";
import { CompanyResult, JobResult } from "./result-rows";

const TABS = [
  { id: "all", label: "All" },
  { id: "people", label: "People" },
  { id: "jobs", label: "Jobs" },
  { id: "companies", label: "Companies" },
] as const;
type Tab = (typeof TABS)[number]["id"];

function RowsSkeleton({ n = 3 }: { n?: number }) {
  return (
    <div className="divide-y divide-border">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="flex gap-3 px-4 py-3">
          <Skeleton className="size-12 rounded-md" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

function Section({ title, icon, href, seeAll, children, testId }: { title: string; icon: React.ReactNode; href: string; seeAll: string; children: React.ReactNode; testId: string }) {
  return (
    <Card className="overflow-hidden" data-testid={testId}>
      <h2 className="flex items-center gap-2 px-4 pb-1 pt-4 text-xl font-semibold [&_svg]:size-5 [&_svg]:text-muted-foreground">
        {icon} {title}
      </h2>
      <div className="divide-y divide-border">{children}</div>
      <Link href={href} className="flex items-center justify-center gap-1 border-t border-border px-4 py-3 text-sm font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
        {seeAll} <ArrowRight className="size-4" />
      </Link>
    </Card>
  );
}

function AllResults({ q, onTab }: { q: string; onTab: (t: Tab) => void }) {
  const all = useQuery({ queryKey: qk.searchAll(q), queryFn: ({ signal }) => api().search.all(q, signal), staleTime: 60_000 });
  if (all.isPending)
    return (
      <div className="space-y-4">
        {Array.from({ length: 3 }, (_, i) => (
          <Card key={i} className="py-2">
            <RowsSkeleton />
          </Card>
        ))}
      </div>
    );
  if (all.isError)
    return (
      <Card>
        <ErrorState error={all.error} onRetry={() => void all.refetch()} />
      </Card>
    );
  const { people, jobs, companies } = all.data;
  if (!people.length && !jobs.length && !companies.length) return <NoResults q={q} />;
  const enc = encodeURIComponent(q);
  return (
    <div className="space-y-4">
      {people.length ? (
        <Section title="People" icon={<UsersRound />} href={`/talent?q=${enc}`} seeAll="See all people results" testId="search-section-people">
          {people.slice(0, 3).map((c) => (
            <TalentCardView key={c.user.id} card={c} layout="list" />
          ))}
        </Section>
      ) : null}
      {jobs.length ? (
        <Section title="Jobs" icon={<BriefcaseBusiness />} href={`/jobs?q=${enc}`} seeAll="See all job results" testId="search-section-jobs">
          {jobs.slice(0, 3).map((j) => (
            <JobResult key={j.id} job={j} />
          ))}
        </Section>
      ) : null}
      {companies.length ? (
        <Section title="Companies" icon={<Building2 />} href={`/companies?q=${enc}`} seeAll="See all company results" testId="search-section-companies">
          {companies.slice(0, 3).map((c) => (
            <CompanyResult key={c.id} company={c} />
          ))}
        </Section>
      ) : null}
      <p className="px-1 text-xs text-subtle-foreground">
        Looking for something narrower?{" "}
        <button type="button" className="font-medium text-link hover:underline" onClick={() => onTab("people")}>
          Filter people
        </button>
        ,{" "}
        <button type="button" className="font-medium text-link hover:underline" onClick={() => onTab("jobs")}>
          jobs
        </button>{" "}
        or{" "}
        <button type="button" className="font-medium text-link hover:underline" onClick={() => onTab("companies")}>
          companies
        </button>
        .
      </p>
    </div>
  );
}

function PagedResults<T extends { id: string }>({
  queryKey,
  fetchPage,
  render,
  q,
  divided = true,
}: {
  queryKey: readonly unknown[];
  fetchPage: (cursor: string | undefined) => Promise<Page<T>>;
  render: (item: T) => React.ReactNode;
  q: string;
  divided?: boolean;
}) {
  const list = usePagedList<T>({ queryKey, fetchPage, staleTime: 60_000 });
  if (list.isPending)
    return (
      <Card className="py-2">
        <RowsSkeleton n={6} />
      </Card>
    );
  if (list.isError)
    return (
      <Card>
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      </Card>
    );
  if (!list.items.length) return <NoResults q={q} />;
  return (
    <Card className="overflow-hidden">
      <div className={divided ? "divide-y divide-border" : undefined}>{list.items.map(render)}</div>
      <LoadMore sentinelRef={list.sentinelRef} loading={list.isFetchingNextPage} hasMore={!!list.hasNextPage} endLabel={list.items.length > 10 ? "No more results." : undefined} />
    </Card>
  );
}

function NoResults({ q }: { q: string }) {
  const enc = encodeURIComponent(q);
  return (
    <Card data-testid="search-empty">
      <EmptyState
        icon={<SearchX />}
        title={`No results for "${q}"`}
        description="Check the spelling, try a shorter or more general term, or search by a single skill or job title."
        action={
          <div className="flex flex-wrap justify-center gap-x-4 gap-y-2 text-sm font-medium">
            <Link href={`/talent?skills=${enc}`} className="text-link hover:underline">
              People with the skill &quot;{q}&quot;
            </Link>
            <Link href="/jobs" className="text-link hover:underline">
              Browse all jobs
            </Link>
            <Link href="/companies" className="text-link hover:underline">
              Browse companies
            </Link>
          </div>
        }
      />
    </Card>
  );
}

function StartSearching() {
  const facets = useQuery({ queryKey: qk.facets, queryFn: () => api().search.facets(), staleTime: 10 * 60_000, meta: { silent: true } });
  const skills = (facets.data?.skills ?? []).slice(0, 12);
  return (
    <Card>
      <EmptyState
        icon={<Search />}
        title="Search people, jobs and companies"
        description="Type a name, job title, company or skill in the search box at the top of the page."
        action={
          skills.length ? (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-subtle-foreground">Popular skills</p>
              <ul className="flex max-w-md flex-wrap justify-center gap-2">
                {skills.map((s) => (
                  <li key={s.name}>
                    <Link href={`/search?q=${encodeURIComponent(s.name)}`} className="inline-flex h-7 items-center rounded-full border border-border px-3 text-xs font-medium text-foreground hover:bg-muted">
                      {s.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : undefined
        }
      />
    </Card>
  );
}

export function SearchPage() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const q = (params?.get("q") ?? "").trim().slice(0, 100);
  const raw = params?.get("tab");
  const tab: Tab = TABS.some((t) => t.id === raw) ? (raw as Tab) : "all";

  const setTab = (t: Tab) => {
    const p = new URLSearchParams(params?.toString());
    if (t === "all") p.delete("tab");
    else p.set("tab", t);
    router.replace(`${pathname}?${p.toString()}`, { scroll: false });
  };

  return (
    <main id="main" className="mx-auto max-w-[760px] px-4 py-4" data-testid="search-page">
      <h1 className="mb-3 text-2xl font-bold tracking-tight">{q ? <>Results for &quot;{q}&quot;</> : "Search"}</h1>
      {!q ? (
        <StartSearching />
      ) : (
        <>
          <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
            <TabsList className="mb-4 rounded-t-lg border-x border-t bg-card px-2">
              {TABS.map((t) => (
                <TabsTrigger key={t.id} value={t.id} data-testid={`search-tab-${t.id}`}>
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          {tab === "all" ? (
            <AllResults q={q} onTab={setTab} />
          ) : tab === "people" ? (
            <PagedResults<TalentRow> key="people" q={q} queryKey={qk.people({ q })} fetchPage={(c) => fetchPeoplePage({ q }, c)} render={(c) => <TalentCardView key={c.id} card={c} layout="list" />} />
          ) : tab === "jobs" ? (
            <PagedResults<Job> key="jobs" q={q} queryKey={qk.jobs({ q, scope: "search" })} fetchPage={(cursor) => api().jobs.search({ q, cursor, sort: "relevance" })} render={(j) => <JobResult key={j.id} job={j} />} />
          ) : (
            <PagedResults<CompanySummary> key="companies" q={q} queryKey={qk.companies({ q, scope: "search" })} fetchPage={(cursor) => api().companies.list({ q, cursor })} render={(c) => <CompanyResult key={c.id} company={c} />} />
          )}
        </>
      )}
    </main>
  );
}
