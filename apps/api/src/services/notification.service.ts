/**
 * Creating notifications. Every module calls `notify` inside its transaction with its
 * Effects buffer; the socket push and the unread badge update go out after commit.
 *
 * Rules applied here so callers cannot forget them:
 *   - never notify yourself
 *   - never notify across a block
 *   - collapse duplicates: the same (recipient, actor, type, entity) within an hour
 *     updates the existing row instead of stacking a new one (reaction toggling)
 *
 * Every change pushes `counts:update` (notifications, unread threads, message requests,
 * pending connection requests) so the header badges stay right in every tab.
 */
import type { Notification, NotificationCounts, NotificationType } from "@open-talent/types";
import { sql } from "kysely";
import type { Effects } from "../core/effects";
import { newId } from "../core/ids";
import { db, type Executor } from "../db/kysely";
import { loadSummaries } from "../presenters/user.presenter";
import { realtime, rooms } from "../realtime/port";
import { isBlockedEitherWay } from "../repositories/visibility";
// The presenter imports hrefFor from this file; the cycle is safe because both sides
// only call each other at run time.
import type { Actor } from "../core/context";
import { notFound } from "../core/errors";
import { presentNotifications } from "../presenters/notification.presenter";
import { decodeTime, timePage, type Paged } from "../repositories/keyset";
import { notificationRepo } from "../repositories/notification.repository";

export interface NotifyInput {
  recipientId: string;
  actorId: string | null;
  type: NotificationType;
  entityType: string;
  entityId: string;
  snippet?: string | null;
  /** Free-form extras for building the link (postId for a comment, slug, threadId...). */
  data?: Record<string, unknown>;
}

/** Where a notification should take the user, from its type and data. */
export function hrefFor(n: { type: NotificationType; entity_type: string; entity_id: string; data: unknown }): string {
  const d = (n.data ?? {}) as Record<string, string | undefined>;
  switch (n.type) {
    case "POST_COMMENT":
    case "COMMENT_REPLY":
    case "COMMENT_REACTION":
      return `/posts/${d.postId ?? n.entity_id}${d.commentId ? `?comment=${d.commentId}` : ""}`;
    case "POST_REACTION":
    case "REPOST":
      return `/posts/${d.postId ?? n.entity_id}`;
    case "MENTION":
      return n.entity_type === "comment" ? `/posts/${d.postId}?comment=${n.entity_id}` : `/posts/${n.entity_id}`;
    case "FOLLOW":
    case "CONNECTION_ACCEPTED":
    case "ENDORSEMENT":
      return `/in/${d.username ?? ""}`;
    case "CONNECTION_REQUEST":
      return "/network?tab=invitations";
    case "COMPANY_FOLLOW":
      return `/company/${d.slug ?? ""}`;
    case "DM_REQUEST":
      return `/messaging/${n.entity_id}`;
    case "APPROACH_RECEIVED":
    case "APPROACH_ACCEPTED":
    case "APPROACH_DECLINED":
    case "CONTACT_REVOKED":
      return d.audience === "recruiter" ? `/recruiter/approaches?open=${n.entity_id}` : `/dashboard/approaches?open=${n.entity_id}`;
    case "JOB_INVITE":
      return `/jobs/${d.jobId ?? ""}`;
    case "APPLICATION_RECEIVED":
      return `/recruiter/jobs/${d.jobId ?? ""}?application=${n.entity_id}`;
    case "APPLICATION_STAGE":
      return `/jobs/applications?open=${n.entity_id}`;
    case "ENGAGEMENT_PROPOSED":
    case "ENGAGEMENT_UPDATED":
    case "RATING_RECEIVED":
      return `/dashboard/engagements?open=${d.engagementId ?? n.entity_id}`;
    case "RECRUITER_APPROVED":
    case "RECRUITER_REJECTED":
      return "/recruiter";
    case "IMPORT_READY":
      return `/profile/import?id=${n.entity_id}`;
    case "COMPLAINT_UPDATED":
      return "/settings?section=complaints";
    case "MODERATION_ACTION":
    case "APPEAL_DECIDED":
      return `/account/moderation/${d.caseId ?? ""}`;
    default:
      return "/notifications";
  }
}

