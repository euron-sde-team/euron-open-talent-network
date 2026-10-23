/**
 * Posts and their mentions, media, bookmarks and hides. Every list starts from
 * `visible()`, which applies the visibility rules (PUBLISHED, CONNECTIONS-only posts
 * for connections, blocks both ways, suspended company pages hidden), so no feed can
 * forget one.
 *
 * The home feed is your network: your own posts, people you are connected to, people
 * you follow, companies you follow, and the company you recruit for. "top" ranks the
 * last TOP_WINDOW_DAYS by (reactions + COMMENT_WEIGHT * comments).
 */
import type { Insertable, Selectable, Updateable } from "kysely";
import { sql } from "kysely";
import type { Actor } from "../core/context";
import { db, type Executor } from "../db/kysely";
import type { Posts } from "../db/types";
import { COMMENT_WEIGHT, TOP_WINDOW_DAYS } from "../domain/ranking";
import { atKey, belowScore, olderThan, type ScoreKey, type TimeKey } from "./keyset";
import { tsMatches } from "./text-search";
import { canReadPost, notBlocked } from "./visibility";

export type PostRow = Selectable<Posts>;
export type ListedPost = PostRow & { _at: string; _score?: number };

export const topScoreSql = sql<number>`((p.reaction_count + ${sql.lit(COMMENT_WEIGHT)} * p.comment_count)::float8)`;

export class PostRepository {
  /** The visible-posts base query, aliased `p`. */
  visible(viewer: Actor | null, exec: Executor = db) {
    return exec
      .selectFrom("posts as p")
      .selectAll("p")
      .select(atKey("p.created_at"))
      .where("p.status", "=", "PUBLISHED")
      .where(notBlocked(viewer?.id, "p.author_id"))
      .where(canReadPost(viewer, "p"))
      .where((eb) => eb.or([eb("p.company_id", "is", null), eb.exists(eb.selectFrom("companies as pc").select("pc.id").whereRef("pc.id", "=", "p.company_id").where("pc.status", "<>", "SUSPENDED"))]));
  }

  findById(id: string, exec: Executor = db) {
    return exec.selectFrom("posts").selectAll().where("id", "=", id).executeTakeFirst();
  }

  findByIdForUpdate(id: string, exec: Executor) {
    return exec.selectFrom("posts").selectAll().where("id", "=", id).forUpdate().executeTakeFirst();
  }

  visibleByIds(viewer: Actor | null, ids: readonly string[], exec: Executor = db): Promise<ListedPost[]> {
    if (!ids.length) return Promise.resolve([]);
    return this.visible(viewer, exec).where("p.id", "in", [...new Set(ids)]).execute();
  }

  async homeFeed(viewer: Actor, opts: { sort: "latest" | "top"; time: TimeKey | null; score: ScoreKey | null; limit: number }, exec: Executor = db): Promise<ListedPost[]> {
    const me = viewer.id;
    const q = this.visible(viewer, exec)
      .where((eb) =>
        eb.or([
          eb("p.author_id", "=", me),
          eb.exists(
            eb
              .selectFrom("connections as k")
              .select("k.id")
              .where("k.status", "=", "ACCEPTED")
              .where((w) => w.or([w.and([w("k.requester_id", "=", me), w("k.addressee_id", "=", w.ref("p.author_id"))]), w.and([w("k.addressee_id", "=", me), w("k.requester_id", "=", w.ref("p.author_id"))])])),
          ),
          eb.exists(eb.selectFrom("follows as f").select("f.followee_id").where("f.follower_id", "=", me).whereRef("f.followee_id", "=", "p.author_id")),
          eb.exists(eb.selectFrom("company_follows as cf").select("cf.company_id").where("cf.user_id", "=", me).whereRef("cf.company_id", "=", "p.company_id")),
          eb.exists(eb.selectFrom("recruiters as rr").select("rr.id").where("rr.user_id", "=", me).where("rr.status", "=", "ACTIVE").whereRef("rr.company_id", "=", "p.company_id")),
        ]),
      )
      .where((eb) => eb.not(eb.exists(eb.selectFrom("post_hides as h").select("h.post_id").where("h.user_id", "=", me).whereRef("h.post_id", "=", "p.id"))));
    if (opts.sort === "latest") {
      return q.where(olderThan("p.created_at", "p.id", opts.time)).orderBy("p.created_at", "desc").orderBy("p.id", "desc").limit(opts.limit + 1).execute();
    }
    return q
      .select(topScoreSql.as("_score"))
      .where("p.created_at", ">", sql<Date>`now() - ${sql.lit(`${TOP_WINDOW_DAYS} days`)}::interval`)
      .where(belowScore(topScoreSql, "p.id", opts.score))
      .orderBy(topScoreSql, "desc")
      .orderBy("p.id", "desc")
      .limit(opts.limit + 1)
      .execute();
  }

  /**
   * Suggested posts for a thin network: recent PUBLIC posts with the most engagement,
   * from people the viewer is not connected to and does not follow (new accounts would
   * otherwise see an empty feed).
   */
  suggested(viewer: Actor, limit: number, exec: Executor = db): Promise<ListedPost[]> {
    return this.visible(viewer, exec)
      .where("p.visibility", "=", "PUBLIC")
      .where("p.author_id", "<>", viewer.id)
      .where("p.created_at", ">", sql<Date>`now() - interval '14 days'`)
      .where((eb) => eb.not(eb.exists(eb.selectFrom("post_hides as h").select("h.post_id").where("h.user_id", "=", viewer.id).whereRef("h.post_id", "=", "p.id"))))
      .select(topScoreSql.as("_score"))
      .orderBy(topScoreSql, "desc")
      .orderBy("p.id", "desc")
      .limit(limit)
      .execute();
  }

