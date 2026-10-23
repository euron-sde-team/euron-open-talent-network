/**
 * Posts: create (with mentions, media, a job card or a repost), edit, delete, bookmark
 * and hide. Feeds are in feed.service.ts, reactions in reaction.service.ts.
 *
 * Rules:
 *   - Only ACTIVE accounts post. Posting as a company page needs an ACTIVE recruiter of
 *     that company with the OWNER or ADMIN role, and a company that is not suspended.
 *   - A JOB or HIRING post may carry a job only when the author recruits for the job's
 *     company and the job is OPEN.
 *   - Only PUBLIC posts can be reposted, and a repost is always of the original (never
 *     a repost of a repost), so CONNECTIONS-only text never travels further.
 *   - A held post (pre-moderation) is PENDING_REVIEW: visible to its author and staff
 *     only, not counted, no feed signal. Its PREMODERATION case opens in the same
 *     transaction; mentions are sent on approval.
 *   - Mentions notify only people who can read the post (connections, for a
 *     CONNECTIONS-only post), so its text never reaches anyone else in a snippet.
 */
import type { Post, PostKind, PostVisibility } from "@open-talent/types";
import { sql } from "kysely";
import type { Actor } from "../core/context";
import { isStaff, requireActive } from "../core/context";
import { withTransaction, type Effects } from "../core/effects";
import { badRequest, conflict, forbidden, notFound } from "../core/errors";
import { newId } from "../core/ids";
import { db, type Executor } from "../db/kysely";
import { newMentions, parseMentions } from "../domain/mentions";
import { presentPost } from "../presenters/post.presenter";
import { rooms } from "../realtime/port";
import { postRepo, type PostRow } from "../repositories/post.repository";
import { areConnected, isBlockedEitherWay } from "../repositories/visibility";
import * as counters from "./counters.service";
import { claimUploads } from "./media-attach.service";
import { openCaseFor } from "./moderation/cases.service";
import { recordModeratorRemoval } from "./moderation/removal";
import { loadTarget } from "./moderation/targets";
import { notify } from "./notification.service";
import { postReaders } from "./post-mentions.service";
import { requiresPremoderation } from "./premoderation.service";

export interface CreatePostInput {
  body: string;
  kind?: PostKind;
  visibility?: PostVisibility;
  /** Post as this company page. */
  companyId?: string;
  jobId?: string;
  mediaIds?: string[];
  sharedPostId?: string;
}

/**
 * Load a post the viewer may see. 404 (never 403) when it does not exist, is deleted
 * or removed, is CONNECTIONS-only and the viewer is not connected, or is by someone with
 * a block either way. PENDING_REVIEW and HIDDEN posts are visible to their author and
 * staff only, unless `publishedOnly`.
 */
export async function loadReadablePost(viewer: Actor | null, postId: string, exec: Executor = db, opts: { publishedOnly?: boolean; lock?: boolean } = {}): Promise<PostRow> {
  const post = opts.lock ? await postRepo.findByIdForUpdate(postId, exec) : await postRepo.findById(postId, exec);
  if (!post || post.status === "DELETED" || post.status === "REMOVED") throw notFound("Post not found");
  const staff = isStaff(viewer);
  const isAuthor = viewer?.id === post.author_id;
  if (viewer && !isAuthor && (await isBlockedEitherWay(viewer.id, post.author_id, exec))) throw notFound("Post not found");
  if (post.visibility === "CONNECTIONS" && !isAuthor && !staff) {
    if (!viewer || !(await areConnected(viewer.id, post.author_id, exec))) throw notFound("Post not found");
  }
  if (post.company_id && !staff) {
    const company = await exec.selectFrom("companies").select("status").where("id", "=", post.company_id).executeTakeFirst();
    if (!company || company.status === "SUSPENDED") throw notFound("Post not found");
  }
  if (post.status !== "PUBLISHED") {
    const allowed = !opts.publishedOnly && (isAuthor || staff);
    if (!allowed) throw notFound("Post not found");
  }
  return post;
}

/** Resolve @usernames to user ids: existing, active accounts with no block against the author. */
export async function resolveMentions(authorId: string, usernames: readonly string[], exec: Executor): Promise<string[]> {
  if (!usernames.length) return [];
  const rows = await exec.selectFrom("users").select(["id", "username"]).where("username", "in", [...usernames]).where("status", "=", "ACTIVE").execute();
  const out: string[] = [];
  for (const r of rows) {
    if (r.id === authorId) continue;
    if (await isBlockedEitherWay(authorId, r.id, exec)) continue;
    out.push(r.id);
  }
  return out;
}

export async function notifyMentions(
  actor: Actor,
  post: Pick<PostRow, "author_id" | "visibility">,
  userIds: readonly string[],
  target: { entityType: "post" | "comment"; entityId: string; postId: string; snippet: string },
  fx: Effects,
  exec: Executor,
): Promise<void> {
  for (const recipientId of await postReaders(post.author_id, post.visibility, userIds, exec)) {
    await notify({ recipientId, actorId: actor.id, type: "MENTION", entityType: target.entityType, entityId: target.entityId, snippet: target.snippet, data: { postId: target.postId } }, fx, exec);
  }
}

