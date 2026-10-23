"use client";

import { Fragment } from "react";
import Link from "next/link";
import { Bookmark, BookmarkCheck, CheckCircle2, Sparkles } from "lucide-react";
import { Badge, Card, IconButton, Skeleton, cn } from "@open-talent/ui";
import type { ApplicationStage, Job } from "@open-talent/types";
import { CompanyLogo, VerifiedMark } from "@/components/common/user-bits";
import { TimeAgo } from "@/components/common/time-ago";
import { EMPLOYMENT_LABEL, formatPlace, formatSalary } from "./job-format";

export const STAGE_LABEL: Record<ApplicationStage, string> = {
  APPLIED: "Applied",
  SCREENING: "Screening",
  INTERVIEW: "Interview",
  OFFER: "Offer",
  HIRED: "Hired",
  REJECTED: "Not selected",
  WITHDRAWN: "Withdrawn",
};

const STAGE_TONE: Record<ApplicationStage, "primary" | "success" | "warning" | "danger" | "neutral"> = {
  APPLIED: "primary",
  SCREENING: "primary",
  INTERVIEW: "warning",
  OFFER: "success",
  HIRED: "success",
  REJECTED: "danger",
  WITHDRAWN: "neutral",
};

export const OPEN_STAGES: readonly ApplicationStage[] = ["APPLIED", "SCREENING", "INTERVIEW", "OFFER"];

export function StageBadge({ stage, size = "sm" }: { stage: ApplicationStage; size?: "sm" | "md" }) {
  return (
    <Badge tone={STAGE_TONE[stage]} size={size} data-testid="stage-badge" data-stage={stage}>
      {STAGE_LABEL[stage]}
    </Badge>
  );
}

export function MatchChip({ score, className }: { score: number; className?: string }) {
  const tone = score >= 70 ? "success" : score >= 40 ? "primary" : "neutral";
  return (
    <Badge tone={tone} className={className} data-testid="match-chip">
      <Sparkles aria-hidden />
      {score}% skills match
    </Badge>
  );
}

/** True when the job takes applications right now. */
export function isAccepting(job: Pick<Job, "status" | "closesAt">, now = Date.now()): boolean {
  return job.status === "OPEN" && (!job.closesAt || new Date(job.closesAt).getTime() > now);
}

