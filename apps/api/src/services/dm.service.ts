/**
 * Direct messages: 1:1 threads, message requests, reactions, read cursors, archive,
 * search and the media drawer.
 *
 * Who may talk to whom is decided by domain/can-message.ts (starting a conversation)
 * and domain/dm-send.ts (sending into one), always from facts loaded fresh inside the
 * request. The source system let any member message any profile (blocks ignored,
 * unpublished profiles reachable) and sent an email per message; here a conversation
 * needs a connection, an accepted approach or an application, everything else is a
 * capped message request, and delivery is a socket emit after commit (email is a digest).
 *
 * Message requests: the recipient is in state REQUESTED. They see it under
 * folder=requests, get one DM_REQUEST notification and a "dm:request" socket event, and
 * "dm:message" still reaches them so an open requests view updates. Replying accepts.
 *
 * Threads opened by an accepted approach or an application (openContextThread) start
 * ACTIVE on both sides: accepting the approach, or applying, is the consent.
 */
import type { Media, Message, MessageDenialReason, MessagingEligibility, Thread, ThreadContext, UserSummary } from "@open-talent/types";
import { sql } from "kysely";
import { type Actor, isStaff, requireActive } from "../core/context";
import { decodeCursor, toPage, type Page } from "../core/cursor";
import { withTransaction, type Effects } from "../core/effects";
import { badRequest, forbidden, HttpError, notFound } from "../core/errors";
import { newId } from "../core/ids";
import { db, type Executor } from "../db/kysely";
import { pairKey, toEligibility, type MessageDecision } from "../domain/can-message";
import { directSendDecision, type SendDecision } from "../domain/dm-send";
import { inboxTotals } from "../domain/unread";
import { consume } from "../middleware/rate-limit";
import { loadMedia } from "../presenters/media.presenter";
import { loadMessage, presentMessages } from "../presenters/message.presenter";
import { presentThread, presentThreads } from "../presenters/thread.presenter";
import { loadSummaries } from "../presenters/user.presenter";
import { onlineMap } from "../realtime/presence";
import { realtime, rooms } from "../realtime/port";
import { dmRepo, type Folder } from "../repositories/dm.repository";
import { messagingDecision } from "../repositories/messaging-facts";
import { isBlockedEitherWay } from "../repositories/visibility";
import { claimUploads } from "./media-attach.service";
import { notify, pushCounts } from "./notification.service";
import { getSettings } from "./settings.service";

const MAX_MEDIA_PER_MESSAGE = 10;

function denied(reason: MessageDenialReason): HttpError {
  return new HttpError(403, "You cannot message this person", "DM_NOT_ALLOWED", { reason });
}

function refuse(d: Exclude<SendDecision, { allowed: true }>): HttpError {
  if (d.code === "DM_REQUEST_PENDING") return forbidden("Wait for them to accept your message request", "DM_REQUEST_PENDING");
  return denied(d.reason);
}

// ─── Eligibility ────────────────────────────────────────────────────────────

export function eligibility(sender: Actor, recipientId: string, exec: Executor = db): Promise<MessageDecision> {
  return messagingDecision(sender, recipientId, exec);
}

export async function getEligibility(actor: Actor, userId: string): Promise<MessagingEligibility> {
  return toEligibility(await eligibility(actor, userId));
}

// ─── Threads ────────────────────────────────────────────────────────────────

type State = "ACTIVE" | "REQUESTED" | "DECLINED";

/** A thread the actor participates in, else 404 so ids cannot be probed. */
async function participantThread(actor: Actor, threadId: string, exec: Executor = db, states: State[] = ["ACTIVE", "REQUESTED"]) {
  const thread = await dmRepo.findThread(threadId, exec);
  const me = thread ? await dmRepo.participant(threadId, actor.id, exec) : undefined;
  if (!thread || !me || !states.includes(me.state)) throw notFound("Conversation not found", "THREAD_NOT_FOUND");
  return { thread, me };
}

