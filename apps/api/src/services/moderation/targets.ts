/**
 * One adapter per moderation target type, so the scan pipeline, reports, case actions
 * and appeals treat a post, a job posting or a profile the same way:
 *
 *   load        text, attached images, author and current status
 *   visibleTo   may this person see it (reports answer 404 otherwise)
 *   setStatus   change the status and, in the same transaction, the denormalised
 *               counters ("counts include PUBLISHED only") and the realtime signals
 *
 * Every content target speaks ContentStatus to the moderation module. Targets with
 * their own lifecycle are mapped:
 *
 *   PROFILE   PUBLISHED/UNLISTED/DRAFT read as PUBLISHED, SUSPENDED as HIDDEN. Hiding
 *             (or removing) suspends the profile and revokes every live contact unlock;
 *             restoring sets it to UNLISTED, so its owner republishes deliberately.
 *   COMPANY   SUSPENDED reads as HIDDEN. Restoring returns it to VERIFIED when it had
 *             been verified, UNVERIFIED otherwise.
 *   JOB       uses jobs.content_status directly; the open-job counter follows it.
 *   APPROACH  PENDING/ACCEPTED read as PUBLISHED, anything else as HIDDEN. Hiding a
 *             pending approach withdraws it (it disappears from the candidate's inbox).
 *
 * USER targets are loaded and checked here too; account actions (warn, suspend, ban)
 * live in actions.service.ts.
 */
import type { ContentStatus, ModerationState, ModerationTarget, UserStatus } from "@open-talent/types";
import { sql } from "kysely";
import type { Actor } from "../../core/context";
import type { Effects } from "../../core/effects";
import { db, type Executor } from "../../db/kysely";
import { loadMessages } from "../../presenters/message.presenter";
import { realtime, rooms } from "../../realtime/port";
import { canReadPost, notBlocked } from "../../repositories/visibility";
import * as counters from "../counters.service";
import { notifySkippedMentions } from "../post-mentions.service";

export const CONTENT_TARGETS = ["POST", "COMMENT", "DM_MESSAGE", "PROFILE", "COMPANY", "JOB", "APPROACH"] as const;
export type ContentTarget = (typeof CONTENT_TARGETS)[number];

export function isContentTarget(t: ModerationTarget): t is ContentTarget {
  return (CONTENT_TARGETS as readonly string[]).includes(t);
}

export interface TargetInfo {
  type: ModerationTarget;
  id: string;
  authorId: string | null;
  status: ContentStatus | UserStatus;
  title?: string;
  text: string;
  /** Every attached upload (snapshot) and the image subset (scanned). */
  mediaIds: string[];
  imageIds: string[];
  createdAt: Date;
  /** Parent pointers needed for counters and events. */
  postId?: string;
  parentId?: string | null;
  threadId?: string;
  companyId?: string;
  sharedPostId?: string | null;
}

async function attached(table: "post_media" | "dm_message_media", key: "post_id" | "message_id", id: string, exec: Executor) {
  const { rows } = await sql<{ id: string; kind: string }>`
    SELECT mu.id, mu.kind FROM ${sql.table(table)} am JOIN media_uploads mu ON mu.id = am.upload_id
    WHERE ${sql.ref(`am.${key}`)} = ${id} ORDER BY am.position`.execute(exec);
  return { mediaIds: rows.map((r) => r.id), imageIds: rows.filter((r) => r.kind === "IMAGE").map((r) => r.id) };
}

async function single(uploadId: string | null, exec: Executor) {
  if (!uploadId) return { mediaIds: [], imageIds: [] };
  const row = await exec.selectFrom("media_uploads").select(["id", "kind"]).where("id", "=", uploadId).executeTakeFirst();
  return { mediaIds: row ? [row.id] : [], imageIds: row?.kind === "IMAGE" ? [row.id] : [] };
}

const join = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join("\n");

