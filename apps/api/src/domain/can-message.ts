/**
 * Who may message whom. Pure: the service gathers the facts, this decides.
 *
 * The rules, in order (the first that applies wins):
 *   1. You cannot message yourself.
 *   2. A restricted sender (suspended, banned) cannot start or continue conversations.
 *   3. A recipient who is not ACTIVE cannot be messaged.
 *   4. A block in EITHER direction stops everything, staff included.
 *   5. Staff (moderators, admins) may message anyone, for support.
 *   6. A normal conversation needs a reason to exist: the two are connected, OR a
 *      recruiter approach between them was ACCEPTED, OR the recipient applied to (or was
 *      hired through) a job the sender recruits for.
 *   7. Otherwise the first message is a *request*, allowed only when the recipient's
 *      policy admits the sender:
 *        ANYONE      any active member
 *        RECRUITERS  ACTIVE recruiters only (the default)
 *        NOBODY      no requests at all
 *
 * A request lands in the recipient's Requests tab with no push notification, and the
 * sender may write at most `messaging.requestMessageCap` messages until it is accepted.
 */
import type { MessageDenialReason, MessageRequestPolicy, MessagingEligibility, UserRole, UserStatus } from "@open-talent/types";

export interface MessageFacts {
  sender: { id: string; status: UserStatus; role: UserRole; isActiveRecruiter: boolean };
  recipient: { id: string; status: UserStatus; requestPolicy: MessageRequestPolicy };
  /** A block exists in either direction. */
  blocked: boolean;
  connected: boolean;
  /** An ACCEPTED approach exists between the two (either direction of recruiter/candidate). */
  acceptedApproach: boolean;
  /** One applied to a job the other recruits for (any stage but WITHDRAWN). */
  applicationLink: boolean;
}

export type MessageDecision = { allowed: true; asRequest: boolean } | { allowed: false; reason: MessageDenialReason };

export function canMessage(f: MessageFacts): MessageDecision {
  if (f.sender.id === f.recipient.id) return { allowed: false, reason: "SELF" };
  if (f.sender.status !== "ACTIVE") return { allowed: false, reason: "SENDER_RESTRICTED" };
  if (f.recipient.status !== "ACTIVE") return { allowed: false, reason: "RECIPIENT_UNAVAILABLE" };
  if (f.blocked) return { allowed: false, reason: "BLOCKED" };
  if (f.sender.role === "ADMIN" || f.sender.role === "MODERATOR") return { allowed: true, asRequest: false };
  if (f.connected || f.acceptedApproach || f.applicationLink) return { allowed: true, asRequest: false };
  if (f.recipient.requestPolicy === "NOBODY") return { allowed: false, reason: "RECIPIENT_CLOSED_REQUESTS" };
  if (f.recipient.requestPolicy === "RECRUITERS" && !f.sender.isActiveRecruiter) return { allowed: false, reason: "NOT_CONNECTED" };
  return { allowed: true, asRequest: true };
}

/** The decision as the API reports it to the client (profile pages, the composer). */
export function toEligibility(d: MessageDecision): MessagingEligibility {
  if (!d.allowed) return { canMessage: false, canRequest: false, reason: d.reason };
  return d.asRequest ? { canMessage: false, canRequest: true, reason: "NOT_CONNECTED" } : { canMessage: true, canRequest: false, reason: null };
}

/** Human copy for each denial, shown in the composer. */
export const MESSAGE_DENIAL_COPY: Record<MessageDenialReason, string> = {
  SELF: "You cannot message yourself.",
  BLOCKED: "You cannot message this person.",
  NOT_CONNECTED: "Connect with this person to send them a message.",
  RECIPIENT_UNAVAILABLE: "This account is not available.",
  RECIPIENT_CLOSED_REQUESTS: "This person only accepts messages from their connections.",
  SENDER_RESTRICTED: "Your account cannot send messages right now.",
};

/** The canonical key of a pair: the two ids sorted, so A->B and B->A find the same row. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}
