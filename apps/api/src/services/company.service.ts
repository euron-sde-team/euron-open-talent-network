/**
 * Company pages: the public page, edits by page admins (OWNER, ADMIN), the team
 * (roles, removal), follows and the list of companies.
 *
 * A SUSPENDED company is a 404 to everyone but staff and its own team, and its jobs
 * and posts disappear from every list (post and job repositories filter on it).
 * Domains and the auto-approve switch are management fields: only page admins and
 * operators see or change them, and only operators can verify a company
 * (admin.service.ts).
 */
import type { Company, CompanySummary, Page, TeamMember, UserSummary } from "@open-talent/types";
import { sql } from "kysely";
import type { Actor } from "../core/context";
import { isStaff, requireActive } from "../core/context";
import { withTransaction } from "../core/effects";
import { badRequest, conflict, forbidden, notFound } from "../core/errors";
import { db } from "../db/kysely";
import { baseDomain, safeUrl } from "../domain/safe-url";
import { likeContains } from "../domain/search-text";
import { presentCompany, presentCompanySummaries, presentTeam, type CompanyRow } from "../presenters/company.presenter";
import { loadSummaries } from "../presenters/user.presenter";
import { atKey, belowScore, decodeScore, decodeTime, encodeScore, encodeTime, olderThan, pageBy } from "../repositories/keyset";
import { tsMatches } from "../repositories/text-search";
import { audit } from "./audit.service";
import { claimSingle } from "./media-attach.service";
import { notify } from "./notification.service";
import { leaveCompanyJobRooms, requireCompanyAdmin, requireRecruiter } from "./recruiter.service";

async function bySlug(viewer: Actor | null, slug: string): Promise<CompanyRow> {
  const row = await db.selectFrom("companies").selectAll().where("slug", "=", slug).executeTakeFirst();
  if (!row) throw notFound("Company not found", "COMPANY_NOT_FOUND");
  if (row.status === "SUSPENDED" && !isStaff(viewer) && viewer?.role !== "RECRUITER_OPS") {
    const member = viewer ? await db.selectFrom("recruiters").select("id").where("user_id", "=", viewer.id).where("company_id", "=", row.id).executeTakeFirst() : undefined;
    if (!member) throw notFound("Company not found", "COMPANY_NOT_FOUND");
  }
  return row;
}

export async function get(viewer: Actor | null, slug: string): Promise<Company> {
  return presentCompany(viewer, await bySlug(viewer, slug));
}

export interface CompanyPatch {
  name?: string;
  tagline?: string | null;
  about?: string | null;
  website?: string | null;
  industry?: string | null;
  sizeBand?: string | null;
  headquarters?: string | null;
  foundedYear?: number | null;
  logoUploadId?: string | null;
  coverUploadId?: string | null;
  domains?: string[];
  autoApproveDomain?: boolean;
}

export async function update(actor: Actor, slug: string, p: CompanyPatch): Promise<Company> {
  const r = await requireRecruiter(actor);
  requireCompanyAdmin(r);
  const company = await bySlug(actor, slug);
  if (company.id !== r.company_id) throw forbidden("You can only edit your own company page", "NOT_COMPANY_ADMIN");
  const website = p.website === undefined ? undefined : p.website ? safeUrl(p.website) : null;
  if (p.website && !website) throw badRequest("The website is not a valid address", "URL_INVALID");
  let domains: string[] | undefined;
  if (p.domains !== undefined) {
    domains = [...new Set(p.domains.map((d) => baseDomain(d.trim())).filter((d): d is string => !!d))].slice(0, 10);
    // Changing the proving domains of a verified company sends it back for review.
  }
  const logo = p.logoUploadId === undefined ? undefined : await claimSingle(actor.id, p.logoUploadId, "COMPANY_LOGO");
  const cover = p.coverUploadId === undefined ? undefined : await claimSingle(actor.id, p.coverUploadId, "COMPANY_COVER");
  await withTransaction(async (trx, fx) => {
    const domainsChanged = domains !== undefined && JSON.stringify([...domains].sort()) !== JSON.stringify(company.domains.map(String).sort());
    await trx
      .updateTable("companies")
      .set({
        ...(p.name !== undefined ? { name: p.name } : {}),
        ...(p.tagline !== undefined ? { tagline: p.tagline } : {}),
        ...(p.about !== undefined ? { about: p.about } : {}),
        ...(website !== undefined ? { website } : {}),
        ...(p.industry !== undefined ? { industry: p.industry } : {}),
        ...(p.sizeBand !== undefined ? { size_band: p.sizeBand } : {}),
        ...(p.headquarters !== undefined ? { headquarters: p.headquarters } : {}),
        ...(p.foundedYear !== undefined ? { founded_year: p.foundedYear } : {}),
        ...(logo !== undefined ? { logo_upload_id: logo } : {}),
        ...(cover !== undefined ? { cover_upload_id: cover } : {}),
        ...(domains !== undefined ? { domains } : {}),
        ...(p.autoApproveDomain !== undefined ? { auto_approve_domain: p.autoApproveDomain } : {}),
        ...(domainsChanged && company.status === "VERIFIED" ? { status: "UNVERIFIED" as const, verified_at: null, verified_by: null } : {}),
        updated_at: new Date(),
      })
      .where("id", "=", company.id)
      .execute();
    await audit({ actorId: actor.id, action: "company.update", entityType: "company", entityId: company.id, data: { fields: Object.keys(p), domainsChanged } }, trx);
    if (p.name !== undefined || p.tagline !== undefined || p.about !== undefined || p.website !== undefined) fx.job("moderation.scan", { targetType: "COMPANY", targetId: company.id });
  });
  return get(actor, slug);
}

