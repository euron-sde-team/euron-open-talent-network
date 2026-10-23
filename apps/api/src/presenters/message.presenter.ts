/**
 * DM message rows to `Message`. Batched: one query each for media, reactions, reply
 * previews and senders, whatever the page size.
 *
 * What a viewer sees of a message depends on its status:
 *   PUBLISHED        everything
 *   DELETED          a tombstone: empty body, no media, no reactions
 *   HIDDEN, REMOVED  the sender still sees their own words (so they can appeal);
 *                    everyone else gets the tombstone
 */
import type { ContentStatus, Media, Message, MessageReactionSummary } from "@open-talent/types";
import { sql } from "kysely";
import { db, type Executor } from "../db/kysely";
import { loadMedia } from "./media.presenter";
import { loadSummaries } from "./user.presenter";

export interface MessageRow {
  id: string;
  thread_id: string;
  sender_id: string;
  body: string;
  reply_to_id: string | null;
  status: ContentStatus;
  edited_at: Date | null;
  created_at: Date;
}

function visibleTo(row: { status: ContentStatus; sender_id: string }, viewerId: string | null): boolean {
  if (row.status === "PUBLISHED") return true;
  if (row.status === "DELETED") return false;
  return row.sender_id === viewerId;
}

/** Select message rows by id in the given order. */
export async function findMessageRows(ids: readonly string[], exec: Executor = db): Promise<MessageRow[]> {
  if (!ids.length) return [];
  const rows = await exec.selectFrom("dm_messages").select(["id", "thread_id", "sender_id", "body", "reply_to_id", "status", "edited_at", "created_at"]).where("id", "in", [...ids]).execute();
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => byId.get(id)).filter((r): r is MessageRow => !!r);
}

const DELETED_SENDER = { username: "deleted", displayName: "Deleted user", avatarUrl: null, headline: null, role: "USER" as const, openToWork: false, recruiterAt: null };

export async function presentMessages(rows: readonly MessageRow[], viewerId: string | null, exec: Executor = db): Promise<Message[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);

  const mediaLinks = await exec.selectFrom("dm_message_media").select(["message_id", "upload_id"]).where("message_id", "in", ids).orderBy("message_id").orderBy("position").execute();
  const reactionRows = await sql<{ message_id: string; emoji: string; n: number; mine: boolean }>`
    SELECT message_id, emoji, count(*)::int AS n, bool_or(user_id = ${viewerId ?? ""}) AS mine
    FROM dm_reactions WHERE message_id = ANY(${ids}::text[])
    GROUP BY message_id, emoji ORDER BY message_id, min(created_at)`.execute(exec);
  const replyIds = [...new Set(rows.map((r) => r.reply_to_id).filter((x): x is string => !!x))];
  const replies = await findMessageRows(replyIds, exec);

  const [media, senders] = await Promise.all([loadMedia(mediaLinks.map((l) => l.upload_id), exec), loadSummaries([...rows.map((r) => r.sender_id), ...replies.map((r) => r.sender_id)], exec)]);

  const mediaByMessage = new Map<string, Media[]>();
  for (const l of mediaLinks) {
    const m = media.get(l.upload_id);
    if (!m) continue;
    const list = mediaByMessage.get(l.message_id) ?? [];
    list.push(m);
    mediaByMessage.set(l.message_id, list);
  }
  const reactionsByMessage = new Map<string, MessageReactionSummary[]>();
  for (const r of reactionRows.rows) {
    const list = reactionsByMessage.get(r.message_id) ?? [];
    list.push({ emoji: r.emoji, count: Number(r.n), reactedByViewer: !!r.mine });
    reactionsByMessage.set(r.message_id, list);
  }
  const replyById = new Map(replies.map((r) => [r.id, r]));

  return rows.map((row): Message => {
    const shown = visibleTo(row, viewerId);
    const reply = row.reply_to_id ? replyById.get(row.reply_to_id) : undefined;
    return {
      id: row.id,
      threadId: row.thread_id,
      sender: senders.get(row.sender_id) ?? { id: row.sender_id, ...DELETED_SENDER },
      body: shown ? row.body : "",
      media: shown ? (mediaByMessage.get(row.id) ?? []) : [],
      replyTo: reply ? { id: reply.id, body: visibleTo(reply, viewerId) ? reply.body.slice(0, 200) : "", senderName: senders.get(reply.sender_id)?.displayName ?? "Deleted user" } : null,
      reactions: row.status === "PUBLISHED" ? (reactionsByMessage.get(row.id) ?? []) : [],
      status: row.status,
      createdAt: row.created_at.toISOString(),
      editedAt: row.edited_at ? row.edited_at.toISOString() : null,
    };
  });
}

/** Load and present messages by id, preserving the order given. */
export async function loadMessages(ids: string[], viewerId: string | null, exec: Executor = db): Promise<Message[]> {
  return presentMessages(await findMessageRows(ids, exec), viewerId, exec);
}

export async function loadMessage(id: string, viewerId: string | null, exec: Executor = db): Promise<Message | null> {
  return (await loadMessages([id], viewerId, exec))[0] ?? null;
}
