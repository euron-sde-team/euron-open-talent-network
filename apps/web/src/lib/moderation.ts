import type { ModerationActionType, ModerationCase, ModerationTarget } from "@open-talent/types";

export const MOD_ACTIONS: ModerationActionType[] = ["APPROVE", "HIDE", "REMOVE", "RESTORE", "DISMISS"];
export const STAFF_ACTIONS: ModerationActionType[] = ["WARN", "SUSPEND", "BAN"];
export const ACCOUNT_ACTIONS = new Set<ModerationActionType>(["WARN", "SUSPEND", "BAN", "UNBAN"]);
export const DESTRUCTIVE = new Set<ModerationActionType>(["REMOVE", "SUSPEND", "BAN"]);

export const TARGETS: ModerationTarget[] = ["POST", "COMMENT", "DM_MESSAGE", "USER", "PROFILE", "COMPANY", "JOB", "APPROACH"];

export const TARGET_LABEL: Record<ModerationTarget, string> = {
  POST: "Post",
  COMMENT: "Comment",
  DM_MESSAGE: "Message",
  USER: "Account",
  PROFILE: "Talent profile",
  COMPANY: "Company page",
  JOB: "Job posting",
  APPROACH: "Recruiter approach",
};

export const ACTION_LABEL: Record<ModerationActionType, string> = {
  APPROVE: "Approve",
  HIDE: "Hide",
  REMOVE: "Remove",
  RESTORE: "Restore",
  WARN: "Warn author",
  SUSPEND: "Suspend author",
  BAN: "Ban author",
  UNBAN: "Unban author",
  DISMISS: "Dismiss",
};

/** What a HIDE means for each target type, so the button says what will happen. */
export const HIDE_LABEL: Partial<Record<ModerationTarget, string>> = {
  PROFILE: "Suspend profile",
  COMPANY: "Suspend company",
  APPROACH: "Withdraw approach",
};
export const RESTORE_LABEL: Partial<Record<ModerationTarget, string>> = {
  PROFILE: "Restore profile",
  COMPANY: "Restore company",
};

export function actionLabel(action: ModerationActionType, target: ModerationTarget): string {
  if (action === "HIDE") return HIDE_LABEL[target] ?? ACTION_LABEL.HIDE;
  if (action === "RESTORE") return RESTORE_LABEL[target] ?? ACTION_LABEL.RESTORE;
  if (target === "USER" && ACCOUNT_ACTIONS.has(action)) return ACTION_LABEL[action].replace(" author", "");
  return ACTION_LABEL[action];
}

/**
 * The target's status in content terms. Profiles and company pages report their own
 * status (SUSPENDED means hidden); approaches are visible only while PENDING or ACCEPTED.
 * Mirrors loadTarget in apps/api/src/services/moderation/targets.ts.
 */
export function contentStatus(targetType: ModerationTarget, raw: string | null): string {
  const s = raw ?? "";
  switch (targetType) {
    case "PROFILE":
    case "COMPANY":
      return s === "SUSPENDED" ? "HIDDEN" : s ? "PUBLISHED" : "";
    case "APPROACH":
      return s === "PENDING" || s === "ACCEPTED" ? "PUBLISHED" : s ? "HIDDEN" : "";
    default:
      return s;
  }
}

/** Content types that can be removed for good (the others are hidden or suspended). */
const REMOVABLE = new Set<ModerationTarget>(["POST", "COMMENT", "DM_MESSAGE", "JOB"]);

export interface ModeratorPowers {
  isStaff: boolean;
  isAdmin: boolean;
}

/**
 * Actions offered for a case. Every action resolves the case, so a resolved case has
 * none. Moderators act on content and accounts; only admins ban and unban. Actions that
 * would not change anything given the target's current status are left out.
 */
export function availableActions(c: Pick<ModerationCase, "status" | "targetType" | "targetStatus" | "author">, powers: ModeratorPowers): ModerationActionType[] {
  if (c.status !== "OPEN" || !powers.isStaff) return [];
  const isUser = c.targetType === "USER";
  const out: ModerationActionType[] = [];
  if (!isUser) {
    const s = contentStatus(c.targetType, c.targetStatus);
    if (s === "PENDING_REVIEW") out.push("APPROVE");
    // An approach can only be withdrawn while it is still waiting for an answer.
    if ((s === "PUBLISHED" || s === "PENDING_REVIEW") && (c.targetType !== "APPROACH" || c.targetStatus === "PENDING")) out.push("HIDE");
    if (REMOVABLE.has(c.targetType) && s !== "REMOVED" && s !== "DELETED" && s !== "") out.push("REMOVE");
    if ((s === "HIDDEN" || (s === "REMOVED" && REMOVABLE.has(c.targetType))) && c.targetType !== "APPROACH") out.push("RESTORE");
  }
  out.push("DISMISS");
  if (c.author || isUser) {
    out.push("WARN", "SUSPEND");
    if (powers.isAdmin) out.push(isUser && c.targetStatus === "BANNED" ? "UNBAN" : "BAN");
  }
  return out;
}

/** Where a case's target lives in the app, when it has a page of its own. */
export function targetHref(c: Pick<ModerationCase, "targetType" | "targetId" | "author">): string | null {
  switch (c.targetType) {
    case "POST":
      return `/posts/${encodeURIComponent(c.targetId)}`;
    case "JOB":
      return `/jobs?job=${encodeURIComponent(c.targetId)}`;
    case "USER":
    case "PROFILE":
      return c.author ? `/in/${encodeURIComponent(c.author.username)}` : null;
    default:
      return null;
  }
}

export type Severity = "low" | "medium" | "high";
export function severity(score: number): Severity {
  if (score >= 0.8) return "high";
  if (score >= 0.5) return "medium";
  return "low";
}

/** Categories sorted by score, highest first. */
export function sortedScores(scores: Record<string, number> | null | undefined): [string, number][] {
  return Object.entries(scores ?? {})
    .filter(([, v]) => typeof v === "number" && Number.isFinite(v))
    .sort((a, b) => b[1] - a[1]);
}

export function caseSnippet(c: Pick<ModerationCase, "snapshot" | "targetType">): string {
  const s = c.snapshot ?? {};
  const text = (typeof s.title === "string" && s.title) || (typeof s.body === "string" && s.body) || "";
  if (text) return text.length > 140 ? `${text.slice(0, 137)}...` : text;
  if (Array.isArray(s.media) && s.media.length) return `${s.media.length} attachment${s.media.length === 1 ? "" : "s"}`;
  return c.targetType === "USER" ? "Account" : "No text";
}

export const humanize = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ");

/** Resolutions the author may appeal. WARN is not one: the API answers NOT_APPEALABLE. */
export const APPEALABLE_RESOLUTIONS: readonly ModerationActionType[] = ["HIDE", "REMOVE", "SUSPEND", "BAN"];

/**
 * Whether the author may appeal this case: once, against a hide, removal,
 * suspension or ban, or while the case is still open if the content was
 * already hidden automatically.
 */
export function canAppeal(c: Pick<ModerationCase, "status" | "resolution" | "targetStatus" | "appeal">): boolean {
  if (c.appeal) return false;
  if (c.status === "OPEN") return c.targetStatus === "HIDDEN";
  return !!c.resolution && APPEALABLE_RESOLUTIONS.includes(c.resolution);
}
