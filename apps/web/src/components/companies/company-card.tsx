"use client";

import Link from "next/link";
import { Briefcase, MapPin, Users } from "lucide-react";
import { Button, Card, Skeleton } from "@open-talent/ui";
import type { CompanySummary } from "@open-talent/types";
import { useAuth } from "@/lib/auth";
import { compactNumber } from "@/lib/time";
import { CompanyLogo, VerifiedMark, companyHref } from "@/components/common/user-bits";
import { FollowButton } from "./follow-button";
import { useFollowCompany } from "./use-follow-company";

export const followersLabel = (n: number) => (n === 1 ? "1 follower" : `${compactNumber(n)} followers`);

export function CompanyCard({ company }: { company: CompanySummary }) {
  const { user } = useAuth();
  const follow = useFollowCompany(company.slug, company.name, { following: company.viewerFollowing, followerCount: company.followerCount });
  // Same rule as the full page's `viewer.role`: an ACTIVE recruiter on this company's team.
  const ownCompany = user?.recruiter?.status === "ACTIVE" && user.recruiter.company.id === company.id;
  return (
    <Card className="flex flex-col p-4" data-testid="company-card" data-company-slug={company.slug}>
      <div className="flex items-start gap-3">
        <Link href={companyHref(company.slug)} tabIndex={-1} aria-hidden className="shrink-0">
          <CompanyLogo company={company} size="lg" />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="flex min-w-0 items-center gap-1">
            <Link href={companyHref(company.slug)} className="truncate font-semibold hover:underline">
              {company.name}
            </Link>
            <VerifiedMark status={company.status} className="[&_svg]:size-3.5" />
          </p>
          <p className="truncate text-sm text-muted-foreground">{[company.industry, company.sizeBand ? `${company.sizeBand} employees` : null].filter(Boolean).join(", ") || "Company"}</p>
        </div>
      </div>
      {company.tagline ? <p className="mt-3 line-clamp-2 text-sm">{company.tagline}</p> : null}
      <ul className="mt-3 space-y-1 text-xs text-subtle-foreground">
        {company.headquarters ? (
          <li className="flex items-center gap-1.5">
            <MapPin className="size-3.5" aria-hidden />
            {company.headquarters}
          </li>
        ) : null}
        <li className="flex items-center gap-1.5">
          <Users className="size-3.5" aria-hidden />
          {followersLabel(follow.followerCount)}
        </li>
        <li className="flex items-center gap-1.5">
          <Briefcase className="size-3.5" aria-hidden />
          {company.openJobCount ? (
            <Link href={`${companyHref(company.slug)}?tab=jobs`} className="font-semibold text-link hover:underline">
              {company.openJobCount === 1 ? "1 open job" : `${company.openJobCount} open jobs`}
            </Link>
          ) : (
            "No open jobs"
          )}
        </li>
      </ul>
      <div className="mt-auto pt-4">
        {ownCompany ? (
          <Button asChild variant="outline" size="sm" block>
            <Link href={companyHref(company.slug)}>Your company page</Link>
          </Button>
        ) : (
          <FollowButton following={follow.following} onToggle={follow.toggle} pending={follow.pending} name={company.name} block />
        )}
      </div>
    </Card>
  );
}

export function CompanyCardSkeleton() {
  return (
    <Card className="space-y-3 p-4" aria-hidden>
      <div className="flex gap-3">
        <Skeleton className="size-12 rounded-md" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      </div>
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-1/2" />
      <Skeleton className="h-8 w-full" />
    </Card>
  );
}