export async function team(viewer: Actor | null, slug: string): Promise<TeamMember[]> {
  const company = await bySlug(viewer, slug);
  const manager = viewer ? await db.selectFrom("recruiters").select("role").where("user_id", "=", viewer.id).where("company_id", "=", company.id).where("status", "=", "ACTIVE").executeTakeFirst() : undefined;
  const includePending = isStaff(viewer) || viewer?.role === "RECRUITER_OPS" || manager?.role === "OWNER" || manager?.role === "ADMIN";
  return presentTeam(company.id, { includePending });
}

/** OWNER (and ADMIN for RECRUITER roles) changes a teammate's role. The last owner cannot be demoted. */
export async function setMemberRole(actor: Actor, recruiterId: string, role: "OWNER" | "ADMIN" | "RECRUITER"): Promise<TeamMember[]> {
  const me = await requireRecruiter(actor);
  requireCompanyAdmin(me);
  await withTransaction(async (trx) => {
    const target = await trx.selectFrom("recruiters").selectAll().where("id", "=", recruiterId).forUpdate().executeTakeFirst();
    if (!target || target.company_id !== me.company_id || target.status !== "ACTIVE") throw notFound("Teammate not found");
    if (me.role !== "OWNER" && (role !== "RECRUITER" || target.role !== "RECRUITER")) throw forbidden("Only an owner can change admins and owners", "OWNER_ONLY");
    if (target.role === "OWNER" && role !== "OWNER") {
      const owners = await trx.selectFrom("recruiters").select("id").where("company_id", "=", me.company_id).where("role", "=", "OWNER").where("status", "=", "ACTIVE").execute();
      if (owners.length <= 1) throw conflict("A company page needs at least one owner", "LAST_OWNER");
    }
    await trx.updateTable("recruiters").set({ role, updated_at: new Date() }).where("id", "=", target.id).execute();
    await audit({ actorId: actor.id, action: "company.member_role", entityType: "recruiter", entityId: target.id, data: { from: target.role, to: role } }, trx);
  });
  return presentTeam(me.company_id, { includePending: true });
}

/** Remove a teammate (page admins). Their pending approaches are withdrawn and unlocks end. */
export async function removeMember(actor: Actor, recruiterId: string): Promise<void> {
  const me = await requireRecruiter(actor);
  requireCompanyAdmin(me);
  if (recruiterId === me.id) throw badRequest("Use 'leave company' to remove yourself", "SELF_ACTION");
  await withTransaction(async (trx, fx) => {
    const target = await trx.selectFrom("recruiters").selectAll().where("id", "=", recruiterId).forUpdate().executeTakeFirst();
    if (!target || target.company_id !== me.company_id) throw notFound("Teammate not found");
    if (target.role === "OWNER" && me.role !== "OWNER") throw forbidden("Only an owner can remove an owner", "OWNER_ONLY");
    const now = new Date();
    await trx.updateTable("approaches").set({ status: "WITHDRAWN", responded_at: now }).where("recruiter_id", "=", target.id).where("status", "=", "PENDING").execute();
    await trx.updateTable("contact_unlocks").set({ revoked_at: now, revoked_reason: "Recruiter removed from the company" }).where("recruiter_id", "=", target.id).where("revoked_at", "is", null).execute();
    await trx.updateTable("jobs").set({ posted_by: me.id }).where("posted_by", "=", target.id).execute();
    if (target.status === "ACTIVE") await trx.updateTable("companies").set({ member_count: sql`greatest(0, member_count - 1)` }).where("id", "=", me.company_id).execute();
    await trx.updateTable("recruiters").set({ status: "SUSPENDED", suspended_reason: "Removed by a company admin", updated_at: now }).where("id", "=", target.id).execute();
    await leaveCompanyJobRooms(fx, target.user_id, me.company_id, trx);
    await audit({ actorId: actor.id, action: "company.member_remove", entityType: "recruiter", entityId: target.id }, trx);
  });
}

