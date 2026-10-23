/** Company rows to DTOs, batched (logos and covers signed in one query). */
import type { Company, CompanySummary, TeamMember } from "@open-talent/types";
import type { Selectable } from "kysely";
import type { Actor } from "../core/context";
import { isStaff } from "../core/context";
import { db, type Executor } from "../db/kysely";
import type { Companies } from "../db/types";
import { displayRating } from "../domain/profile";
import { loadMedia, urlOf } from "./media.presenter";
import { loadSummaries } from "./user.presenter";

export type CompanyRow = Selectable<Companies>;

/** `viewer` decides `viewerFollowing` (one query for the whole batch; false when signed out). */
export async function presentCompanySummaries(rows: readonly CompanyRow[], viewer: Actor | null, exec: Executor = db): Promise<CompanySummary[]> {
  const ids = rows.map((r) => r.id);
  const [media, follows] = await Promise.all([
    loadMedia(rows.map((r) => r.logo_upload_id), exec),
    viewer && ids.length ? exec.selectFrom("company_follows").select("company_id").where("user_id", "=", viewer.id).where("company_id", "in", ids).execute() : Promise.resolve([]),
  ]);
  const followed = new Set(follows.map((f) => f.company_id));
  return rows.map((r) => ({
    id: r.id,
    slug: String(r.slug),
    name: r.name,
    tagline: r.tagline,
    logoUrl: urlOf(media, r.logo_upload_id, "thumb"),
    industry: r.industry,
    sizeBand: r.size_band,
    headquarters: r.headquarters,
    status: r.status,
    followerCount: r.follower_count,
    openJobCount: r.open_job_count,
    viewerFollowing: followed.has(r.id),
  }));
}

export async function presentCompany(viewer: Actor | null, r: CompanyRow, exec: Executor = db): Promise<Company> {
  const [[summary], media, membership] = await Promise.all([
    presentCompanySummaries([r], viewer, exec),
    loadMedia([r.cover_upload_id], exec),
    viewer ? exec.selectFrom("recruiters").select("role").where("user_id", "=", viewer.id).where("company_id", "=", r.id).where("status", "=", "ACTIVE").executeTakeFirst() : Promise.resolve(undefined),
  ]);
  const role = membership?.role ?? null;
  const canManage = role === "OWNER" || role === "ADMIN";
  return {
    ...summary!,
    about: r.about,
    website: r.website,
    foundedYear: r.founded_year,
    coverUrl: urlOf(media, r.cover_upload_id, "full"),
    memberCount: r.member_count,
    rating: { average: displayRating(r.rating_avg === null ? null : Number(r.rating_avg), r.rating_count), count: r.rating_count },
    viewer: { following: summary!.viewerFollowing, role, canManage },
    ...(canManage || isStaff(viewer) || viewer?.role === "RECRUITER_OPS" ? { manage: { domains: r.domains.map(String), autoApproveDomain: r.auto_approve_domain } } : {}),
  };
}

export async function presentTeam(companyId: string, opts: { includePending: boolean }, exec: Executor = db): Promise<TeamMember[]> {
  const rows = await exec
    .selectFrom("recruiters")
    .select(["id", "user_id", "role", "status", "title", "created_at"])
    .where("company_id", "=", companyId)
    .where("status", "in", opts.includePending ? ["ACTIVE", "PENDING_REVIEW", "EMAIL_PENDING"] : ["ACTIVE"])
    .orderBy("role")
    .orderBy("created_at")
    .execute();
  const users = await loadSummaries(rows.map((r) => r.user_id), exec);
  return rows.filter((r) => users.has(r.user_id)).map((r) => ({ recruiterId: r.id, user: users.get(r.user_id)!, role: r.role, status: r.status, title: r.title, joinedAt: r.created_at.toISOString() }));
}