export async function loadTarget(type: ModerationTarget, id: string, exec: Executor = db): Promise<TargetInfo | null> {
  switch (type) {
    case "POST": {
      const r = await exec.selectFrom("posts").select(["id", "author_id", "company_id", "shared_post_id", "status", "body", "created_at"]).where("id", "=", id).executeTakeFirst();
      if (!r) return null;
      return { type, id, authorId: r.author_id, status: r.status, text: r.body, createdAt: r.created_at, companyId: r.company_id ?? undefined, sharedPostId: r.shared_post_id, ...(await attached("post_media", "post_id", id, exec)) };
    }
    case "COMMENT": {
      const r = await exec.selectFrom("comments").select(["id", "author_id", "status", "body", "created_at", "post_id", "parent_id", "upload_id"]).where("id", "=", id).executeTakeFirst();
      if (!r) return null;
      return { type, id, authorId: r.author_id, status: r.status, text: r.body, createdAt: r.created_at, postId: r.post_id, parentId: r.parent_id, ...(await single(r.upload_id, exec)) };
    }
    case "DM_MESSAGE": {
      const r = await exec.selectFrom("dm_messages").select(["id", "sender_id", "thread_id", "status", "body", "created_at"]).where("id", "=", id).executeTakeFirst();
      if (!r) return null;
      return { type, id, authorId: r.sender_id, status: r.status, text: r.body, createdAt: r.created_at, threadId: r.thread_id, ...(await attached("dm_message_media", "message_id", id, exec)) };
    }
    case "PROFILE": {
      const r = await exec
        .selectFrom("talent_profiles as p")
        .innerJoin("users as u", "u.id", "p.user_id")
        .select(["p.id", "p.user_id", "p.status", "p.headline", "p.about", "p.current_title", "p.search_text", "p.created_at", "u.display_name", "u.avatar_upload_id"])
        .where("p.id", "=", id)
        .executeTakeFirst();
      if (!r) return null;
      return {
        type,
        id,
        authorId: r.user_id,
        status: r.status === "SUSPENDED" ? "HIDDEN" : "PUBLISHED",
        title: r.display_name,
        text: join(r.display_name, r.headline, r.current_title, r.about, r.search_text),
        createdAt: r.created_at,
        ...(await single(r.avatar_upload_id, exec)),
      };
    }
    case "COMPANY": {
      const r = await exec.selectFrom("companies").select(["id", "created_by", "status", "name", "tagline", "about", "website", "created_at", "logo_upload_id"]).where("id", "=", id).executeTakeFirst();
      if (!r) return null;
      return { type, id, authorId: r.created_by, status: r.status === "SUSPENDED" ? "HIDDEN" : "PUBLISHED", title: r.name, text: join(r.name, r.tagline, r.about, r.website), createdAt: r.created_at, companyId: r.id, ...(await single(r.logo_upload_id, exec)) };
    }
    case "JOB": {
      const r = await exec
        .selectFrom("jobs as j")
        .innerJoin("recruiters as r", "r.id", "j.posted_by")
        .select(["j.id", "j.company_id", "j.content_status", "j.title", "j.description", "j.location", "j.created_at", "r.user_id"])
        .where("j.id", "=", id)
        .executeTakeFirst();
      if (!r) return null;
      return { type, id, authorId: r.user_id, status: r.content_status, title: r.title, text: join(r.title, r.description, r.location), createdAt: r.created_at, companyId: r.company_id, mediaIds: [], imageIds: [] };
    }
    case "APPROACH": {
      const r = await exec
        .selectFrom("approaches as a")
        .innerJoin("recruiters as r", "r.id", "a.recruiter_id")
        .select(["a.id", "a.status", "a.role_title", "a.message", "a.created_at", "a.company_id", "r.user_id"])
        .where("a.id", "=", id)
        .executeTakeFirst();
      if (!r) return null;
      return { type, id, authorId: r.user_id, status: r.status === "PENDING" || r.status === "ACCEPTED" ? "PUBLISHED" : "HIDDEN", title: r.role_title, text: join(r.role_title, r.message), createdAt: r.created_at, companyId: r.company_id, mediaIds: [], imageIds: [] };
    }
    case "USER": {
      const r = await exec
        .selectFrom("users as u")
        .leftJoin("talent_profiles as p", "p.user_id", "u.id")
        .select(["u.id", "u.status", "u.display_name", "u.created_at", "u.avatar_upload_id", "p.headline", "p.about"])
        .where("u.id", "=", id)
        .executeTakeFirst();
      if (!r) return null;
      return { type, id, authorId: r.id, status: r.status, title: r.display_name, text: join(r.display_name, r.headline, r.about), createdAt: r.created_at, ...(await single(r.avatar_upload_id, exec)) };
    }
  }
}

