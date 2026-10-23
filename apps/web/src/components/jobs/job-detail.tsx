"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Bookmark, BookmarkCheck, BriefcaseBusiness, CalendarClock, CheckCircle2, Flag, Link2, MapPin, MoreHorizontal, Users, Wallet } from "lucide-react";
import { Button, Card, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, IconButton, Skeleton, SkeletonText, toast } from "@open-talent/ui";
import type { Job } from "@open-talent/types";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { qk } from "@/lib/query-keys";
import { compactNumber, fullTimestamp } from "@/lib/time";
import { CompanyLink, CompanyLogo, PersonRow, VerifiedMark, companyHref } from "@/components/common/user-bits";
import { ErrorState } from "@/components/common/states";
import { ReportDialog } from "@/components/common/report-dialog";
import { TimeAgo } from "@/components/common/time-ago";
import { FollowButton } from "@/components/companies/follow-button";
import { useFollowCompany } from "@/components/companies/use-follow-company";
import { EasyApplyDialog } from "./easy-apply-dialog";
import { findCachedJob, useSaveJob } from "./job-cache";
import { EMPLOYMENT_LABEL, SENIORITY_LABEL, formatPlace, formatSalary } from "./job-format";
import { JobDescription, MatchChip, SectionCard, SkillChips, StageBadge, isAccepting } from "./job-bits";
import { jobHref } from "./job-query";

function Fact({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5 text-sm">
      <span className="mt-0.5 text-subtle-foreground [&_svg]:size-4" aria-hidden>
        {icon}
      </span>
      <span className="min-w-0">{children}</span>
    </li>
  );
}

function ApplyArea({ job, onApply }: { job: Job; onApply: () => void }) {
  const { status } = useAuth();
  const app = job.viewer.application;
  if (app) {
    return (
      <Link
        href={`/jobs/applications?highlight=${encodeURIComponent(app.id)}`}
        className="inline-flex h-9 items-center gap-2 rounded-md bg-success-soft px-4 text-sm font-semibold text-success-soft-foreground hover:opacity-90"
        data-testid="job-applied"
      >
        <CheckCircle2 className="size-4" aria-hidden />
        <span>
          Applied <TimeAgo value={app.appliedAt} />
        </span>
        <StageBadge stage={app.stage} />
      </Link>
    );
  }
  if (job.viewer.canManage) return <p className="text-sm text-muted-foreground">You are on the hiring team for this job.</p>;
  if (!isAccepting(job)) return <p className="rounded-md bg-muted px-3 py-2 text-sm font-medium text-muted-foreground">No longer accepting applications</p>;
  if (status !== "signed-in") {
    return (
      <Button asChild data-testid="job-sign-in-to-apply">
        <Link href={`/login?next=${encodeURIComponent(jobHref(job.id))}`}>Sign in to apply</Link>
      </Button>
    );
  }
  return (
    <Button onClick={onApply} data-testid="job-easy-apply">
      <BriefcaseBusiness aria-hidden />
      Easy Apply
    </Button>
  );
}

function AboutCompany({ slug }: { slug: string }) {
  const { data: company, isPending } = useQuery({ queryKey: qk.company(slug), queryFn: () => api().companies.get(slug), meta: { silent: true } });
  const follow = useFollowCompany(slug, company?.name ?? "", company ? { following: company.viewer.following, followerCount: company.followerCount } : undefined);
  if (isPending) {
    return (
      <Card className="space-y-3 p-5">
        <Skeleton className="h-5 w-40" />
        <SkeletonText lines={3} />
      </Card>
    );
  }
  if (!company) return null;
  return (
    <SectionCard title="About the company" testId="job-about-company">
      <div className="flex items-start gap-3">
        <Link href={companyHref(company.slug)} tabIndex={-1} aria-hidden>
          <CompanyLogo company={company} size="lg" />
        </Link>
        <div className="min-w-0 flex-1">
          <CompanyLink company={company} className="text-base" />
          <p className="text-sm text-muted-foreground">{[company.industry, company.sizeBand ? `${company.sizeBand} employees` : null].filter(Boolean).join(", ")}</p>
          <p className="text-sm text-subtle-foreground">{follow.followerCount === 1 ? "1 follower" : `${compactNumber(follow.followerCount)} followers`}</p>
        </div>
        {company.status !== "SUSPENDED" && !company.viewer.role ? <FollowButton following={follow.following} onToggle={follow.toggle} pending={follow.pending} name={company.name} /> : null}
      </div>
      {company.about ? <p className="mt-3 line-clamp-4 whitespace-pre-line text-sm leading-relaxed">{company.about}</p> : null}
      <Link href={companyHref(company.slug)} className="mt-3 inline-block text-sm font-semibold text-link hover:underline">
        See the company page
      </Link>
    </SectionCard>
  );
}