/** Open (find or create) the 1:1 thread with `userId`. */
export async function openDirect(actor: Actor, userId: string): Promise<Thread> {
  requireActive(actor);
  if (userId === actor.id) throw denied("SELF");
  const existing = await dmRepo.findDirect(pairKey(actor.id, userId));
  if (existing) {
    const me = await dmRepo.participant(existing.id, actor.id);
    if (me && (await isBlockedEitherWay(actor.id, userId))) throw denied("BLOCKED");
    if (me && me.state !== "DECLINED") return presentThread(actor, existing);
  }

  const decision = await eligibility(actor, userId);
  if (!decision.allowed) throw denied(decision.reason);
  if (decision.asRequest) {
    const settings = await getSettings();
    await consume("dm-request", `u:${actor.id}`, settings.messaging.requestsPerDay, 86400);
  }
  const context: ThreadContext = decision.asRequest ? "REQUEST" : isStaff(actor) ? "SUPPORT" : "CONNECTION";

  const thread = await withTransaction(async (trx) => {
    const now = new Date();
    const key = pairKey(actor.id, userId);
    const inserted = await dmRepo.insertThread({ id: newId(), direct_key: key, context, created_by: actor.id }, trx);
    const row = inserted ?? (await dmRepo.findDirect(key, trx))!;
    await dmRepo.upsertParticipants(
      [
        { thread_id: row.id, user_id: actor.id, state: "ACTIVE", joined_at: now },
        { thread_id: row.id, user_id: userId, state: decision.asRequest ? "REQUESTED" : "ACTIVE", joined_at: now },
      ],
      trx,
    );
    return row;
  });
  return presentThread(actor, thread);
}

/**
 * Find or create the thread between two people for an accepted approach or an
 * application, both sides ACTIVE (that action is the consent). Runs inside the caller's
 * transaction and returns the thread id. An existing thread keeps its history; a
 * REQUEST thread is upgraded to this context.
 */
export async function openContextThread(initiatorId: string, otherId: string, context: "APPROACH" | "APPLICATION", contextId: string, exec: Executor): Promise<string> {
  const key = pairKey(initiatorId, otherId);
  const now = new Date();
  const inserted = await dmRepo.insertThread({ id: newId(), direct_key: key, context, context_id: contextId, created_by: initiatorId }, exec);
  const thread = inserted ?? (await dmRepo.findDirect(key, exec))!;
  if (!inserted && (thread.context === "REQUEST" || thread.context === "CONNECTION")) await dmRepo.updateThread(thread.id, { context, context_id: contextId }, exec);
  await dmRepo.upsertParticipants(
    [
      { thread_id: thread.id, user_id: initiatorId, state: "ACTIVE", joined_at: now },
      { thread_id: thread.id, user_id: otherId, state: "ACTIVE", joined_at: now },
    ],
    exec,
  );
  await exec.updateTable("dm_participants").set({ archived_at: null }).where("thread_id", "=", thread.id).execute();
  return thread.id;
}

/** Send each user their own view of a thread (viewer-specific fields differ). */
async function pushThread(threadId: string, userIds: string[], event: "dm:request" | "dm:thread:updated"): Promise<void> {
  if (!userIds.length) return;
  const thread = await dmRepo.findThread(threadId);
  if (!thread) return;
  const users = await db.selectFrom("users").select(["id", "username", "display_name", "role", "status"]).where("id", "in", userIds).execute();
  for (const u of users) {
    const view = await presentThread({ id: u.id, username: u.username, displayName: u.display_name, role: u.role, status: u.status }, thread).catch(() => null);
    if (view) realtime.emit([rooms.user(u.id)], event, { thread: view });
  }
}

async function counterpartOf(threadId: string, userId: string, exec: Executor = db): Promise<string | null> {
  const others = (await dmRepo.participants([threadId], exec)).filter((p) => p.user_id !== userId);
  return others[0]?.user_id ?? null;
}

export async function acceptRequest(actor: Actor, threadId: string): Promise<Thread> {
  const { thread, me } = await participantThread(actor, threadId);
  if (me.state !== "REQUESTED") throw badRequest("There is no pending request in this conversation", "NOT_REQUESTED");
  await dmRepo.updateParticipant(thread.id, actor.id, { state: "ACTIVE" });
  const other = await counterpartOf(thread.id, actor.id);
  if (other) await pushThread(thread.id, [other], "dm:thread:updated");
  await pushCounts(actor.id);
  return presentThread(actor, thread);
}

/** Decline: the requester is not told; their next send gets the generic RECIPIENT_CLOSED_REQUESTS. */
export async function declineRequest(actor: Actor, threadId: string): Promise<void> {
  const { thread, me } = await participantThread(actor, threadId);
  if (me.state !== "REQUESTED") throw badRequest("There is no pending request in this conversation", "NOT_REQUESTED");
  await dmRepo.updateParticipant(thread.id, actor.id, { state: "DECLINED" });
  await pushCounts(actor.id);
}