/** One row in a job list: logo, title, company, place, pay, state, posted time. */
export function JobCard({
  job,
  selected,
  onSelect,
  href,
  signedIn,
  onToggleSave,
}: {
  job: Job;
  selected?: boolean;
  onSelect?: () => void;
  href?: string;
  signedIn: boolean;
  onToggleSave?: () => void;
}) {
  const salary = formatSalary(job.salary);
  const app = job.viewer.application;
  const content = (
    <div className="flex gap-3">
      <CompanyLogo company={job.company} size="lg" className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <p className={cn("line-clamp-2 font-semibold leading-snug", selected ? "text-foreground" : "text-link")}>{job.title}</p>
        <p className="mt-0.5 flex min-w-0 items-center gap-1 text-sm text-foreground">
          <span className="truncate">{job.company.name}</span>
          <VerifiedMark status={job.company.status} className="[&_svg]:size-3.5" />
        </p>
        <p className="truncate text-sm text-muted-foreground">{formatPlace(job.location, job.workplaceType)}</p>
        {salary ? <p className="truncate text-sm text-muted-foreground">{salary}</p> : null}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-subtle-foreground">
          {app ? (
            <span className="inline-flex items-center gap-1 font-semibold text-success-soft-foreground">
              <CheckCircle2 className="size-3.5" aria-hidden />
              Applied
            </span>
          ) : null}
          {signedIn && !app && job.viewer.matchScore != null && job.viewer.matchScore > 0 ? <MatchChip score={job.viewer.matchScore} /> : null}
          {job.openedAt ? <TimeAgo value={job.openedAt} /> : null}
          {job.applicationCount > 0 ? <span>{job.applicationCount === 1 ? "1 applicant" : `${job.applicationCount} applicants`}</span> : null}
          {job.status !== "OPEN" ? <Badge tone="outline">No longer accepting</Badge> : null}
        </div>
      </div>
    </div>
  );
  return (
    <div
      className={cn("group relative border-b border-border transition-colors last:border-b-0", selected ? "bg-primary/10" : "hover:bg-muted")}
      data-testid="job-card"
      data-job-id={job.id}
    >
      {selected ? <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-primary" /> : null}
      {href ? (
        <Link
          href={href}
          scroll={false}
          onClick={(e) => {
            if (!onSelect || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
            e.preventDefault();
            onSelect();
          }}
          aria-current={selected ? "true" : undefined}
          className="block px-4 py-3 pr-12 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          {content}
        </Link>
      ) : (
        <div className="px-4 py-3 pr-12">{content}</div>
      )}
      {onToggleSave ? (
        <IconButton
          label={job.viewer.saved ? "Unsave job" : "Save job"}
          size="sm"
          className={cn("absolute right-2 top-2", job.viewer.saved ? "text-primary" : "")}
          onClick={onToggleSave}
          aria-pressed={job.viewer.saved}
          data-testid="job-card-save"
        >
          {job.viewer.saved ? <BookmarkCheck /> : <Bookmark />}
        </IconButton>
      ) : null}
    </div>
  );
}

export function JobCardSkeleton({ n = 5 }: { n?: number }) {
  return (
    <div aria-hidden>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="flex gap-3 border-b border-border px-4 py-3 last:border-b-0">
          <Skeleton className="size-12 rounded-md" />
          <div className="flex-1 space-y-2 pt-1">
            <Skeleton className="h-3.5 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="h-3 w-2/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** A compact summary line: "Full-time, Senior". */
export function jobTypeLine(job: Pick<Job, "employmentType"> & { seniority?: Job["seniority"] }, seniorityLabel?: string): string {
  return [EMPLOYMENT_LABEL[job.employmentType], seniorityLabel].filter(Boolean).join(", ");
}

/**
 * Job descriptions are plain text: blank lines split paragraphs, lines starting with
 * "-", "*" or a bullet become list items, and a short line followed by content reads
 * as a heading. No HTML is ever interpreted.
 */
export function JobDescription({ text }: { text: string }) {
  const blocks = text.replace(/\r\n/g, "\n").split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  return (
    <div className="space-y-3 text-sm leading-relaxed text-foreground" data-testid="job-description">
      {blocks.map((block, i) => {
        const lines = block.split("\n").map((l) => l.trimEnd());
        const bullet = /^\s*(?:[-*•]|\d+[.)])\s+/;
        const head = lines.length > 1 && !bullet.test(lines[0]!) && lines.slice(1).every((l) => bullet.test(l)) ? lines[0] : null;
        const rest = head ? lines.slice(1) : lines;
        if (rest.length && rest.every((l) => bullet.test(l))) {
          return (
            <Fragment key={i}>
              {head ? <h3 className="pt-1 font-semibold">{head}</h3> : null}
              <ul className="list-disc space-y-1 pl-5 marker:text-subtle-foreground">
                {rest.map((l, j) => (
                  <li key={j}>{l.replace(bullet, "")}</li>
                ))}
              </ul>
            </Fragment>
          );
        }
        const isHeading = lines.length === 1 && block.length <= 60 && !/[.!?:,]$/.test(block) && i < blocks.length - 1;
        if (isHeading) return <h3 key={i} className="pt-1 font-semibold">{block}</h3>;
        return (
          <p key={i} className="whitespace-pre-line break-words">
            {block}
          </p>
        );
      })}
    </div>
  );
}

export function SkillChips({ skills, highlight }: { skills: string[]; highlight?: Set<string> }) {
  if (!skills.length) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Skills">
      {skills.map((s) => {
        const hit = highlight?.has(s.toLowerCase());
        return (
          <li key={s}>
            <Badge tone={hit ? "success" : "neutral"} size="md">
              {hit ? <CheckCircle2 aria-hidden /> : null}
              {s}
            </Badge>
          </li>
        );
      })}
    </ul>
  );
}

export function SectionCard({ title, children, className, action, testId }: { title: string; children: React.ReactNode; className?: string; action?: React.ReactNode; testId?: string }) {
  return (
    <Card className={cn("p-4 sm:p-5", className)} data-testid={testId}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-xl font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </Card>
  );
}
