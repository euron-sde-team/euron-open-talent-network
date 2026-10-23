import { isApiError } from "@open-talent/api-client";
import type { MessageDenialReason } from "@open-talent/types";

/** Human copy for the API's stable error codes. Unknown codes fall back to the server message. */
const COPY: Record<string, string> = {
  NETWORK_ERROR: "We could not reach the server. Check your connection and try again.",
  SERVER_ERROR: "Something went wrong on our side. Try again in a moment.",
  BAD_GATEWAY: "The service is restarting. Try again in a moment.",
  SERVICE_UNAVAILABLE: "The service is temporarily unavailable. Try again in a moment.",
  GATEWAY_TIMEOUT: "The server took too long to answer. Try again.",
  RATE_LIMITED: "You are doing that too fast. Wait a moment and try again.",
  UNAUTHENTICATED: "Sign in to continue.",
  TOKEN_INVALID: "This link is invalid or has expired.",
  SESSION_EXPIRED: "Your session expired. Sign in again.",
  FORBIDDEN: "You do not have permission to do that.",
  NOT_FOUND: "We could not find that. It may have been removed or you may not have access.",
  VALIDATION_FAILED: "Some fields need attention.",
  INVALID_CREDENTIALS: "That email, username or password is not right.",
  INVALID_TOTP: "That code did not work. Check your authenticator app and try again.",
  ACCOUNT_RESTRICTED: "Your account is restricted, so you can read but not post or message right now.",
  ACCOUNT_BANNED: "This account has been banned.",
  ACCOUNT_DEACTIVATED: "This account has been deactivated.",
  EMAIL_NOT_VERIFIED: "Confirm your email address first. Check your inbox for the link.",
  EMAIL_TAKEN: "An account with that email already exists.",
  USERNAME_TAKEN: "That username is taken. Try another.",
  WEAK_PASSWORD: "Choose a stronger password: at least 10 characters, not a common one.",
  REGISTRATION_CLOSED: "Sign-ups are closed on this network right now.",
  TOTP_ALREADY_ENABLED: "Two-factor authentication is already on.",
  TOTP_NOT_STARTED: "Start two-factor setup again.",
  USERNAME_RESERVED: "That username is reserved. Try another.",
  USERNAME_COOLDOWN: "You changed your username recently. Try again later.",
  PROFILE_NOT_FOUND: "This profile is not available.",
  PROFILE_SUSPENDED: "This profile is suspended while a moderator reviews it.",
  PUBLISH_INCOMPLETE: "Your profile needs a little more before it can be published.",
  PUBLISH_NO_CONTACT: "Add at least one contact channel before publishing, so recruiters can reach you once you say yes.",
  MONTH_INVALID: "Use a month in the format YYYY-MM.",
  DATES_INVALID: "The end date must come after the start date.",
  URL_INVALID: "Links must start with https:// or http://.",
  SALARY_INVALID: "Check the pay range: the minimum must not exceed the maximum.",
  IMPORT_DISABLED: "AI import is not available on this network right now.",
  IMPORT_TOO_SHORT: "Give the import a little more to work with: paste your resume or a few paragraphs about your work.",
  IMPORT_EMPTY: "We could not find any text in that file. Try a PDF or DOCX with selectable text.",
  IMPORT_NOT_READY: "The import is still running.",
  AI_UNAVAILABLE: "The AI assistant is not available right now. You can still fill in your profile by hand.",
  AI_FAILED: "The AI assistant could not finish. Try again in a moment.",
  ALREADY_RECRUITER: "You already have a recruiter account.",
  WORK_EMAIL_TAKEN: "That work email is already used by another recruiter account.",
  EMAIL_INVALID: "Enter a valid email address.",
  CODE_WRONG: "That code is not right. Check your email and try again.",
  CODE_EXPIRED: "That code has expired. Send a new one.",
  CODE_LOCKED: "Too many wrong codes. Send a new one.",
  RECRUITER_REQUIRED: "You need an approved recruiter account for this.",
  NOT_A_RECRUITER: "You need an approved recruiter account for this.",
  NOT_COMPANY_ADMIN: "Only company page admins can do that.",
  NOT_HIRING_TEAM: "Only the hiring team for this job can do that.",
  COMPANY_SUSPENDED: "This company page is suspended.",
  LAST_OWNER: "A company page needs at least one owner. Make someone else an owner first.",
  OWN_COMPANY: "You can not do that for your own company.",
  APPROACH_ALREADY_PENDING: "You already have a pending approach with this person.",
  ALREADY_PENDING: "You already have a pending approach with this person.",
  APPROACH_COOLDOWN: "This person declined recently. You can approach them again after the cooldown.",
  APPROACH_QUOTA: "You have used today's approaches. The quota resets at midnight UTC.",
  COOLDOWN: "This person declined recently. You can approach them again after the cooldown.",
  QUOTA: "You have used today's approaches. The quota resets at midnight UTC.",
  NOT_PUBLISHED: "This profile is not published, so it can not be approached.",
  APPROACH_NOT_PENDING: "This approach has already been answered.",
  APPROACH_EXPIRED: "This approach has expired.",
  APPROACH_NOT_ACCEPTED: "Contact details unlock only after the candidate accepts.",
  CHANNELS_REQUIRED: "Pick at least one way to be contacted.",
  CHANNEL_NOT_SET: "Add that contact channel to your profile first.",
  CONTACT_NOT_SHARED: "The candidate has not shared contact details, or has revoked them.",
  NOTHING_SHARED: "The candidate has not shared contact details, or has revoked them.",
  JOB_NOT_OPEN: "This job is not accepting applications.",
  JOB_CAP_REACHED: "Your company has reached the limit of open jobs. Close one to open another.",
  JOB_UNDER_REVIEW: "This job is being reviewed by a moderator.",
  JOB_REMOVED: "This job was removed.",
  ALREADY_APPLIED: "You have already applied to this job.",
  ALREADY_INVITED: "You already invited this person to this job.",
  ANSWERS_INVALID: "Answer every required screening question.",
  STAGE_NOT_ALLOWED: "That move is not allowed from this stage.",
  INVALID_TRANSITION: "That move is not allowed from this stage.",
  SAME_STAGE: "The application is already in that stage.",
  STAGE_FINAL: "This application is closed.",
  REASON_REQUIRED: "Add a reason.",
  APPLICATION_WITHDRAWN: "The candidate withdrew this application.",
  APPLICATION_CHANGED: "Someone on your team moved this application first. The board has been refreshed.",
  ENGAGEMENT_EXISTS: "There is already an engagement for this.",
  ENGAGEMENT_STATE: "This engagement can not do that in its current state.",
  ENGAGEMENT_NOT_COMPLETE: "Ratings open once both sides mark the engagement complete.",
  RATING_WINDOW_CLOSED: "The rating window for this engagement has closed.",
  NO_RELATIONSHIP: "You can only file a complaint about someone you have worked with or talked to here.",
  COMPLAINT_EXISTS: "You already filed a complaint about this.",
  COMPLAINT_LIMIT: "You have filed several complaints recently. Our team is looking at them.",
  CONNECTION_RACE: "That invitation changed while you were looking. Refresh and try again.",
  DM_REQUEST_PENDING: "Your message request is waiting for a reply.",
  MESSAGE_TOO_LONG: "That message is too long.",
  MESSAGE_EMPTY: "Write a message first.",
  EMPTY_POST: "Write something or attach a file first.",
  EMPTY_COMMENT: "Write a comment first.",
  SHARE_NOT_ALLOWED: "That post can not be reposted.",
  TOO_MANY_SEARCHES: "You can keep up to 50 saved searches. Delete one first.",
  CANNOT_REPORT_SELF: "You can not report your own content.",
  ALREADY_REPORTED: "You already reported this. Our moderators will take a look.",
  DM_NOT_ALLOWED: "You can not message this person right now.",
  MEDIA_INVALID: "That file could not be used. Try a different one.",
  MEDIA_NOT_READY: "Your upload is still processing. Try again in a moment.",
  MEDIA_IN_USE: "That file is already attached somewhere else.",
  UPLOAD_FAILED: "The upload did not go through. Try again.",
  PAYLOAD_TOO_LARGE: "That file is too large.",
  LAST_ADMIN: "You are the last administrator. Make someone else an admin first.",
  OWNER_MUST_TRANSFER: "Make another teammate an owner of your company page before you leave.",
  APPEAL_EXISTS: "You have already appealed this decision.",
};