export async function getThread(actor: Actor, threadId: string): Promise<Thread> {
  const { thread } = await participantThread(actor, threadId);
  return presentThread(actor, thread);
}

export async function updateThread(actor: Actor, threadId: string, patch: { mutedUntil?: string | null; archived?: boolean }): Promise<Thread> {
  const { thread } = await participantThread(actor, threadId);
  await dmRepo.updateParticipant(thread.id, actor.id, {
    ...(patch.mutedUntil !== undefined ? { muted_until: patch.mutedUntil ? new Date(patch.mutedUntil) : null } : {}),
    ...(patch.archived !== undefined ? { archived_at: patch.archived ? new Date() : null } : {}),
  });
  if (patch.archived !== undefined) await pushCounts(actor.id);
  return presentThread(actor, (await dmRepo.findThread(thread.id))!);
}

export async function listThreads(actor: Actor, folder: Folder, rawCursor: unknown, limit: number): Promise<Page<Thread>> {
  const rows = await dmRepo.listThreads(actor.id, folder, decodeCursor(rawCursor), limit);
  const page = toPage(rows, limit, (r) => ({ at: r.sort_at, id: r.id }));
  return { items: await presentThreads(actor, page.items), nextCursor: page.nextCursor };
}

export async function unreadSummary(actor: Actor): Promise<{ inbox: number; requests: number }> {
  const rows = await dmRepo.unreadCounts(actor.id, null);
  return inboxTotals(rows.map((r) => ({ state: r.state, unread: Number(r.unread), mutedUntil: r.muted_until })));
}

// ─── Messages ───────────────────────────────────────────────────────────────

/** Re-evaluate, inside the send transaction, whether the actor may post into this thread. */
async function sendDecision(actor: Actor, threadId: string, exec: Executor): Promise<SendDecision> {
  const other = (await dmRepo.participants([threadId], exec)).find((p) => p.user_id !== actor.id);
  if (!other) return { allowed: false, code: "DM_NOT_ALLOWED", reason: "RECIPIENT_UNAVAILABLE" };
  const sentWhilePending = other.state === "REQUESTED" ? await dmRepo.countBySender(threadId, actor.id, exec) : 0;
  const settings = await getSettings(exec);
  return directSendDecision({ eligibility: await eligibility(actor, other.user_id, exec), counterpartState: other.state, sentWhilePending, requestCap: settings.messaging.requestMessageCap });
}

function cleanBody(body: string | undefined | null): string {
  return (body ?? "").replace(/\r\n/g, "\n").trim();
}

/** Rooms that get a thread's message events: both participants (every tab). */
async function deliveryRooms(threadId: string, exec: Executor = db): Promise<string[]> {
  const members = await dmRepo.participants([threadId], exec);
  return members.filter((p) => p.state === "ACTIVE" || p.state === "REQUESTED").map((p) => rooms.user(p.user_id));
}

