"use client";

import Link from "next/link";
import type { CompanySummary, Job } from "@open-talent/types";
import { Badge } from "@open-talent/ui";
import { compactNumber } from "@/lib/time";
import { CompanyLogo, VerifiedMark, companyHref } from "@/components/common/user-bits";
import { TimeAgo } from "@/components/common/time-ago";
import { EMPLOYMENT_LABEL, formatPlace, formatSalary } from "@/components/jobs/job-format";

export function JobResult({ job }: { job: Job }) {
  const salary = formatSalary(job.salary);
  const applied = job.viewer.application;
  return (
    <Link href={`/jobs?job=${encodeURIComponent(job.id)}`} className="flex gap-3 px-4 py-3 transition-colors hover:bg-muted" data-testid="search-job">
      <CompanyLogo company={job.company} size="lg" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-link">{job.title}</p>
        <p className="flex items-center gap-1 text-sm text-foreground">
          <span className="truncate">{job.company.name}</span>
          <VerifiedMark status={job.company.status} className="[&_svg]:size-3.5" />
        </p>
        <p className="text-sm text-muted-foreground">
          {formatPlace(job.location, job.workplaceType)}, {EMPLOYMENT_LABEL[job.employmentType]}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-subtle-foreground">
          {salary ? <span className="font-medium text-muted-foreground">{salary}</span> : null}
          {job.viewer.matchScore != null && job.viewer.matchScore > 0 ? <Badge tone="success">{job.viewer.matchScore}% skills match</Badge> : null}
          {applied ? <Badge tone="primary">Applied</Badge> : null}
          {job.openedAt ? (
            <span>
              Posted <TimeAgo value={job.openedAt} />
            </span>
          ) : null}
        </div>
      </div>
    </Link>
  );
}

export function CompanyResult({ company }: { company: CompanySummary }) {
  const meta = [company.industry, company.headquarters, company.sizeBand ? `${company.sizeBand} employees` : null].filter(Boolean).join(", ");
  return (
    <Link href={companyHref(company.slug)} className="flex gap-3 px-4 py-3 transition-colors hover:bg-muted" data-testid="search-company">
      <CompanyLogo company={company} size="lg" />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1 font-semibold text-foreground">
          <span className="truncate">{company.name}</span>
          <VerifiedMark status={company.status} />
        </p>
        {company.tagline ? <p className="line-clamp-1 text-sm text-muted-foreground">{company.tagline}</p> : null}
        {meta ? <p className="text-xs text-subtle-foreground">{meta}</p> : null}
        <p className="mt-0.5 text-xs text-subtle-foreground">
          {compactNumber(company.followerCount)} follower{company.followerCount === 1 ? "" : "s"}
          {company.openJobCount ? `, ${compactNumber(company.openJobCount)} open job${company.openJobCount === 1 ? "" : "s"}` : ""}
        </p>
      </div>
    </Link>
  );
}