export async function follow(actor: Actor, slug: string, on: boolean): Promise<Company> {
  requireActive(actor);
  const company = await bySlug(actor, slug);
  await withTransaction(async (trx, fx) => {
    if (on) {
      const added = await trx.insertInto("company_follows").values({ user_id: actor.id, company_id: company.id }).onConflict((oc) => oc.columns(["user_id", "company_id"]).doNothing()).returning("company_id").executeTakeFirst();
      if (added) {
        await trx.updateTable("companies").set({ follower_count: sql`follower_count + 1` }).where("id", "=", company.id).execute();
        // Tell the page owners, collapsed per hour by notify().
        const owners = await trx.selectFrom("recruiters").select("user_id").where("company_id", "=", company.id).where("status", "=", "ACTIVE").where("role", "=", "OWNER").execute();
        for (const o of owners) await notify({ recipientId: o.user_id, actorId: actor.id, type: "COMPANY_FOLLOW", entityType: "company", entityId: company.id, snippet: company.name, data: { slug: String(company.slug) } }, fx, trx);
      }
    } else {
      const removed = await trx.deleteFrom("company_follows").where("user_id", "=", actor.id).where("company_id", "=", company.id).returning("company_id").executeTakeFirst();
      if (removed) await trx.updateTable("companies").set({ follower_count: sql`greatest(0, follower_count - 1)` }).where("id", "=", company.id).execute();
    }
  });
  return get(actor, slug);
}

/** Companies, by name or text search, most followed first; keyset on (follower_count, id). */
export async function list(viewer: Actor | null, q: { q?: string; industry?: string; cursor?: string; limit: number }): Promise<Page<CompanySummary>> {
  let query = db.selectFrom("companies as c").selectAll("c").where("c.status", "<>", "SUSPENDED");
  if (q.q?.trim()) query = query.where((eb) => eb.or([tsMatches("c.search", q.q as string), sql<boolean>`c.name ILIKE ${likeContains(q.q as string)}`]));
  if (q.industry) query = query.where("c.industry", "=", q.industry);
  const followers = sql<number>`c.follower_count::float8`;
  const rows = await query.where(belowScore(followers, "c.id", decodeScore(q.cursor))).orderBy("c.follower_count", "desc").orderBy("c.id", "desc").limit(q.limit + 1).execute();
  const page = pageBy(rows, q.limit, (r) => encodeScore(r.follower_count, r.id));
  return { items: await presentCompanySummaries(page.items, viewer), nextCursor: page.nextCursor };
}

/** People whose current role (on their published profile) is at this company. */
export async function people(viewer: Actor | null, slug: string, q: { cursor?: string; limit: number }): Promise<Page<UserSummary>> {
  const company = await bySlug(viewer, slug);
  const cursor = decodeTime(q.cursor);
  let query = db
    .selectFrom("profile_experiences as e")
    .innerJoin("talent_profiles as p", "p.id", "e.profile_id")
    .innerJoin("users as u", "u.id", "p.user_id")
    .select(["u.id", atKey("p.updated_at")])
    .where("e.company_id", "=", company.id)
    .where("e.end_month", "is", null)
    .where("p.status", "=", "PUBLISHED")
    // A public list: only people whose experience section is public (domain/profile.ts).
    .where(sql<boolean>`coalesce(p.section_visibility->>'experience', 'PUBLIC') = 'PUBLIC'`)
    .where("u.status", "=", "ACTIVE");
  if (cursor) query = query.where(olderThan("p.updated_at", "u.id", cursor));
  // Two current roles at the same company would list the person twice; one row per person.
  const rows = await query.groupBy(["u.id", "p.updated_at"]).orderBy("p.updated_at", "desc").orderBy("u.id", "desc").limit(q.limit + 1).execute();
  const page = pageBy(rows, q.limit, (r) => encodeTime(r._at, r.id));
  const users = await loadSummaries(page.items.map((r) => r.id));
  return { items: page.items.map((r) => users.get(r.id)).filter((u): u is UserSummary => !!u), nextCursor: page.nextCursor };
}
