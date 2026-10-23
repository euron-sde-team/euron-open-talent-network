/**
 * Post rows to DTOs. A whole page is presented with a fixed number of queries: one per
 * relation (authors, company pages, jobs, mentions, media, shared posts, viewer
 * reactions, bookmarks, blocks), never one per post.
 *
 * Mentions of people the viewer has a block with are dropped. A shared post is
 * presented only if the viewer may see it (otherwise `sharedPost` is null).
 */
import type { Post, ReactionCounts, ReactionType } from "@open-talent/types";
import { REACTIONS } from "@open-talent/types";
import type { Actor } from "../core/context";
import { isStaff } from "../core/context";
import { db, type Executor } from "../db/kysely";
import { postRepo, type PostRow } from "../repositories/post.repository";
import { reactionRepo } from "../repositories/reaction.repository";
import { blockedSet } from "../repositories/visibility";
import { loadMedia, urlOf } from "./media.presenter";
import { loadSummaries } from "./user.presenter";

export function toReactionCounts(raw: unknown): ReactionCounts {
  const out: ReactionCounts = {};
  if (!raw || typeof raw !== "object") return out;
  for (const type of REACTIONS) {
    const n = Number((raw as Record<string, unknown>)[type] ?? 0);
    if (n > 0) out[type as ReactionType] = n;
  }
  return out;
}

async function companiesAndJobs(companyIds: readonly string[], jobIds: readonly string[], exec: Executor) {
  const [companies, jobs] = await Promise.all([
    companyIds.length ? exec.selectFrom("companies").select(["id", "slug", "name", "logo_upload_id", "status"]).where("id", "in", [...new Set(companyIds)]).execute() : Promise.resolve([]),
    jobIds.length
      ? exec
          .selectFrom("jobs as j")
          .innerJoin("companies as c", "c.id", "j.company_id")
          .select(["j.id", "j.title", "j.workplace_type", "j.employment_type", "j.location", "j.status", "j.content_status", "c.id as company_id", "c.slug", "c.name", "c.logo_upload_id", "c.status as company_status"])
          .where("j.id", "in", [...new Set(jobIds)])
          .execute()
      : Promise.resolve([]),
  ]);
  return { companies, jobs };
}

export async function presentPosts(viewer: Actor | null, rows: readonly PostRow[], exec: Executor = db, depth = 0): Promise<Post[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const sharedIds = depth === 0 ? rows.map((r) => r.shared_post_id).filter((x): x is string => !!x) : [];

  const [mentions, mediaLinks, reactions, bookmarks, blocked, sharedRows, related, managed] = await Promise.all([
    postRepo.mentionsFor(ids, exec),
    postRepo.mediaFor(ids, exec),
    reactionRepo.viewerReactions("post", viewer?.id, ids, exec),
    postRepo.bookmarkedSet(viewer?.id, ids, exec),
    viewer ? blockedSet(viewer.id, exec) : Promise.resolve(new Set<string>()),
    sharedIds.length ? postRepo.visibleByIds(viewer, sharedIds, exec) : Promise.resolve([] as PostRow[]),
    companiesAndJobs(
      rows.map((r) => r.company_id).filter((x): x is string => !!x),
      rows.map((r) => r.job_id).filter((x): x is string => !!x),
      exec,
    ),
    // Company pages the viewer administers: they may delete posts made as that page.
    viewer ? exec.selectFrom("recruiters").select("company_id").where("user_id", "=", viewer.id).where("status", "=", "ACTIVE").where("role", "in", ["OWNER", "ADMIN"]).execute() : Promise.resolve([]),
  ]);

  const visibleMentionIds = mentions.filter((m) => !blocked.has(m.user_id));
  const [users, media, shared] = await Promise.all([
    loadSummaries([...rows.map((r) => r.author_id), ...visibleMentionIds.map((m) => m.user_id)], exec),
    loadMedia([...mediaLinks.map((m) => m.upload_id), ...related.companies.map((c) => c.logo_upload_id), ...related.jobs.map((j) => j.logo_upload_id)], exec),
    sharedRows.length ? presentPosts(viewer, sharedRows, exec, depth + 1) : Promise.resolve([] as Post[]),
  ]);

  const sharedById = new Map(shared.map((p) => [p.id, p]));
  const companyById = new Map(related.companies.map((c) => [c.id, c]));
  const jobById = new Map(related.jobs.map((j) => [j.id, j]));
  const managedCompanies = new Set(managed.map((m) => m.company_id));
  const staff = isStaff(viewer);

  const out: Post[] = [];
  for (const r of rows) {
    const author = users.get(r.author_id);
    if (!author) continue;
    const isAuthor = viewer?.id === r.author_id;
    const active = viewer?.status === "ACTIVE";
    const company = r.company_id ? companyById.get(r.company_id) : undefined;
    const job = r.job_id ? jobById.get(r.job_id) : undefined;
    const pageAdmin = !!r.company_id && managedCompanies.has(r.company_id);
    out.push({
      id: r.id,
      kind: r.kind,
      visibility: r.visibility,
      author,
      company: company ? { id: company.id, slug: String(company.slug), name: company.name, logoUrl: urlOf(media, company.logo_upload_id, "thumb") } : null,
      body: r.body,
      mentions: visibleMentionIds
        .filter((m) => m.post_id === r.id)
        .map((m) => users.get(m.user_id))
        .filter((u): u is NonNullable<typeof u> => !!u),
      media: mediaLinks
        .filter((m) => m.post_id === r.id)
        .map((m) => media.get(m.upload_id))
        .filter((m): m is NonNullable<typeof m> => !!m),
      // A job card shows only while the job is visible (published, company not suspended).
      job:
        job && job.content_status === "PUBLISHED" && job.company_status !== "SUSPENDED"
          ? {
              id: job.id,
              title: job.title,
              workplaceType: job.workplace_type,
              employmentType: job.employment_type,
              location: job.location,
              status: job.status,
              company: { id: job.company_id, slug: String(job.slug), name: job.name, logoUrl: urlOf(media, job.logo_upload_id, "thumb"), status: job.company_status },
            }
          : null,
      sharedPost: r.shared_post_id ? (sharedById.get(r.shared_post_id) ?? null) : null,
      status: r.status,
      reactionCount: r.reaction_count,
      reactionCounts: toReactionCounts(r.reaction_counts),
      commentCount: r.comment_count,
      repostCount: r.repost_count,
      createdAt: r.created_at.toISOString(),
      editedAt: r.edited_at?.toISOString() ?? null,
      viewer: {
        reaction: reactions.get(r.id) ?? null,
        bookmarked: bookmarks.has(r.id),
        canEdit: isAuthor && active && r.status !== "REMOVED" && r.status !== "DELETED",
        canDelete: (active && (isAuthor || pageAdmin)) || staff,
        canModerate: staff,
      },
    });
  }
  return out;
}

export async function presentPost(viewer: Actor | null, row: PostRow, exec: Executor = db): Promise<Post> {
  const [p] = await presentPosts(viewer, [row], exec);
  if (!p) throw new Error(`post ${row.id} could not be presented`);
  return p;
}
