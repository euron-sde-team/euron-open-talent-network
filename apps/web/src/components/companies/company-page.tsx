"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Flag, Link2, MoreHorizontal, Pencil, ShieldAlert, Star } from "lucide-react";
import {
  Button,
  Card,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
} from "@open-talent/ui";
import type { Company } from "@open-talent/types";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { qk } from "@/lib/query-keys";
import { CompanyLogo, VerifiedMark, companyHref } from "@/components/common/user-bits";
import { ErrorState } from "@/components/common/states";
import { ReportDialog } from "@/components/common/report-dialog";
import { TwoColumn } from "@/components/shell/layouts";
import { CompanyEditDialog } from "./company-edit-dialog";
import { AboutTab, HomeTab, JobsTab, PeopleTab, PostsTab, websiteHref, websiteLabel, type CompanyTab } from "./company-sections";
import { TeamTab } from "./company-team";
import { followersLabel } from "./company-card";
import { FollowButton } from "./follow-button";
import { useFollowCompany } from "./use-follow-company";

const TABS: { value: CompanyTab; label: string }[] = [
  { value: "home", label: "Home" },
  { value: "about", label: "About" },
  { value: "jobs", label: "Jobs" },
  { value: "people", label: "People" },
  { value: "posts", label: "Posts" },
];

function HeaderSkeleton() {
  return (
    <Card className="overflow-hidden" aria-hidden>
      <Skeleton className="h-32 rounded-none sm:h-44" />
      <div className="space-y-3 p-4 sm:p-6">
        <Skeleton className="-mt-14 size-24 rounded-lg border-4 border-card" />
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/3" />
      </div>
    </Card>
  );
}

