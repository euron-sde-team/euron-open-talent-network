/**
 * The hiring pipeline. Pure: which stage changes are allowed, by whom, and what the
 * candidate is told.
 *
 *   APPLIED -> SCREENING -> INTERVIEW -> OFFER -> HIRED
 *        \________\____________\__________\______-> REJECTED (with a reason)
 *   any open stage -> WITHDRAWN (the candidate only)
 *
 * The team may move a card back to an earlier open stage (a mistaken drag), and may
 * reopen a REJECTED application into SCREENING. HIRED and WITHDRAWN are final.
 * The candidate sees every stage change with its time; team notes never reach them.
 */
import type { ApplicationStage } from "@open-talent/types";

export const OPEN_STAGES: readonly ApplicationStage[] = ["APPLIED", "SCREENING", "INTERVIEW", "OFFER"];
const ORDER: Record<ApplicationStage, number> = { APPLIED: 0, SCREENING: 1, INTERVIEW: 2, OFFER: 3, HIRED: 4, REJECTED: 5, WITHDRAWN: 6 };

export type StageMover = "TEAM" | "CANDIDATE";

export type MoveDecision = { allowed: true } | { allowed: false; code: "STAGE_FINAL" | "STAGE_NOT_ALLOWED" | "REASON_REQUIRED" | "SAME_STAGE" };

export function canMoveStage(from: ApplicationStage, to: ApplicationStage, by: StageMover, opts: { reason?: string | null } = {}): MoveDecision {
  if (from === to) return { allowed: false, code: "SAME_STAGE" };
  if (from === "HIRED" || from === "WITHDRAWN") return { allowed: false, code: "STAGE_FINAL" };
  if (by === "CANDIDATE") return to === "WITHDRAWN" && OPEN_STAGES.includes(from) ? { allowed: true } : { allowed: false, code: "STAGE_NOT_ALLOWED" };
  if (to === "WITHDRAWN") return { allowed: false, code: "STAGE_NOT_ALLOWED" };
  if (from === "REJECTED") return to === "SCREENING" ? { allowed: true } : { allowed: false, code: "STAGE_NOT_ALLOWED" };
  if (to === "REJECTED") return opts.reason?.trim() ? { allowed: true } : { allowed: false, code: "REASON_REQUIRED" };
  // Forward to any later open stage or HIRED, or back to an earlier open stage.
  return ORDER[to] <= ORDER.HIRED ? { allowed: true } : { allowed: false, code: "STAGE_NOT_ALLOWED" };
}

/** Plain words for the candidate's timeline and notifications. */
export const STAGE_COPY: Record<ApplicationStage, string> = {
  APPLIED: "Application sent",
  SCREENING: "Under review",
  INTERVIEW: "Interviewing",
  OFFER: "Offer extended",
  HIRED: "Hired",
  REJECTED: "Not selected",
  WITHDRAWN: "Withdrawn",
};

/**
 * Skill overlap between a job and a candidate: the share of the job's skills the
 * candidate lists (case-insensitive), 0..100, plus the matched and missing names. A job
 * with no skills scores null: there is nothing to compare.
 */
export function matchScore(jobSkills: readonly string[], candidateSkills: readonly string[]): { score: number | null; matched: string[]; missing: string[] } {
  if (!jobSkills.length) return { score: null, matched: [], missing: [] };
  const have = new Set(candidateSkills.map((s) => s.toLowerCase()));
  const matched = jobSkills.filter((s) => have.has(s.toLowerCase()));
  const missing = jobSkills.filter((s) => !have.has(s.toLowerCase()));
  return { score: Math.round((matched.length / jobSkills.length) * 100), matched, missing };
}