/** The company the actor may post as (OWNER or ADMIN of an unsuspended company), or a 403. */
async function companyForPosting(actor: Actor, companyId: string, exec: Executor): Promise<string> {
  const row = await exec
    .selectFrom("recruiters as r")
    .innerJoin("companies as c", "c.id", "r.company_id")
    .select(["c.id"])
    .where("r.user_id", "=", actor.id)
    .where("r.company_id", "=", companyId)
    .where("r.status", "=", "ACTIVE")
    .where("r.role", "in", ["OWNER", "ADMIN"])
    .where("c.status", "<>", "SUSPENDED")
    .executeTakeFirst();
  if (!row) throw forbidden("Only page admins can post as this company", "NOT_COMPANY_ADMIN");
  return row.id;
}

/** A job the actor recruits for and that is OPEN, or a 400. */
async function jobForPosting(actor: Actor, jobId: string, exec: Executor): Promise<{ id: string; company_id: string }> {
  const job = await exec
    .selectFrom("jobs as j")
    .innerJoin("recruiters as r", (j) => j.onRef("r.company_id", "=", "j.company_id").on("r.user_id", "=", actor.id).on("r.status", "=", "ACTIVE"))
    .select(["j.id", "j.company_id"])
    .where("j.id", "=", jobId)
    .where("j.status", "=", "OPEN")
    .where("j.content_status", "=", "PUBLISHED")
    .executeTakeFirst();
  if (!job) throw badRequest("You can only share open jobs of your own company", "JOB_NOT_SHAREABLE");
  return job;
}

export async function create(actor: Actor, input: CreatePostInput): Promise<Post> {
  requireActive(actor);
  const row = await withTransaction(async (trx, fx) => {
    const body = input.body ?? "";
    const kind = input.kind ?? (input.jobId ? "JOB" : "POST");
    const visibility = input.visibility ?? "PUBLIC";
    if (!body.trim() && !input.mediaIds?.length && !input.sharedPostId && !input.jobId) throw badRequest("Write something first", "EMPTY_POST");
    if (input.jobId && kind !== "JOB" && kind !== "HIRING") throw badRequest("A job can only be attached to a JOB or HIRING post", "JOB_KIND_MISMATCH");
    if (kind === "JOB" && !input.jobId) throw badRequest("Choose the job to share", "JOB_REQUIRED");

    const companyId = input.companyId ? await companyForPosting(actor, input.companyId, trx) : null;
    const job = input.jobId ? await jobForPosting(actor, input.jobId, trx) : null;
    if (job && companyId && job.company_id !== companyId) throw badRequest("That job belongs to another company", "JOB_NOT_SHAREABLE");

    let sharedId: string | null = null;
    if (input.sharedPostId) {
      const shared = await loadReadablePost(actor, input.sharedPostId, trx, { publishedOnly: true });
      const root = shared.shared_post_id ? await loadReadablePost(actor, shared.shared_post_id, trx, { publishedOnly: true }) : shared;
      if (root.visibility !== "PUBLIC") throw badRequest("Only public posts can be reposted", "SHARE_NOT_ALLOWED");
      sharedId = root.id;
    }

    const media = await claimUploads(actor.id, input.mediaIds ?? [], "POST", trx);
    const held = await requiresPremoderation(actor, trx);
    const post = await postRepo.insert(
      {
        id: newId(),
        author_id: actor.id,
        company_id: companyId,
        kind,
        visibility,
        body,
        job_id: job?.id ?? null,
        shared_post_id: sharedId,
        status: held ? "PENDING_REVIEW" : "PUBLISHED",
        created_at: new Date(),
      },
      trx,
    );
    const mentioned = await resolveMentions(actor.id, parseMentions(body), trx);
    await postRepo.setMentions(post.id, mentioned, trx);
    await postRepo.insertMedia(
      post.id,
      media.map((m) => m.id),
      trx,
    );

    if (post.status === "PUBLISHED") {
      await counters.postPublished(post, trx);
      await notifyMentions(actor, post, mentioned, { entityType: "post", entityId: post.id, postId: post.id, snippet: body }, fx, trx);
      if (sharedId) {
        const original = await postRepo.findById(sharedId, trx);
        if (original) await notify({ recipientId: original.author_id, actorId: actor.id, type: "REPOST", entityType: "post", entityId: post.id, snippet: body || original.body, data: { postId: post.id } }, fx, trx);
      }
      fx.job("feed.fanout", { postId: post.id });
    } else {
      // Held for review: the case opens with the post, so it reaches the queue even when
      // moderation is off or the provider is failing. Mentions wait for the approval.
      const info = await loadTarget("POST", post.id, trx);
      if (info) await openCaseFor(info, "PREMODERATION", {}, trx, fx);
    }
    fx.job("moderation.scan", { targetType: "POST", targetId: post.id });
    return post;
  });
  return presentPost(actor, row);
}