function HowYouMatch({ job }: { job: Job }) {
  const { status } = useAuth();
  if (status !== "signed-in" || job.viewer.matchScore == null || !job.skills.length) return null;
  const matched = new Set(job.viewer.matchedSkills.map((s) => s.toLowerCase()));
  const missing = job.skills.filter((s) => !matched.has(s.toLowerCase()));
  return (
    <SectionCard title="How you match" testId="job-match">
      <div className="flex items-center gap-3">
        <div className="relative size-14 shrink-0" aria-hidden>
          <svg viewBox="0 0 36 36" className="size-14 -rotate-90">
            <circle cx="18" cy="18" r="15.5" fill="none" strokeWidth="3.5" className="stroke-muted" />
            <circle cx="18" cy="18" r="15.5" fill="none" strokeWidth="3.5" strokeLinecap="round" className="stroke-primary" strokeDasharray={`${(job.viewer.matchScore / 100) * 97.4} 97.4`} />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-sm font-bold tabular-nums">{job.viewer.matchScore}%</span>
        </div>
        <p className="text-sm text-muted-foreground">
          {job.viewer.matchedSkills.length
            ? `Your profile lists ${job.viewer.matchedSkills.length} of the ${job.skills.length} skills this job asks for.`
            : `Your profile does not list any of the ${job.skills.length} skills this job asks for yet.`}
        </p>
      </div>
      {job.viewer.matchedSkills.length ? (
        <div className="mt-4">
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-subtle-foreground">On your profile</p>
          <SkillChips skills={job.viewer.matchedSkills} highlight={matched} />
        </div>
      ) : null}
      {missing.length ? (
        <div className="mt-4">
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-subtle-foreground">Not on your profile</p>
          <SkillChips skills={missing} />
        </div>
      ) : null}
    </SectionCard>
  );
}

export function JobDetailSkeleton() {
  return (
    <Card className="space-y-4 p-5" aria-hidden>
      <div className="flex gap-3">
        <Skeleton className="size-14 rounded-md" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-4 w-1/3" />
        </div>
      </div>
      <Skeleton className="h-9 w-40" />
      <SkeletonText lines={6} />
    </Card>
  );
}

