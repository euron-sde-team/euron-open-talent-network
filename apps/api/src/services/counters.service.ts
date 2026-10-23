/**
 * Denormalised counters. Writes adjust them in the same transaction as the row they
 * count; `reconcileCounters` (the maintenance.reconcile-counters job) recomputes them
 * from the rows themselves and touches only rows that drifted.
 *
 * Definitions (shared with the moderation module's status changes):
 *   users.post_count             PUBLISHED posts by the user
 *   users.connection_count       ACCEPTED connections
 *   users.follower/following     follows rows
 *   posts.comment_count          PUBLISHED comments on the post, replies included
 *   posts.repost_count           PUBLISHED posts sharing it
 *   comments.reply_count         PUBLISHED replies
 *   reaction_count/_counts       reaction rows
 *   companies.member_count       ACTIVE recruiters
 *   companies.follower_count     company_follows rows
 *   companies.open_job_count     OPEN, PUBLISHED jobs
 *   jobs.application_count       applications that were not WITHDRAWN
 *   profile_skills.endorsement_count  skill_endorsements rows
 */
import { sql } from "kysely";
import { db, type Executor } from "../db/kysely";
import type { PostRow } from "../repositories/post.repository";

/** A post became visible (created PUBLISHED, or approved). */
export async function postPublished(post: Pick<PostRow, "id" | "author_id" | "shared_post_id">, exec: Executor): Promise<void> {
  await exec.updateTable("users").set({ post_count: sql`post_count + 1` }).where("id", "=", post.author_id).execute();
  if (post.shared_post_id) await exec.updateTable("posts").set({ repost_count: sql`repost_count + 1` }).where("id", "=", post.shared_post_id).execute();
}

/** A visible post went away (deleted, hidden or removed). */
export async function postUnpublished(post: Pick<PostRow, "id" | "author_id" | "shared_post_id">, exec: Executor): Promise<void> {
  await exec.updateTable("users").set({ post_count: sql`greatest(0, post_count - 1)` }).where("id", "=", post.author_id).execute();
  if (post.shared_post_id) await exec.updateTable("posts").set({ repost_count: sql`greatest(0, repost_count - 1)` }).where("id", "=", post.shared_post_id).execute();
}

/** Recompute a company's open-job count (cheap: one indexed count). */
export async function refreshOpenJobs(companyId: string, exec: Executor): Promise<void> {
  await sql`UPDATE companies SET open_job_count = (SELECT count(*)::int FROM jobs WHERE company_id = ${companyId} AND status = 'OPEN' AND content_status = 'PUBLISHED') WHERE id = ${companyId}`.execute(exec);
}

