/**
 * Mention notifications a post skipped while it was not visible. A pre-moderated post
 * (PENDING_REVIEW) notifies nobody when it is written; when a moderator approves it, or
 * a hidden post becomes PUBLISHED again, the people it mentions are told then.
 *
 * Idempotent: anyone who already has a MENTION notification for the post is skipped, so
 * restoring a post that was published before re-notifies nobody. The same reader rule as
 * at creation applies (a CONNECTIONS-only post's text only reaches the author's
 * connections), and notify() drops blocked pairs.
 *
 * Kept apart from post.service.ts so the moderation targets adapter can call it without
 * an import cycle.
 */
import type { Effects } from "../core/effects";
import type { Executor } from "../db/kysely";
import { connectedSet } from "../repositories/visibility";
import { notify } from "./notification.service";

/** Of these users, the ones who can read a post with this visibility. */
export async function postReaders(authorId: string, visibility: "PUBLIC" | "CONNECTIONS", userIds: readonly string[], exec: Executor): Promise<string[]> {
  if (!userIds.length || visibility === "PUBLIC") return [...userIds];
  const connected = await connectedSet(authorId, userIds, exec);
  return userIds.filter((u) => connected.has(u));
}

export async function notifySkippedMentions(postId: string, exec: Executor, fx: Effects): Promise<void> {
  const post = await exec.selectFrom("posts").select(["id", "author_id", "body", "visibility"]).where("id", "=", postId).executeTakeFirst();
  if (!post) return;
  const pending = await exec
    .selectFrom("post_mentions as pm")
    .innerJoin("users as u", "u.id", "pm.user_id")
    .select("pm.user_id")
    .where("pm.post_id", "=", post.id)
    .where("u.status", "=", "ACTIVE")
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom("notifications as n")
            .select("n.id")
            .whereRef("n.recipient_id", "=", "pm.user_id")
            .where("n.type", "=", "MENTION")
            .where("n.entity_type", "=", "post")
            .where("n.entity_id", "=", post.id),
        ),
      ),
    )
    .execute();
  for (const user_id of await postReaders(post.author_id, post.visibility, pending.map((p) => p.user_id), exec)) {
    await notify({ recipientId: user_id, actorId: post.author_id, type: "MENTION", entityType: "post", entityId: post.id, snippet: post.body, data: { postId: post.id } }, fx, exec);
  }
}