export async function notify(input: NotifyInput, fx: Effects, exec: Executor = db): Promise<void> {
  if (input.actorId && input.actorId === input.recipientId) return;
  if (input.actorId && (await isBlockedEitherWay(input.actorId, input.recipientId, exec))) return;

  const snippet = input.snippet ? input.snippet.replace(/\s+/g, " ").trim().slice(0, 200) : null;
  const data = JSON.stringify(input.data ?? {});

  const recent = await exec
    .selectFrom("notifications")
    .select("id")
    .where("recipient_id", "=", input.recipientId)
    .where("type", "=", input.type)
    .where("entity_id", "=", input.entityId)
    .where((eb) => (input.actorId ? eb("actor_id", "=", input.actorId) : eb("actor_id", "is", null)))
    .where("created_at", ">", sql<Date>`now() - interval '1 hour'`)
    .executeTakeFirst();

  const row = recent
    ? await exec.updateTable("notifications").set({ read_at: null, snippet, data, created_at: new Date() }).where("id", "=", recent.id).returningAll().executeTakeFirstOrThrow()
    : await exec
        .insertInto("notifications")
        .values({
          id: newId(),
          recipient_id: input.recipientId,
          actor_id: input.actorId,
          type: input.type,
          entity_type: input.entityType,
          entity_id: input.entityId,
          snippet,
          data,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

  fx.after(async () => {
    const actors = await loadSummaries([row.actor_id]);
    const dto: Notification = {
      id: row.id,
      type: row.type,
      actor: row.actor_id ? (actors.get(row.actor_id) ?? null) : null,
      entityType: row.entity_type,
      entityId: row.entity_id,
      snippet: row.snippet,
      href: hrefFor(row),
      readAt: null,
      createdAt: row.created_at.toISOString(),
    };
    realtime.emit([rooms.user(row.recipient_id)], "notification:new", dto);
    await pushCounts(row.recipient_id);
  });
}

export async function unreadCount(userId: string, exec: Executor = db): Promise<{ unread: number }> {
  const r = await exec
    .selectFrom("notifications")
    .select((eb) => eb.fn.countAll<number>().as("n"))
    .where("recipient_id", "=", userId)
    .where("read_at", "is", null)
    .executeTakeFirstOrThrow();
  return { unread: Number(r.n) };
}

/** Every header badge in one query. */
export async function countsFor(userId: string, exec: Executor = db): Promise<NotificationCounts> {
  const r = await sql<{ notifications: number; messages: number; message_requests: number; connection_requests: number }>`
    SELECT
      (SELECT count(*)::int FROM notifications WHERE recipient_id = ${userId} AND read_at IS NULL) AS notifications,
      (SELECT count(*)::int FROM dm_participants p JOIN dm_threads t ON t.id = p.thread_id
        WHERE p.user_id = ${userId} AND p.state = 'ACTIVE' AND p.archived_at IS NULL
          AND EXISTS (SELECT 1 FROM dm_messages m WHERE m.thread_id = t.id AND m.sender_id <> ${userId} AND m.status = 'PUBLISHED'
                      AND (p.last_read_at IS NULL OR m.created_at > p.last_read_at))) AS messages,
      (SELECT count(*)::int FROM dm_participants WHERE user_id = ${userId} AND state = 'REQUESTED') AS message_requests,
      (SELECT count(*)::int FROM connections WHERE addressee_id = ${userId} AND status = 'PENDING') AS connection_requests`.execute(exec);
  const row = r.rows[0]!;
  return { notifications: row.notifications, messages: row.messages, messageRequests: row.message_requests, connectionRequests: row.connection_requests };
}

/** Push the current badges to every tab of the user (after commit). */
export async function pushCounts(userId: string): Promise<void> {
  realtime.emit([rooms.user(userId)], "counts:update", await countsFor(userId));
}

// ─── Reading the inbox ──────────────────────────────────────────────────────

export async function listNotifications(actor: Actor, q: { unreadOnly: boolean; cursor?: string; limit: number }): Promise<Paged<Notification>> {
  const page = timePage(await notificationRepo.list(actor.id, { unreadOnly: q.unreadOnly, cursor: decodeTime(q.cursor), limit: q.limit }), q.limit);
  return { items: await presentNotifications(actor, page.items), nextCursor: page.nextCursor };
}

export async function markRead(actor: Actor, id: string): Promise<void> {
  if (!(await notificationRepo.markRead(actor.id, id))) throw notFound("Notification not found");
  await pushCounts(actor.id);
}

export async function markAllRead(actor: Actor): Promise<void> {
  await notificationRepo.markAllRead(actor.id);
  await pushCounts(actor.id);
}
