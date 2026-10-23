/**
 * Whether a participant may send into an existing 1:1 thread right now. Pure; the
 * service gathers fresh facts on every send and asks this.
 *
 * canMessage() (can-message.ts) decides who may START a conversation. Inside a thread
 * its "not connected" reason is waived once the counterpart is ACTIVE in the thread:
 * they accepted the request (or the thread was opened by an accepted approach or an
 * application), which is consent. Blocks and account status are never waived.
 *
 * Message requests: while the recipient has not accepted, the sender may send up to
 * `requestCap` messages, enough to introduce themselves without flooding. The count
 * includes messages the sender has since deleted. A declined request reads as "this
 * person only accepts messages from their connections", so the sender is not told they
 * were declined specifically.
 */
import type { MessageDenialReason } from "@open-talent/types";
import type { MessageDecision } from "./can-message";

export const DEFAULT_REQUEST_MESSAGE_CAP = 3;

export type ParticipantState = "ACTIVE" | "REQUESTED" | "DECLINED";

export type SendDecision =
  | { allowed: true }
  | { allowed: false; code: "DM_NOT_ALLOWED"; reason: MessageDenialReason }
  | { allowed: false; code: "DM_REQUEST_PENDING" };

const HARD: MessageDenialReason[] = ["SELF", "SENDER_RESTRICTED", "RECIPIENT_UNAVAILABLE", "BLOCKED"];

export function directSendDecision(i: { eligibility: MessageDecision; counterpartState: ParticipantState; sentWhilePending: number; requestCap?: number }): SendDecision {
  const e = i.eligibility;
  if (!e.allowed && HARD.includes(e.reason)) return { allowed: false, code: "DM_NOT_ALLOWED", reason: e.reason };
  if (i.counterpartState === "DECLINED") return { allowed: false, code: "DM_NOT_ALLOWED", reason: "RECIPIENT_CLOSED_REQUESTS" };
  if (!e.allowed && i.counterpartState !== "ACTIVE") return { allowed: false, code: "DM_NOT_ALLOWED", reason: e.reason };
  if (i.counterpartState === "REQUESTED" && i.sentWhilePending >= (i.requestCap ?? DEFAULT_REQUEST_MESSAGE_CAP)) return { allowed: false, code: "DM_REQUEST_PENDING" };
  return { allowed: true };
}