export async function get(viewer: Actor | null, postId: string): Promise<Post> {
  return presentPost(viewer, await loadReadablePost(viewer, postId));
}

export async function update(actor: Actor, postId: string, patch: { body?: string; visibility?: PostVisibility }): Promise<Post> {
  requireActive(actor);
  const row = await withTransaction(async (trx, fx) => {
    const post = await loadReadablePost(actor, postId, trx, { lock: true });
    if (post.author_id !== actor.id) throw forbidden("Only the author can edit this post", "NOT_AUTHOR");
    if (post.status === "HIDDEN") throw conflict("This post is under review and cannot be edited", "POST_UNDER_REVIEW");
    const body = patch.body ?? post.body;
    if (patch.body !== undefined && !body.trim()) {
      const hasOther = !!post.shared_post_id || !!post.job_id || !!(await trx.selectFrom("post_media").select("upload_id").where("post_id", "=", post.id).executeTakeFirst());
      if (!hasOther) throw badRequest("Write something first", "EMPTY_POST");
    }
    const visibility = patch.visibility ?? post.visibility;
    const updated = await postRepo.update(post.id, { body, visibility, edited_at: patch.body !== undefined && patch.body !== post.body ? new Date() : post.edited_at }, trx);
    if (patch.body !== undefined && patch.body !== post.body) {
      const mentioned = await resolveMentions(actor.id, parseMentions(body), trx);
      await postRepo.setMentions(post.id, mentioned, trx);
      if (updated.status === "PUBLISHED") {
        const fresh = await resolveMentions(actor.id, newMentions(post.body, body), trx);
        await notifyMentions(actor, updated, fresh, { entityType: "post", entityId: post.id, postId: post.id, snippet: body }, fx, trx);
      }
      fx.job("moderation.scan", { targetType: "POST", targetId: post.id });
    }
    return updated;
  });
  return presentPost(actor, row);
}

/**
 * The author (or an admin of the company page it was posted as) deletes it: DELETED.
 * Staff removing someone else's post marks it REMOVED and leaves a moderation record.
 */
export async function remove(actor: Actor, postId: string): Promise<void> {
  requireActive(actor);
  await withTransaction(async (trx, fx) => {
    const post = await loadReadablePost(actor, postId, trx, { lock: true });
    const isAuthor = post.author_id === actor.id;
    const pageAdmin = post.company_id ? !!(await trx.selectFrom("recruiters").select("id").where("user_id", "=", actor.id).where("company_id", "=", post.company_id).where("status", "=", "ACTIVE").where("role", "in", ["OWNER", "ADMIN"]).executeTakeFirst()) : false;
    const staff = isStaff(actor);
    if (!isAuthor && !pageAdmin && !staff) throw forbidden("You cannot delete this post", "NOT_AUTHOR");
    const byModerator = !isAuthor && !pageAdmin;
    await postRepo.update(post.id, { status: byModerator ? "REMOVED" : "DELETED" }, trx);
    if (post.status === "PUBLISHED") await counters.postUnpublished(post, trx);
    if (byModerator) await recordModeratorRemoval(actor.id, { type: "POST", id: post.id, reason: "Removed by a moderator", auditAction: "post.remove" }, trx);
    fx.emit([rooms.post(post.id)], "post:removed", { postId: post.id });
  });
}

export async function bookmark(actor: Actor, postId: string): Promise<void> {
  await loadReadablePost(actor, postId, db, { publishedOnly: true });
  await postRepo.bookmark(actor.id, postId);
}

export async function unbookmark(actor: Actor, postId: string): Promise<void> {
  await postRepo.unbookmark(actor.id, postId);
}

export async function hide(actor: Actor, postId: string): Promise<void> {
  await loadReadablePost(actor, postId, db, { publishedOnly: true });
  await postRepo.hide(actor.id, postId);
}

/**
 * feed.fanout: tell the author's network (connections and followers, capped) that a
 * new post exists. Only a signal; the feed query decides what each person sees.
 */
export async function fanOut(postId: string, emit: (userIds: string[], latestId: string) => void, cap = 2000): Promise<number> {
  const post = await postRepo.findById(postId);
  if (!post || post.status !== "PUBLISHED") return 0;
  const r = await sql<{ uid: string }>`
    SELECT uid FROM (
      SELECT CASE WHEN requester_id = ${post.author_id} THEN addressee_id ELSE requester_id END AS uid
        FROM connections WHERE status = 'ACCEPTED' AND (requester_id = ${post.author_id} OR addressee_id = ${post.author_id})
      UNION
      SELECT follower_id FROM follows WHERE followee_id = ${post.author_id}
      UNION
      SELECT user_id FROM company_follows WHERE company_id = ${post.company_id}
    ) audience LIMIT ${cap}`.execute(db);
  const ids = r.rows.map((row) => row.uid).filter((u) => u !== post.author_id);
  if (ids.length) emit(ids, post.id);
  return ids.length;
}