/** Run every reconciliation statement; returns how many rows each one corrected. */
export async function reconcileCounters(exec: Executor = db): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const run = async (name: string, query: ReturnType<typeof sql>) => {
    const r = await query.execute(exec);
    out[name] = Number(r.numAffectedRows ?? 0);
  };

  await run(
    "users",
    sql`WITH p AS (SELECT author_id AS id, count(*)::int AS n FROM posts WHERE status = 'PUBLISHED' GROUP BY 1),
             fr AS (SELECT followee_id AS id, count(*)::int AS n FROM follows GROUP BY 1),
             fg AS (SELECT follower_id AS id, count(*)::int AS n FROM follows GROUP BY 1),
             k AS (SELECT id, count(*)::int AS n FROM (SELECT requester_id AS id FROM connections WHERE status = 'ACCEPTED'
                                                       UNION ALL SELECT addressee_id FROM connections WHERE status = 'ACCEPTED') x GROUP BY 1)
        UPDATE users u SET post_count = coalesce(p.n, 0), follower_count = coalesce(fr.n, 0), following_count = coalesce(fg.n, 0), connection_count = coalesce(k.n, 0)
        FROM users u2 LEFT JOIN p ON p.id = u2.id LEFT JOIN fr ON fr.id = u2.id LEFT JOIN fg ON fg.id = u2.id LEFT JOIN k ON k.id = u2.id
        WHERE u2.id = u.id AND (u.post_count <> coalesce(p.n, 0) OR u.follower_count <> coalesce(fr.n, 0) OR u.following_count <> coalesce(fg.n, 0) OR u.connection_count <> coalesce(k.n, 0))`,
  );

  await run(
    "posts",
    sql`WITH cm AS (SELECT post_id, count(*)::int AS n FROM comments WHERE status = 'PUBLISHED' GROUP BY 1),
             rp AS (SELECT shared_post_id AS post_id, count(*)::int AS n FROM posts WHERE status = 'PUBLISHED' AND shared_post_id IS NOT NULL GROUP BY 1),
             rt AS (SELECT post_id, type::text AS type, count(*)::int AS n FROM post_reactions GROUP BY 1, 2),
             r AS (SELECT post_id, sum(n)::int AS n, jsonb_object_agg(type, n) AS counts FROM rt GROUP BY 1)
        UPDATE posts p SET comment_count = coalesce(cm.n, 0), repost_count = coalesce(rp.n, 0), reaction_count = coalesce(r.n, 0), reaction_counts = coalesce(r.counts, '{}'::jsonb)
        FROM posts p2 LEFT JOIN cm ON cm.post_id = p2.id LEFT JOIN rp ON rp.post_id = p2.id LEFT JOIN r ON r.post_id = p2.id
        WHERE p2.id = p.id AND (p.comment_count <> coalesce(cm.n, 0) OR p.repost_count <> coalesce(rp.n, 0) OR p.reaction_count <> coalesce(r.n, 0) OR p.reaction_counts <> coalesce(r.counts, '{}'::jsonb))`,
  );

  await run(
    "comments",
    sql`WITH rp AS (SELECT parent_id AS id, count(*)::int AS n FROM comments WHERE status = 'PUBLISHED' AND parent_id IS NOT NULL GROUP BY 1),
             rt AS (SELECT comment_id, type::text AS type, count(*)::int AS n FROM comment_reactions GROUP BY 1, 2),
             r AS (SELECT comment_id, sum(n)::int AS n, jsonb_object_agg(type, n) AS counts FROM rt GROUP BY 1)
        UPDATE comments c SET reply_count = coalesce(rp.n, 0), reaction_count = coalesce(r.n, 0), reaction_counts = coalesce(r.counts, '{}'::jsonb)
        FROM comments c2 LEFT JOIN rp ON rp.id = c2.id LEFT JOIN r ON r.comment_id = c2.id
        WHERE c2.id = c.id AND (c.reply_count <> coalesce(rp.n, 0) OR c.reaction_count <> coalesce(r.n, 0) OR c.reaction_counts <> coalesce(r.counts, '{}'::jsonb))`,
  );

  await run(
    "companies",
    sql`WITH m AS (SELECT company_id AS id, count(*)::int AS n FROM recruiters WHERE status = 'ACTIVE' GROUP BY 1),
             f AS (SELECT company_id AS id, count(*)::int AS n FROM company_follows GROUP BY 1),
             j AS (SELECT company_id AS id, count(*)::int AS n FROM jobs WHERE status = 'OPEN' AND content_status = 'PUBLISHED' GROUP BY 1)
        UPDATE companies c SET member_count = coalesce(m.n, 0), follower_count = coalesce(f.n, 0), open_job_count = coalesce(j.n, 0)
        FROM companies c2 LEFT JOIN m ON m.id = c2.id LEFT JOIN f ON f.id = c2.id LEFT JOIN j ON j.id = c2.id
        WHERE c2.id = c.id AND (c.member_count <> coalesce(m.n, 0) OR c.follower_count <> coalesce(f.n, 0) OR c.open_job_count <> coalesce(j.n, 0))`,
  );

  await run(
    "jobs",
    sql`WITH a AS (SELECT job_id AS id, count(*)::int AS n FROM applications WHERE stage <> 'WITHDRAWN' GROUP BY 1)
        UPDATE jobs j SET application_count = coalesce(a.n, 0)
        FROM jobs j2 LEFT JOIN a ON a.id = j2.id
        WHERE j2.id = j.id AND j.application_count <> coalesce(a.n, 0)`,
  );

  await run(
    "skills",
    sql`WITH e AS (SELECT skill_id AS id, count(*)::int AS n FROM skill_endorsements GROUP BY 1)
        UPDATE profile_skills s SET endorsement_count = coalesce(e.n, 0)
        FROM profile_skills s2 LEFT JOIN e ON e.id = s2.id
        WHERE s2.id = s.id AND s.endorsement_count <> coalesce(e.n, 0)`,
  );

  await run(
    "profile_approaches",
    sql`WITH a AS (SELECT candidate_id AS id, count(*)::int AS n FROM approaches GROUP BY 1)
        UPDATE talent_profiles p SET approach_count = coalesce(a.n, 0)
        FROM talent_profiles p2 LEFT JOIN a ON a.id = p2.user_id
        WHERE p2.id = p.id AND p.approach_count <> coalesce(a.n, 0)`,
  );
  return out;
}
