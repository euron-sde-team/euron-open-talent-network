/**
 * Profile rules that are pure: completeness, the publish gate, who sees which section,
 * and the displayed rating.
 */
import type { OpenToWorkMode, ProfileSection, SectionAudience } from "@open-talent/types";
import { PROFILE_SECTIONS } from "@open-talent/types";

/**
 * What "finished enough to publish" means, weighted by what a recruiter actually reads.
 * It also drives the progress ring in the editor, so the numbers move visibly as someone
 * fills things in. The weights sum to 100.
 */
export const COMPLETENESS_WEIGHTS = [
  { key: "headline", points: 15, hint: "Add a headline" },
  { key: "about", points: 15, hint: "Write a short About section" },
  { key: "avatar", points: 10, hint: "Add a profile photo" },
  { key: "skills", points: 15, hint: "List your skills" },
  { key: "experience", points: 20, hint: "Add a role you have held" },
  { key: "projects", points: 10, hint: "Show a project" },
  { key: "education", points: 5, hint: "Add your education" },
  { key: "links", points: 5, hint: "Link your work (GitHub, a portfolio, a site)" },
  { key: "contact", points: 5, hint: "Add a private contact channel" },
] as const;

export type CompletenessFacts = Record<(typeof COMPLETENESS_WEIGHTS)[number]["key"], boolean>;

export function completeness(f: CompletenessFacts): { score: number; missing: string[] } {
  let score = 0;
  const missing: string[] = [];
  for (const w of COMPLETENESS_WEIGHTS) {
    if (f[w.key]) score += w.points;
    else missing.push(w.hint);
  }
  return { score, missing };
}

export type PublishBlock = "SUSPENDED" | "INCOMPLETE" | "NO_CONTACT";

/** Why a profile cannot be published yet, or null when it can. */
export function publishBlock(p: { status: string; score: number; hasContact: boolean }, threshold: number): PublishBlock | null {
  if (p.status === "SUSPENDED") return "SUSPENDED";
  if (p.score < threshold) return "INCOMPLETE";
  // Recruiters need a way to reach a published profile (after the candidate consents).
  if (!p.hasContact) return "NO_CONTACT";
  return null;
}

export interface ViewerRelation {
  isSelf: boolean;
  isStaff: boolean;
  connected: boolean;
  /** An ACTIVE recruiter of a company that is not suspended. */
  isRecruiter: boolean;
}

export function readAudience(raw: unknown, section: ProfileSection): SectionAudience {
  const v = raw && typeof raw === "object" ? (raw as Record<string, unknown>)[section] : undefined;
  return v === "CONNECTIONS" || v === "RECRUITERS" ? v : "PUBLIC";
}

/** Can this viewer see a section with this audience? Recruiters count as connections for RECRUITERS sections only. */
export function canSeeSection(audience: SectionAudience, v: ViewerRelation): boolean {
  if (v.isSelf || v.isStaff || audience === "PUBLIC") return true;
  if (audience === "CONNECTIONS") return v.connected;
  return v.connected || v.isRecruiter;
}

/** The sections this viewer may not see. */
export function hiddenSections(raw: unknown, v: ViewerRelation): ProfileSection[] {
  return PROFILE_SECTIONS.filter((s) => !canSeeSection(readAudience(raw, s), v));
}

/** Whether the open-to-work signal is shown to this viewer. */
export function showsOpenToWork(mode: OpenToWorkMode, v: ViewerRelation): boolean {
  if (mode === "OFF") return false;
  if (mode === "PUBLIC" || v.isSelf || v.isStaff) return true;
  return v.isRecruiter;
}

/**
 * Bayesian-adjusted average, so a single glowing review does not outrank a long
 * consistent record: (C * m + sum) / (C + n) with prior mean m = 4.0 worth C = 3
 * ratings. Rounded to one decimal; null with no ratings.
 */
export const RATING_PRIOR = 4.0;
export const RATING_PRIOR_WEIGHT = 3;

export function displayRating(avg: number | null, count: number): number | null {
  if (avg === null || !count) return null;
  return Math.round(((RATING_PRIOR_WEIGHT * RATING_PRIOR + avg * count) / (RATING_PRIOR_WEIGHT + count)) * 10) / 10;
}
