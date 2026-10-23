/**
 * The facts canMessage() needs (domain/can-message.ts), loaded for one sender and many
 * recipients at once: profile pages, thread lists and the contacts rail call this once
 * per page, never once per person. Always read fresh, inside the caller's transaction
 * when there is one.
 */
import type { Actor } from "../core/context";
import { db, type Executor } from "../db/kysely";
import { canMessage, type MessageDecision, type MessageFacts } from "../domain/can-message";
import { blockedSet, connectedSet } from "./visibility";

/** Among `others`, people with an ACCEPTED approach with `userId` (either side of it). */
export async function approachLinked(userId: string, others: readonly string[], exec: Executor = db): Promise<Set<string>> {
  if (!others.length) return new Set();
  const ids = [...others];
  const rows = await exec
    .selectFrom("approaches as a")
    .innerJoin("recruiters as r", "r.id", "a.recruiter_id")
    .select(["a.candidate_id", "r.user_id as recruiter_user_id"])
    .where("a.status", "=", "ACCEPTED")
    .where((eb) => eb.or([eb.and([eb("r.user_id", "=", userId), eb("a.candidate_id", "in", ids)]), eb.and([eb("a.candidate_id", "=", userId), eb("r.user_id", "in", ids)])]))
    .execute();
  return new Set(rows.map((r) => (r.candidate_id === userId ? r.recruiter_user_id : r.candidate_id)));
}

/**
 * Among `others`, people linked to `userId` by an application: one applied to a job of
 * the company the other actively recruits for (any stage but WITHDRAWN).
 */
export async function applicationLinked(userId: string, others: readonly string[], exec: Executor = db): Promise<Set<string>> {
  if (!others.length) return new Set();
  const ids = [...others];
  const rows = await exec
    .selectFrom("applications as a")
    .innerJoin("recruiters as r", (j) => j.onRef("r.company_id", "=", "a.company_id").on("r.status", "=", "ACTIVE"))
    .select(["a.candidate_id", "r.user_id as recruiter_user_id"])
    .where("a.stage", "<>", "WITHDRAWN")
    .where((eb) => eb.or([eb.and([eb("r.user_id", "=", userId), eb("a.candidate_id", "in", ids)]), eb.and([eb("a.candidate_id", "=", userId), eb("r.user_id", "in", ids)])]))
    .execute();
  return new Set(rows.map((r) => (r.candidate_id === userId ? r.recruiter_user_id : r.candidate_id)));
}

export async function isActiveRecruiter(userId: string, exec: Executor = db): Promise<boolean> {
  const row = await exec
    .selectFrom("recruiters as r")
    .innerJoin("companies as c", "c.id", "r.company_id")
    .select("r.id")
    .where("r.user_id", "=", userId)
    .where("r.status", "=", "ACTIVE")
    .where("c.status", "<>", "SUSPENDED")
    .executeTakeFirst();
  return !!row;
}

/** canMessage(sender, each recipient), batched. Unknown recipients come back RECIPIENT_UNAVAILABLE. */
export async function messagingDecisions(sender: Actor, recipientIds: readonly string[], exec: Executor = db): Promise<Map<string, MessageDecision>> {
  const ids = [...new Set(recipientIds)];
  const out = new Map<string, MessageDecision>();
  if (!ids.length) return out;
  const [recipients, blocked, connected, approaches, applications, recruiter] = await Promise.all([
    exec.selectFrom("users").select(["id", "status", "message_request_policy"]).where("id", "in", ids).execute(),
    blockedSet(sender.id, exec),
    connectedSet(sender.id, ids, exec),
    approachLinked(sender.id, ids, exec),
    applicationLinked(sender.id, ids, exec),
    isActiveRecruiter(sender.id, exec),
  ]);
  const byId = new Map(recipients.map((r) => [r.id, r]));
  for (const id of ids) {
    const r = byId.get(id);
    if (!r) {
      out.set(id, { allowed: false, reason: "RECIPIENT_UNAVAILABLE" });
      continue;
    }
    const facts: MessageFacts = {
      sender: { id: sender.id, status: sender.status, role: sender.role, isActiveRecruiter: recruiter },
      recipient: { id: r.id, status: r.status, requestPolicy: r.message_request_policy },
      blocked: blocked.has(id),
      connected: connected.has(id),
      acceptedApproach: approaches.has(id),
      applicationLink: applications.has(id),
    };
    out.set(id, canMessage(facts));
  }
  return out;
}

export async function messagingDecision(sender: Actor, recipientId: string, exec: Executor = db): Promise<MessageDecision> {
  return (await messagingDecisions(sender, [recipientId], exec)).get(recipientId) ?? { allowed: false, reason: "RECIPIENT_UNAVAILABLE" };
}