/** Whether `viewer` can currently see the target. Reports on anything else are a 404. */
export async function visibleTo(viewer: Actor, info: TargetInfo, exec: Executor = db): Promise<boolean> {
  const one = async (q: { executeTakeFirst(): Promise<unknown> }) => !!(await q.executeTakeFirst());
  switch (info.type) {
    case "POST":
      return one(exec.selectFrom("posts as p").select("p.id").where("p.id", "=", info.id).where("p.status", "=", "PUBLISHED").where(canReadPost(viewer, "p")).where(notBlocked(viewer.id, "p.author_id")));
    case "COMMENT":
      return one(
        exec
          .selectFrom("comments")
          .innerJoin("posts as p", "p.id", "comments.post_id")
          .select("comments.id")
          .where("comments.id", "=", info.id)
          .where("comments.status", "=", "PUBLISHED")
          .where("p.status", "=", "PUBLISHED")
          .where(canReadPost(viewer, "p"))
          .where(notBlocked(viewer.id, "comments.author_id")),
      );
    case "DM_MESSAGE":
      return one(
        exec
          .selectFrom("dm_messages")
          .innerJoin("dm_participants as dp", (j) => j.onRef("dp.thread_id", "=", "dm_messages.thread_id").on("dp.user_id", "=", viewer.id))
          .select("dm_messages.id")
          .where("dm_messages.id", "=", info.id)
          .where("dm_messages.status", "=", "PUBLISHED"),
      );
    case "PROFILE":
      return one(exec.selectFrom("talent_profiles as p").select("p.id").where("p.id", "=", info.id).where("p.status", "in", ["PUBLISHED", "UNLISTED"]).where(notBlocked(viewer.id, "p.user_id")));
    case "COMPANY":
      return info.status === "PUBLISHED";
    case "JOB":
      return one(exec.selectFrom("jobs").select("id").where("id", "=", info.id).where("content_status", "=", "PUBLISHED").where("status", "<>", "DRAFT"));
    case "APPROACH":
      // Only its candidate can see (and so report) an approach.
      return one(exec.selectFrom("approaches").select("id").where("id", "=", info.id).where("candidate_id", "=", viewer.id));
    case "USER":
      return info.status !== "DEACTIVATED" && info.status !== "PENDING_VERIFICATION" && one(exec.selectFrom("users").select("id").where("id", "=", info.id).where(notBlocked(viewer.id, "users.id")));
  }
}

/** Tables with a moderation_state column, per target. */
const STATE_TABLE: Partial<Record<ModerationTarget, string>> = { POST: "posts", COMMENT: "comments", DM_MESSAGE: "dm_messages", JOB: "jobs", APPROACH: "approaches" };

/** Record the classifier outcome on the content row (and its scanned images). */
export async function setModerationState(info: TargetInfo, state: ModerationState, exec: Executor = db): Promise<void> {
  const table = STATE_TABLE[info.type];
  if (table) await sql`UPDATE ${sql.table(table)} SET moderation_state = ${state}::moderation_state WHERE id = ${info.id}`.execute(exec);
  if (info.imageIds.length) await exec.updateTable("media_uploads").set({ moderation_state: state }).where("id", "in", info.imageIds).execute();
}

/** Identical bodies by the same author in the same table in the last 10 minutes, this one included. */
export async function recentDuplicates(info: TargetInfo, exec: Executor = db): Promise<number> {
  if (!info.authorId || !info.text.trim()) return 0;
  const spec: Partial<Record<ModerationTarget, { table: string; author: string }>> = {
    POST: { table: "posts", author: "author_id" },
    COMMENT: { table: "comments", author: "author_id" },
    DM_MESSAGE: { table: "dm_messages", author: "sender_id" },
  };
  const s = spec[info.type];
  if (!s) return 0;
  const r = await sql<{ n: number }>`
    SELECT count(*)::int AS n FROM ${sql.table(s.table)}
    WHERE ${sql.ref(s.author)} = ${info.authorId} AND body = ${info.text} AND created_at > now() - interval '10 minutes'`.execute(exec);
  return Number(r.rows[0]?.n ?? 0);
}

const dec = (col: string) => sql<number>`GREATEST(${sql.ref(col)} - 1, 0)`;

