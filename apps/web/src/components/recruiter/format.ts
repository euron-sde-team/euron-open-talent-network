import type { ApplicationSource, ApplicationStage, ApproachStatus, EngagementStatus, JobStatus } from "@open-talent/types";

type Tone = "neutral" | "primary" | "success" | "warning" | "danger" | "solid" | "outline";

export const STAGES: readonly ApplicationStage[] = ["APPLIED", "SCREENING", "INTERVIEW", "OFFER", "HIRED", "REJECTED", "WITHDRAWN"];
export const OPEN_STAGES: readonly ApplicationStage[] = ["APPLIED", "SCREENING", "INTERVIEW", "OFFER"];

export const STAGE_LABEL: Record<ApplicationStage, string> = {
  APPLIED: "Applied",
  SCREENING: "Screening",
  INTERVIEW: "Interview",
  OFFER: "Offer",
  HIRED: "Hired",
  REJECTED: "Rejected",
  WITHDRAWN: "Withdrawn",
};

export const STAGE_TONE: Record<ApplicationStage, Tone> = {
  APPLIED: "neutral",
  SCREENING: "primary",
  INTERVIEW: "primary",
  OFFER: "warning",
  HIRED: "success",
  REJECTED: "danger",
  WITHDRAWN: "outline",
};

/** The dot colour on a column header. Semantic tokens only. */
export const STAGE_DOT: Record<ApplicationStage, string> = {
  APPLIED: "bg-subtle-foreground",
  SCREENING: "bg-primary/60",
  INTERVIEW: "bg-primary",
  OFFER: "bg-warning",
  HIRED: "bg-success",
  REJECTED: "bg-danger",
  WITHDRAWN: "bg-border",
};

export const SOURCE_LABEL: Record<ApplicationSource, string> = { DIRECT: "Applied", INVITE: "Invited", APPROACH: "Approach" };

const ORDER: Record<ApplicationStage, number> = { APPLIED: 0, SCREENING: 1, INTERVIEW: 2, OFFER: 3, HIRED: 4, REJECTED: 5, WITHDRAWN: 6 };

/**
 * Mirrors apps/api/src/domain/pipeline.ts for the team: which drops the board offers.
 * The server still decides; this only keeps impossible targets out of the menus.
 */
export function canTeamMove(from: ApplicationStage, to: ApplicationStage): boolean {
  if (from === to) return false;
  if (from === "HIRED" || from === "WITHDRAWN") return false;
  if (to === "WITHDRAWN") return false;
  if (from === "REJECTED") return to === "SCREENING";
  if (to === "REJECTED") return true;
  return ORDER[to] <= ORDER.HIRED;
}

export function moveTargets(from: ApplicationStage): ApplicationStage[] {
  return STAGES.filter((s) => canTeamMove(from, s));
}

export const JOB_STATUS_LABEL: Record<JobStatus, string> = { DRAFT: "Draft", OPEN: "Open", CLOSED: "Closed", FILLED: "Filled" };
export const JOB_STATUS_TONE: Record<JobStatus, Tone> = { DRAFT: "neutral", OPEN: "success", CLOSED: "outline", FILLED: "primary" };

export const APPROACH_STATUS_LABEL: Record<ApproachStatus, string> = {
  PENDING: "Pending",
  ACCEPTED: "Accepted",
  DECLINED: "Declined",
  WITHDRAWN: "Withdrawn",
  EXPIRED: "Expired",
  BLOCKED: "Closed",
};
export const APPROACH_STATUS_TONE: Record<ApproachStatus, Tone> = {
  PENDING: "warning",
  ACCEPTED: "success",
  DECLINED: "danger",
  WITHDRAWN: "outline",
  EXPIRED: "neutral",
  BLOCKED: "neutral",
};

export const ENGAGEMENT_LABEL: Record<EngagementStatus, string> = {
  PROPOSED: "Waiting for confirmation",
  ACTIVE: "Active",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  DISPUTED: "Disputed",
};
export const ENGAGEMENT_TONE: Record<EngagementStatus, Tone> = {
  PROPOSED: "warning",
  ACTIVE: "primary",
  COMPLETED: "success",
  CANCELLED: "outline",
  DISPUTED: "danger",
};

export const SIZE_BANDS = ["1-10", "11-50", "51-200", "201-500", "501-1000", "1001-5000", "5001+"] as const;

export function matchTone(score: number | null): Tone {
  if (score === null) return "neutral";
  if (score >= 70) return "success";
  if (score >= 40) return "warning";
  return "neutral";
}

/** "Oct 23, 2026". */
export function shortDate(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
