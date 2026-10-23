/**
 * Approach and rating rules, pure.
 *
 * Approaches: a recruiter may approach a published (or unlisted, via a direct link)
 * profile once at a time; after a decline they wait `declineCooldownDays` before trying
 * again; a block ends it for good; the daily quota bounds volume. The candidate is
 * never told about the block check (the source revealed "BLOCKED" in contact-state).
 *
 * Ratings are double-blind: each side's rating stays hidden until both have rated or
 * the window closes, so neither can answer the other's score. Once revealed a rating is
 * final (the source allowed an edit after reveal, which invited retaliation); before
 * reveal it can be edited once.
 */
export type ApproachBlock = "NOT_PUBLISHED" | "BLOCKED" | "ALREADY_PENDING" | "COOLDOWN" | "QUOTA" | "SELF";

export interface ApproachFacts {
  recruiterUserId: string;
  candidateId: string;
  profileStatus: string;
  blocked: boolean;
  pending: boolean;
  lastDeclinedAt: Date | null;
  sentToday: number;
  quota: number;
  cooldownDays: number;
  now?: Date;
}

export function approachBlock(f: ApproachFacts): { block: ApproachBlock | null; cooldownUntil: Date | null } {
  if (f.recruiterUserId === f.candidateId) return { block: "SELF", cooldownUntil: null };
  if (f.blocked) return { block: "BLOCKED", cooldownUntil: null };
  if (f.profileStatus !== "PUBLISHED" && f.profileStatus !== "UNLISTED") return { block: "NOT_PUBLISHED", cooldownUntil: null };
  if (f.pending) return { block: "ALREADY_PENDING", cooldownUntil: null };
  if (f.lastDeclinedAt) {
    const until = new Date(f.lastDeclinedAt.getTime() + f.cooldownDays * 86400_000);
    if (until > (f.now ?? new Date())) return { block: "COOLDOWN", cooldownUntil: until };
  }
  if (f.sentToday >= f.quota) return { block: "QUOTA", cooldownUntil: null };
  return { block: null, cooldownUntil: null };
}

export interface RatingFacts {
  revealedAt: Date | null;
  editedAt: Date | null;
}

export type RatingEditBlock = "REVEALED" | "ALREADY_EDITED" | null;

export function ratingEditBlock(r: RatingFacts): RatingEditBlock {
  if (r.revealedAt) return "REVEALED";
  if (r.editedAt) return "ALREADY_EDITED";
  return null;
}

/** Ratings can be given from completion until the window closes. */
export function ratingWindowOpen(completedAt: Date | null, windowDays: number, now = new Date()): boolean {
  if (!completedAt) return false;
  return now.getTime() <= completedAt.getTime() + windowDays * 86400_000;
}

/** Both ratings in, or the window has closed: reveal. */
export function shouldReveal(i: { ratingsIn: number; completedAt: Date | null; windowDays: number; now?: Date }): boolean {
  if (i.ratingsIn >= 2) return true;
  return !!i.completedAt && !ratingWindowOpen(i.completedAt, i.windowDays, i.now);
}

/** Mean of a 1..5 rating set, rounded to two decimals (the stored column). */
export function averageScore(scores: readonly number[]): number | null {
  if (!scores.length) return null;
  return Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100;
}