export function errorCopy(code: string | undefined, fallback?: string): string {
  if (code && COPY[code]) return COPY[code];
  return fallback || "Something went wrong. Try again.";
}

/** The best human message for any thrown value. */
export function errorMessage(e: unknown): string {
  if (isApiError(e)) {
    // Validation messages from the server are already field-specific and readable.
    if (e.code === "VALIDATION_FAILED") {
      const first = Object.values(e.fieldErrors)[0];
      return first ? `${COPY.VALIDATION_FAILED} ${capitalise(first)}.` : COPY.VALIDATION_FAILED!;
    }
    return errorCopy(e.code, e.message);
  }
  if (e instanceof Error && e.name === "AbortError") return "Cancelled.";
  return errorCopy(undefined);
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/\.$/, "");

/** Errors not worth a toast: the page already shows them in place. */
export function isQuietError(e: unknown): boolean {
  if (isApiError(e)) return e.status === 404 || e.status === 401 || e.code === "VALIDATION_FAILED";
  return e instanceof Error && e.name === "AbortError";
}

/** Copy for each messaging denial reason (domain/can-message.ts on the API). `name` is the other person's display name. */
export function dmDenialCopy(reason: MessageDenialReason | null | undefined, name = "this person"): string {
  switch (reason) {
    case "SELF":
      return "You cannot message yourself.";
    case "BLOCKED":
      return `You cannot message ${name}.`;
    case "NOT_CONNECTED":
      return `Connect with ${name} to send a message.`;
    case "RECIPIENT_CLOSED_REQUESTS":
      return `${name} only accepts messages from their connections.`;
    case "RECIPIENT_UNAVAILABLE":
      return "This account is not available.";
    case "SENDER_RESTRICTED":
      return "Your account cannot send messages right now.";
    default:
      return `You cannot message ${name} right now.`;
  }
}