function CompanyHeader({ company, onEdit }: { company: Company; onEdit: () => void }) {
  const { status } = useAuth();
  const follow = useFollowCompany(company.slug, company.name, { following: company.viewer.following, followerCount: company.followerCount });
  const [reportOpen, setReportOpen] = useState(false);
  const suspended = company.status === "SUSPENDED";
  const site = websiteHref(company);
  const share = async () => {
    const url = `${window.location.origin}${companyHref(company.slug)}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success({ title: "Link copied" });
    } catch {
      toast.error({ title: "Could not copy the link", description: url });
    }
  };
  const facts = [company.industry, company.headquarters, company.sizeBand ? `${company.sizeBand} employees` : null, company.foundedYear ? `Founded ${company.foundedYear}` : null].filter(Boolean);
  return (
    <Card className="overflow-hidden" data-testid="company-header">
      <div className="relative h-32 bg-gradient-to-br from-primary-soft to-muted sm:h-44">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {company.coverUrl ? <img src={company.coverUrl} alt="" className="absolute inset-0 size-full object-cover" /> : null}
      </div>
      <div className="px-4 pb-4 sm:px-6 sm:pb-5">
        <div className="-mt-12 flex items-end justify-between gap-3 sm:-mt-14">
          <CompanyLogo company={company} size="xl" className="size-24 rounded-lg border-4 border-card bg-card shadow-sm sm:size-28" />
          {company.viewer.canManage && !suspended ? (
            <Button variant="outline" size="sm" onClick={onEdit} className="mb-1" data-testid="company-edit">
              <Pencil aria-hidden />
              Edit page
            </Button>
          ) : null}
        </div>
        <div className="mt-3 min-w-0">
          <h1 className="flex flex-wrap items-center gap-1.5 text-2xl font-bold leading-tight tracking-tight">
            <span className="break-words">{company.name}</span>
            <VerifiedMark status={company.status} className="[&_svg]:size-5" />
          </h1>
          {company.tagline ? <p className="mt-1 text-base">{company.tagline}</p> : null}
          {facts.length ? <p className="mt-1 text-sm text-muted-foreground">{facts.join(", ")}</p> : null}
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-subtle-foreground">
            <span data-testid="company-followers">{followersLabel(follow.followerCount)}</span>
            {company.openJobCount ? <span>{company.openJobCount === 1 ? "1 open job" : `${company.openJobCount} open jobs`}</span> : null}
            {company.rating.count > 0 && company.rating.average != null ? (
              <span className="inline-flex items-center gap-1" title="From people who worked with this team">
                <Star className="size-3.5 fill-current text-warning" aria-hidden />
                <span className="font-semibold text-foreground">{company.rating.average.toFixed(1)}</span>
                <span>({company.rating.count === 1 ? "1 rating" : `${company.rating.count} ratings`})</span>
              </span>
            ) : null}
          </p>
        </div>
        {!suspended ? (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {!company.viewer.role ? <FollowButton following={follow.following} onToggle={follow.toggle} pending={follow.pending} name={company.name} size="md" /> : null}
            {site ? (
              <Button asChild variant="outline">
                <a href={site} target="_blank" rel="noopener noreferrer nofollow" data-testid="company-website">
                  Visit website
                  <ExternalLink aria-hidden />
                  <span className="sr-only">({websiteLabel(site)}, opens in a new tab)</span>
                </a>
              </Button>
            ) : null}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton label="More company actions" variant="outline" data-testid="company-more">
                  <MoreHorizontal />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onSelect={() => void share()}>
                  <Link2 className="size-4" aria-hidden />
                  Copy link to page
                </DropdownMenuItem>
                {status === "signed-in" && !company.viewer.role ? (
                  <DropdownMenuItem onSelect={() => setReportOpen(true)} data-testid="company-report">
                    <Flag className="size-4" aria-hidden />
                    Report company
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : null}
      </div>
      {reportOpen ? <ReportDialog open={reportOpen} onOpenChange={setReportOpen} targetType="COMPANY" targetId={company.id} /> : null}
    </Card>
  );
}

/** /company/[slug]: header, then Home, About, Jobs, People, Posts (and Team for page admins). */
export function CompanyPage({ slug }: { slug: string }) {
  const sp = useSearchParams();
  const query = useQuery({ queryKey: qk.company(slug), queryFn: () => api().companies.get(slug) });
  const company = query.data;
  const [editOpen, setEditOpen] = useState(false);
  const tabs = company?.viewer.canManage ? [...TABS, { value: "team" as const, label: "Team" }] : TABS;
  const requested = sp.get("tab") as CompanyTab | null;
  const tab: CompanyTab = requested && tabs.some((t) => t.value === requested) ? requested : "home";

  useEffect(() => {
    if (company) document.title = `${company.name}`;
  }, [company]);

  const setTab = (t: CompanyTab) => {
    const next = new URLSearchParams(sp.toString());
    if (t === "home") next.delete("tab");
    else next.set("tab", t);
    const qs = next.toString();
    window.history.replaceState(null, "", `${companyHref(slug)}${qs ? `?${qs}` : ""}`);
  };

  return (
    <TwoColumn max="max-w-[900px]">
      {query.isPending ? (
        <HeaderSkeleton />
      ) : query.isError || !company ? (
        <Card>
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        </Card>
      ) : (
        <div className="space-y-4" data-testid="company-page" data-company-slug={company.slug}>
          {company.status === "SUSPENDED" ? (
            <div role="status" className="flex gap-3 rounded-lg border border-danger/30 bg-danger-soft p-4 text-sm text-danger-soft-foreground" data-testid="company-suspended">
              <ShieldAlert className="mt-0.5 size-5 shrink-0" aria-hidden />
              <div>
                <p className="font-semibold">This company page is suspended</p>
                <p className="mt-0.5">Only its team and network staff can see it. Its jobs and posts are hidden from everyone else, and editing is paused while the network reviews it.</p>
              </div>
            </div>
          ) : null}
          <CompanyHeader company={company} onEdit={() => setEditOpen(true)} />
          <Tabs value={tab} onValueChange={(v) => setTab(v as CompanyTab)}>
            <Card className="px-2">
              <TabsList className="border-b-0" aria-label="Company page sections">
                {tabs.map((t) => (
                  <TabsTrigger key={t.value} value={t.value} data-testid={`company-tab-${t.value}`}>
                    {t.label}
                    {t.value === "jobs" && company.openJobCount ? <span className="text-xs font-normal text-subtle-foreground tabular-nums">{company.openJobCount}</span> : null}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Card>
            <div className="mt-4">
              <TabsContent value="home">
                <HomeTab company={company} onTab={setTab} />
              </TabsContent>
              <TabsContent value="about">
                <AboutTab company={company} />
              </TabsContent>
              <TabsContent value="jobs">
                <JobsTab company={company} />
              </TabsContent>
              <TabsContent value="people">
                <PeopleTab company={company} />
              </TabsContent>
              <TabsContent value="posts">
                <PostsTab company={company} />
              </TabsContent>
              {company.viewer.canManage ? (
                <TabsContent value="team">
                  <TeamTab company={company} />
                </TabsContent>
              ) : null}
            </div>
          </Tabs>
          {company.viewer.canManage && company.status !== "SUSPENDED" ? <CompanyEditDialog company={company} open={editOpen} onOpenChange={setEditOpen} /> : null}
        </div>
      )}
    </TwoColumn>
  );
}