/** Talent targets with their own lifecycle (see the header). Returns false on a concurrent change. */
async function setLifecycleStatus(info: TargetInfo, next: ContentStatus, exec: Executor): Promise<boolean> {
  const hide = next !== "PUBLISHED";
  const now = new Date();
  switch (info.type) {
    case "PROFILE": {
      const res = hide
        ? await exec.updateTable("talent_profiles").set({ status: "SUSPENDED", suspended_reason: "Hidden by a moderator", updated_at: now }).where("id", "=", info.id).where("status", "<>", "SUSPENDED").executeTakeFirst()
        : await exec.updateTable("talent_profiles").set({ status: "UNLISTED", suspended_reason: null, updated_at: now }).where("id", "=", info.id).where("status", "=", "SUSPENDED").executeTakeFirst();
      if (Number(res.numUpdatedRows) !== 1) return false;
      if (hide && info.authorId) {
        await exec.updateTable("contact_unlocks").set({ revoked_at: now, revoked_reason: "Profile suspended" }).where("candidate_id", "=", info.authorId).where("revoked_at", "is", null).execute();
      }
      return true;
    }
    case "COMPANY": {
      const res = hide
        ? await exec.updateTable("companies").set({ status: "SUSPENDED", suspended_reason: "Hidden by a moderator", updated_at: now }).where("id", "=", info.id).where("status", "<>", "SUSPENDED").executeTakeFirst()
        : await exec
            .updateTable("companies")
            .set({ status: sql<"VERIFIED" | "UNVERIFIED">`CASE WHEN verified_at IS NOT NULL THEN 'VERIFIED'::company_status ELSE 'UNVERIFIED'::company_status END`, suspended_reason: null, updated_at: now })
            .where("id", "=", info.id)
            .where("status", "=", "SUSPENDED")
            .executeTakeFirst();
      return Number(res.numUpdatedRows) === 1;
    }
    case "APPROACH": {
      if (!hide) return true;
      // FLAGGED takes it out of the recruiter's daily count, so a moderator's hide refunds
      // the quota exactly like the classifier's.
      await exec.updateTable("approaches").set({ status: "WITHDRAWN", responded_at: now, moderation_state: "FLAGGED" }).where("id", "=", info.id).where("status", "=", "PENDING").execute();
      return true;
    }
    default:
      return false;
  }
}

/**
 * Move content to `next`. Returns false when the status was already different from
 * what the caller loaded (a concurrent change), so nothing is double-counted.
 */
export async function setContentStatus(info: TargetInfo, next: ContentStatus, exec: Executor, fx: Effects): Promise<boolean> {
  if (!isContentTarget(info.type)) return false;
  const prev = info.status as ContentStatus;
  if (prev === next) return true;
  if (info.type === "PROFILE" || info.type === "COMPANY" || info.type === "APPROACH") {
    const ok = await setLifecycleStatus(info, next, exec);
    if (ok) info.status = next;
    return ok;
  }

  const table = { POST: "posts", COMMENT: "comments", DM_MESSAGE: "dm_messages", JOB: "jobs" }[info.type];
  const column = info.type === "JOB" ? "content_status" : "status";
  const res = await sql`UPDATE ${sql.table(table)} SET ${sql.ref(column)} = ${next}::content_status WHERE id = ${info.id} AND ${sql.ref(column)} = ${prev}::content_status`.execute(exec);
  if (Number(res.numAffectedRows ?? 0) !== 1) return false;
  info.status = next;

  const delta = prev === "PUBLISHED" ? -1 : next === "PUBLISHED" ? 1 : 0;
  const bump = (col: string) => (delta < 0 ? dec(col) : sql<number>`${sql.ref(col)} + 1`);
  if (delta !== 0) {
    switch (info.type) {
      case "POST": {
        const post = { id: info.id, author_id: info.authorId as string, shared_post_id: info.sharedPostId ?? null };
        await (delta > 0 ? counters.postPublished(post, exec) : counters.postUnpublished(post, exec));
        break;
      }
      case "COMMENT":
        await exec.updateTable("posts").set({ comment_count: bump("comment_count") }).where("id", "=", info.postId as string).execute();
        if (info.parentId) await exec.updateTable("comments").set({ reply_count: bump("reply_count") }).where("id", "=", info.parentId).execute();
        break;
      case "JOB":
        await counters.refreshOpenJobs(info.companyId as string, exec);
        break;
      default:
        break;
    }
  }

  const leaving = prev === "PUBLISHED" && next !== "PUBLISHED";
  const returning = next === "PUBLISHED" && prev !== "PUBLISHED";
  switch (info.type) {
    case "POST":
      if (leaving) fx.emit([rooms.post(info.id)], "post:removed", { postId: info.id });
      // An approved pre-moderated post (or one restored) tells the people it mentions now.
      if (returning) await notifySkippedMentions(info.id, exec, fx);
      break;
    case "DM_MESSAGE": {
      const threadId = info.threadId as string;
      const participants = await exec.selectFrom("dm_participants").select("user_id").where("thread_id", "=", threadId).where("state", "in", ["ACTIVE", "REQUESTED"]).execute();
      const targets = participants.map((p) => rooms.user(p.user_id));
      if (leaving) fx.emit(targets, "dm:message:deleted", { threadId, messageId: info.id });
      if (returning)
        fx.after(async () => {
          const [message] = await loadMessages([info.id], null);
          if (message) realtime.emit(targets, "dm:message:updated", { threadId, message });
        });
      break;
    }
    default:
      break;
  }
  return true;
}