  /** A profile's activity. The author also sees their own pending and hidden posts. */
  byAuthor(viewer: Actor | null, authorId: string, cursor: TimeKey | null, limit: number, exec: Executor = db) {
    const own = viewer?.id === authorId;
    return exec
      .selectFrom("posts as p")
      .selectAll("p")
      .select(atKey("p.created_at"))
      .where("p.author_id", "=", authorId)
      .where("p.company_id", "is", null)
      .where("p.status", "in", own ? ["PUBLISHED", "PENDING_REVIEW", "HIDDEN"] : ["PUBLISHED"])
      .where(notBlocked(viewer?.id, "p.author_id"))
      .where(canReadPost(viewer, "p"))
      .where(olderThan("p.created_at", "p.id", cursor))
      .orderBy("p.created_at", "desc")
      .orderBy("p.id", "desc")
      .limit(limit + 1)
      .execute();
  }

  byCompany(viewer: Actor | null, companyId: string, cursor: TimeKey | null, limit: number, exec: Executor = db) {
    return this.visible(viewer, exec)
      .where("p.company_id", "=", companyId)
      .where(olderThan("p.created_at", "p.id", cursor))
      .orderBy("p.created_at", "desc")
      .orderBy("p.id", "desc")
      .limit(limit + 1)
      .execute();
  }

  search(viewer: Actor | null, q: string, limit: number, exec: Executor = db) {
    return this.visible(viewer, exec).where(tsMatches("p.search", q)).orderBy("p.created_at", "desc").orderBy("p.id", "desc").limit(limit).execute();
  }

  bookmarks(viewer: Actor, cursor: TimeKey | null, limit: number, exec: Executor = db) {
    return this.visible(viewer, exec)
      .innerJoin("post_bookmarks as b", "b.post_id", "p.id")
      .select(atKey("b.created_at", "_bat"))
      .where("b.user_id", "=", viewer.id)
      .where(olderThan("b.created_at", "b.post_id", cursor))
      .orderBy("b.created_at", "desc")
      .orderBy("b.post_id", "desc")
      .limit(limit + 1)
      .execute();
  }

  insert(row: Insertable<Posts>, exec: Executor = db) {
    return exec.insertInto("posts").values(row).returningAll().executeTakeFirstOrThrow();
  }

  update(id: string, patch: Updateable<Posts>, exec: Executor = db) {
    return exec
      .updateTable("posts")
      .set({ ...patch, updated_at: new Date() })
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  adjustComments(id: string, delta: number, exec: Executor = db) {
    if (!delta) return Promise.resolve(undefined);
    return exec
      .updateTable("posts")
      .set({ comment_count: sql`greatest(0, comment_count + ${delta})` })
      .where("id", "=", id)
      .returning(["id", "reaction_count", "reaction_counts", "comment_count"])
      .executeTakeFirst();
  }

  // ─── Mentions, media, bookmarks, hides ────────────────────────────────────

  async setMentions(postId: string, userIds: readonly string[], exec: Executor = db): Promise<void> {
    await exec.deleteFrom("post_mentions").where("post_id", "=", postId).execute();
    if (userIds.length) await exec.insertInto("post_mentions").values(userIds.map((user_id) => ({ post_id: postId, user_id }))).execute();
  }

  mentionsFor(postIds: readonly string[], exec: Executor = db) {
    if (!postIds.length) return Promise.resolve([]);
    return exec.selectFrom("post_mentions").select(["post_id", "user_id"]).where("post_id", "in", [...postIds]).execute();
  }

  async insertMedia(postId: string, uploadIds: readonly string[], exec: Executor = db): Promise<void> {
    if (!uploadIds.length) return;
    await exec
      .insertInto("post_media")
      .values(uploadIds.map((upload_id, position) => ({ post_id: postId, upload_id, position })))
      .execute();
  }

  mediaFor(postIds: readonly string[], exec: Executor = db) {
    if (!postIds.length) return Promise.resolve([]);
    return exec.selectFrom("post_media").select(["post_id", "upload_id", "position"]).where("post_id", "in", [...postIds]).orderBy("position").execute();
  }

  async bookmarkedSet(userId: string | null | undefined, postIds: readonly string[], exec: Executor = db): Promise<Set<string>> {
    if (!userId || !postIds.length) return new Set();
    const rows = await exec.selectFrom("post_bookmarks").select("post_id").where("user_id", "=", userId).where("post_id", "in", [...postIds]).execute();
    return new Set(rows.map((r) => r.post_id));
  }

  async bookmark(userId: string, postId: string, exec: Executor = db): Promise<void> {
    await exec.insertInto("post_bookmarks").values({ user_id: userId, post_id: postId }).onConflict((oc) => oc.columns(["user_id", "post_id"]).doNothing()).execute();
  }

  async unbookmark(userId: string, postId: string, exec: Executor = db): Promise<void> {
    await exec.deleteFrom("post_bookmarks").where("user_id", "=", userId).where("post_id", "=", postId).execute();
  }

  async hide(userId: string, postId: string, exec: Executor = db): Promise<void> {
    await exec.insertInto("post_hides").values({ user_id: userId, post_id: postId }).onConflict((oc) => oc.columns(["user_id", "post_id"]).doNothing()).execute();
  }
}

export const postRepo = new PostRepository();