export async function sendMessage(actor: Actor, threadId: string, input: { body?: string; replyToId?: string | null; mediaIds?: string[] }): Promise<Message> {
  requireActive(actor);
  const body = cleanBody(input.body);
  const mediaIds = [...new Set(input.mediaIds ?? [])];
  if (!body && !mediaIds.length) throw badRequest("Write something or attach a file", "MESSAGE_EMPTY");
  if (body.length > 8000) throw badRequest("Messages can be at most 8000 characters", "MESSAGE_TOO_LONG");
  if (mediaIds.length > MAX_MEDIA_PER_MESSAGE) throw badRequest(`At most ${MAX_MEDIA_PER_MESSAGE} attachments per message`, "TOO_MANY_ATTACHMENTS");
  await consume("dm-send", `u:${actor.id}`, 600, 3600);

  const { message, firstRequest, recipients } = await withTransaction(async (trx, fx) => {
    const { thread, me } = await participantThread(actor, threadId, trx);
    await dmRepo.lockThread(thread.id, trx);
    const decision = await sendDecision(actor, thread.id, trx);
    if (!decision.allowed) throw refuse(decision);

    if (input.replyToId) {
      const parent = await dmRepo.findMessage(input.replyToId, trx);
      if (!parent || parent.thread_id !== thread.id) throw badRequest("You can only reply to a message in this conversation", "REPLY_INVALID");
    }
    const uploads = await claimUploads(actor.id, mediaIds, "DM", trx);
    const row = await dmRepo.insertMessage({ id: newId(), thread_id: thread.id, sender_id: actor.id, body, reply_to_id: input.replyToId ?? null }, trx);
    await dmRepo.insertMessageMedia(
      row.id,
      uploads.map((u) => u.id),
      trx,
    );
    await dmRepo.updateThread(thread.id, { last_message_at: row.created_at }, trx);
    // Replying to a request accepts it; your own message is read by definition; a new
    // message brings an archived thread back to the inbox.
    await dmRepo.updateParticipant(thread.id, actor.id, { last_read_at: row.created_at, archived_at: null, ...(me.state === "REQUESTED" ? { state: "ACTIVE" as const } : {}) }, trx);
    await trx.updateTable("dm_participants").set({ archived_at: null }).where("thread_id", "=", thread.id).where("user_id", "<>", actor.id).where("state", "=", "ACTIVE").execute();

    const members = await dmRepo.participants([thread.id], trx);
    const requestedIds = members.filter((p) => p.user_id !== actor.id && p.state === "REQUESTED").map((p) => p.user_id);
    let firstRequest: string[] = [];
    if (requestedIds.length && (await dmRepo.countBySender(thread.id, actor.id, trx)) === 1) {
      firstRequest = requestedIds;
      for (const id of requestedIds) {
        await notify({ recipientId: id, actorId: actor.id, type: "DM_REQUEST", entityType: "dm_thread", entityId: thread.id, snippet: body || null, data: { threadId: thread.id } }, fx, trx);
      }
    }
    fx.job("moderation.scan", { targetType: "DM_MESSAGE", targetId: row.id });
    const recipients = members.filter((p) => p.state === "ACTIVE" || p.state === "REQUESTED" || p.user_id === actor.id).map((p) => p.user_id);
    return { message: row, firstRequest, recipients };
  });

  const dto = (await loadMessage(message.id, actor.id))!;
  realtime.emit(recipients.map(rooms.user), "dm:message", { threadId, message: dto });
  if (firstRequest.length) await pushThread(threadId, firstRequest, "dm:request");
  for (const id of recipients) if (id !== actor.id) await pushCounts(id);
  return dto;
}

export async function listMessages(actor: Actor, threadId: string, rawCursor: unknown, limit: number): Promise<Page<Message>> {
  await participantThread(actor, threadId);
  const rows = await dmRepo.listMessages(threadId, actor.id, decodeCursor(rawCursor), limit);
  const page = toPage(rows, limit, (r) => ({ at: r.created_at, id: r.id }));
  return { items: await presentMessages(page.items, actor.id), nextCursor: page.nextCursor };
}

export async function markRead(actor: Actor, threadId: string): Promise<void> {
  const { thread } = await participantThread(actor, threadId);
  const at = new Date();
  await dmRepo.updateParticipant(thread.id, actor.id, { last_read_at: at });
  realtime.emit(await deliveryRooms(thread.id), "dm:read", { threadId: thread.id, userId: actor.id, lastReadAt: at.toISOString() });
  await pushCounts(actor.id);
}

/** Load a message whose thread the actor is in. */
async function participantMessage(actor: Actor, messageId: string, exec: Executor = db) {
  const msg = await dmRepo.findMessage(messageId, exec);
  if (!msg) throw notFound("Message not found", "MESSAGE_NOT_FOUND");
  const { thread } = await participantThread(actor, msg.thread_id, exec);
  if (msg.sender_id !== actor.id && (await isBlockedEitherWay(actor.id, msg.sender_id, exec))) throw notFound("Message not found", "MESSAGE_NOT_FOUND");
  return { msg, thread };
}

async function emitUpdated(fx: Effects, threadId: string, messageId: string, viewerId: string, exec: Executor): Promise<Message> {
  const dto = (await loadMessage(messageId, viewerId, exec))!;
  fx.emit(await deliveryRooms(threadId, exec), "dm:message:updated", { threadId, message: dto });
  return dto;
}