/** The selected job: header, actions, match, description, skills and the company. */
export function JobDetail({ jobId, onBack, autoApply, onAutoApplyHandled }: { jobId: string; onBack?: () => void; autoApply?: boolean; onAutoApplyHandled?: () => void }) {
  const qc = useQueryClient();
  const { status } = useAuth();
  const query = useQuery({ queryKey: qk.job(jobId), queryFn: () => api().jobs.get(jobId), placeholderData: () => findCachedJob(qc, jobId) });
  const job = query.data;
  const save = useSaveJob();
  const [applyOpen, setApplyOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  useEffect(() => {
    if (!autoApply || !job || query.isPlaceholderData || status === "loading") return;
    if (!job.viewer.application && !job.viewer.canManage && isAccepting(job) && status === "signed-in") setApplyOpen(true);
    onAutoApplyHandled?.();
  }, [autoApply, job, query.isPlaceholderData, status, onAutoApplyHandled]);

  const back = onBack ? (
    <Button variant="ghost" size="sm" onClick={onBack} className="mb-2 md:hidden" data-testid="job-back">
      <ArrowLeft aria-hidden />
      Back to results
    </Button>
  ) : null;

  if (query.isPending) {
    return (
      <div>
        {back}
        <JobDetailSkeleton />
      </div>
    );
  }
  if (query.isError || !job) {
    return (
      <div>
        {back}
        <Card>
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        </Card>
      </div>
    );
  }

  const salary = formatSalary(job.salary);
  const share = async () => {
    const url = `${window.location.origin}${jobHref(job.id)}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success({ title: "Link copied", description: "Anyone with the link can see this job." });
    } catch {
      toast.error({ title: "Could not copy the link", description: url });
    }
  };

  return (
    <div className="space-y-4" data-testid="job-detail" data-job-id={job.id}>
      {back}
      <Card className="p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <Link href={companyHref(job.company.slug)} tabIndex={-1} aria-hidden className="shrink-0">
            <CompanyLogo company={job.company} size="lg" className="sm:size-14" />
          </Link>
          <div className="min-w-0 flex-1">
            <p className="flex min-w-0 items-center gap-1 text-sm">
              <Link href={companyHref(job.company.slug)} className="truncate font-semibold hover:underline">
                {job.company.name}
              </Link>
              <VerifiedMark status={job.company.status} className="[&_svg]:size-3.5" />
            </p>
            <h1 className="mt-0.5 text-xl font-bold leading-tight tracking-tight sm:text-2xl">{job.title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {formatPlace(job.location, job.workplaceType)}
              {job.openedAt ? (
                <>
                  {", posted "}
                  <TimeAgo value={job.openedAt} />
                </>
              ) : null}
              {job.applicationCount > 0 ? `, ${job.applicationCount === 1 ? "1 applicant" : `${compactNumber(job.applicationCount)} applicants`}` : null}
            </p>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton label="More job actions" size="sm" data-testid="job-more">
                <MoreHorizontal />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => void share()} data-testid="job-share">
                <Link2 className="size-4" aria-hidden />
                Copy link
              </DropdownMenuItem>
              {status === "signed-in" && !job.viewer.canManage ? (
                <DropdownMenuItem onSelect={() => setReportOpen(true)} data-testid="job-report">
                  <Flag className="size-4" aria-hidden />
                  Report job
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <ul className="mt-4 grid gap-2 sm:grid-cols-2">
          <Fact icon={<BriefcaseBusiness />}>{[EMPLOYMENT_LABEL[job.employmentType], job.seniority ? SENIORITY_LABEL[job.seniority] : null].filter(Boolean).join(", ")}</Fact>
          <Fact icon={<MapPin />}>{formatPlace(job.location, job.workplaceType)}</Fact>
          {salary ? <Fact icon={<Wallet />}>{salary}</Fact> : null}
          <Fact icon={<Users />}>{job.openings === 1 ? "1 opening" : `${job.openings} openings`}</Fact>
          {job.closesAt ? (
            <Fact icon={<CalendarClock />}>
              <span title={fullTimestamp(job.closesAt)}>
                {new Date(job.closesAt).getTime() > Date.now() ? "Applications close " : "Applications closed "}
                <TimeAgo value={job.closesAt} />
              </span>
            </Fact>
          ) : null}
        </ul>

        {status === "signed-in" && !job.viewer.application && job.viewer.matchScore != null && job.viewer.matchScore > 0 ? <MatchChip score={job.viewer.matchScore} className="mt-3" /> : null}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <ApplyArea job={job} onApply={() => setApplyOpen(true)} />
          {!job.viewer.canManage ? (
            <Button variant="outline" onClick={() => save.toggle(job)} aria-pressed={job.viewer.saved} data-testid="job-save">
              {job.viewer.saved ? <BookmarkCheck aria-hidden className="text-primary" /> : <Bookmark aria-hidden />}
              {job.viewer.saved ? "Saved" : "Save"}
            </Button>
          ) : null}
          <Button variant="ghost" onClick={() => void share()} className="max-sm:hidden">
            <Link2 aria-hidden />
            Share
          </Button>
        </div>

        {job.postedBy ? (
          <div className="mt-4 border-t border-border pt-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-subtle-foreground">Posted by</p>
            <PersonRow user={job.postedBy} />
          </div>
        ) : null}
      </Card>

      <HowYouMatch job={job} />

      <SectionCard title="About the job">
        <JobDescription text={job.description} />
        {job.skills.length ? (
          <div className="mt-5 border-t border-border pt-4">
            <h3 className="mb-2 font-semibold">Skills</h3>
            <SkillChips skills={job.skills} highlight={status === "signed-in" ? new Set(job.viewer.matchedSkills.map((s) => s.toLowerCase())) : undefined} />
          </div>
        ) : null}
      </SectionCard>

      <AboutCompany slug={job.company.slug} />

      {status === "signed-in" ? <EasyApplyDialog job={job} open={applyOpen} onOpenChange={setApplyOpen} /> : null}
      {reportOpen ? <ReportDialog open={reportOpen} onOpenChange={setReportOpen} targetType="JOB" targetId={job.id} /> : null}
    </div>
  );
}