export async function editMessage(actor: Actor, messageId: string, body: string): Promise<Message> {
  requireActive(actor);
  const text = cleanBody(body);
  if (text.length > 8000) throw badRequest("Messages can be at most 8000 characters", "MESSAGE_TOO_LONG");
  return withTransaction(async (trx, fx) => {
    const { msg } = await participantMessage(actor, messageId, trx);
    if (msg.sender_id !== actor.id) throw forbidden("You can only edit your own messages");
    if (msg.status === "DELETED") throw badRequest("This message was deleted", "MESSAGE_DELETED");
    if (!text && !(await dmRepo.hasMedia(msg.id, trx))) throw badRequest("Write something or delete the message", "MESSAGE_EMPTY");
    if (text === msg.body) return (await loadMessage(msg.id, actor.id, trx))!;
    await dmRepo.updateMessage(msg.id, { body: text, edited_at: new Date(), moderation_state: "UNCHECKED" }, trx);
    fx.job("moderation.scan", { targetType: "DM_MESSAGE", targetId: msg.id });
    return emitUpdated(fx, msg.thread_id, msg.id, actor.id, trx);
  });
}

export async function deleteMessage(actor: Actor, messageId: string): Promise<void> {
  await withTransaction(async (trx, fx) => {
    const { msg } = await participantMessage(actor, messageId, trx);
    if (msg.sender_id !== actor.id) throw forbidden("You can only delete your own messages");
    if (msg.status === "DELETED") return;
    await dmRepo.updateMessage(msg.id, { status: "DELETED" }, trx);
    fx.emit(await deliveryRooms(msg.thread_id, trx), "dm:message:deleted", { threadId: msg.thread_id, messageId: msg.id });
  });
}

export async function react(actor: Actor, messageId: string, emoji: string, on: boolean): Promise<Message> {
  requireActive(actor);
  return withTransaction(async (trx, fx) => {
    const { msg } = await participantMessage(actor, messageId, trx);
    if (msg.status !== "PUBLISHED") throw badRequest("You cannot react to this message", "MESSAGE_NOT_REACTABLE");
    if (on) await dmRepo.addReaction(msg.id, actor.id, emoji, trx);
    else await dmRepo.removeReaction(msg.id, actor.id, emoji, trx);
    return emitUpdated(fx, msg.thread_id, msg.id, actor.id, trx);
  });
}

export async function searchMessages(actor: Actor, threadId: string, q: string): Promise<Message[]> {
  await participantThread(actor, threadId);
  return presentMessages(await dmRepo.search(threadId, actor.id, q), actor.id);
}

export async function threadMedia(actor: Actor, threadId: string, rawCursor: unknown, limit: number): Promise<Page<Media>> {
  await participantThread(actor, threadId);
  const rows = await dmRepo.media(threadId, actor.id, decodeCursor(rawCursor), limit);
  const page = toPage(rows, limit, (r) => ({ at: r.created_at, id: r.upload_id }));
  const media = await loadMedia(page.items.map((r) => r.upload_id));
  return { items: page.items.map((r) => media.get(r.upload_id)).filter((m): m is Media => !!m), nextCursor: page.nextCursor };
}

// ─── Contacts ───────────────────────────────────────────────────────────────

const CONTACT_LIMIT = 50;

/** Your connections who are active and not blocked, online first: the messaging rail. */
export async function contacts(actor: Actor): Promise<{ user: UserSummary; online: boolean; lastSeenAt: string | null }[]> {
  const rows = await sql<{ id: string; last_seen_at: Date | null }>`
    SELECT u.id, u.last_seen_at FROM connections k
      JOIN users u ON u.id = CASE WHEN k.requester_id = ${actor.id} THEN k.addressee_id ELSE k.requester_id END
     WHERE k.status = 'ACCEPTED' AND (k.requester_id = ${actor.id} OR k.addressee_id = ${actor.id}) AND u.status = 'ACTIVE'
       AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = ${actor.id} AND b.blocked_id = u.id) OR (b.blocked_id = ${actor.id} AND b.blocker_id = u.id))
     ORDER BY u.last_seen_at DESC NULLS LAST, u.id
     LIMIT 500`.execute(db);
  const online = await onlineMap(rows.rows.map((r) => r.id));
  const sorted = [...rows.rows].sort((a, b) => Number(!!online.get(b.id)) - Number(!!online.get(a.id))).slice(0, CONTACT_LIMIT);
  const summaries = await loadSummaries(sorted.map((r) => r.id));
  return sorted.filter((r) => summaries.has(r.id)).map((r) => ({ user: summaries.get(r.id)!, online: !!online.get(r.id), lastSeenAt: r.last_seen_at ? r.last_seen_at.toISOString() : null }));
}
