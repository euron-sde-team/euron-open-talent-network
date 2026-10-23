/**
 * Account lifecycle: deleting your own account (or an admin erasing one), and exporting
 * your own data.
 *
 * Delete (DELETE /api/users/me) and erase (POST /api/admin/users/:id/erase) share
 * `anonymiseUser`, one transaction. The users row stays, because posts, comments and
 * messages reference it and threads would otherwise lose their shape; everything that
 * identified the person goes:
 *   - users: status DEACTIVATED, email deleted+<id>@invalid.example, username
 *     deleted-<id tail>, display name "Deleted user", avatar and cover cleared,
 *     two-factor and recovery codes removed, digests off, password replaced with an
 *     unknown one; every session revoked, token_version bumped, sockets disconnected
 *   - talent profile: back to DRAFT with every field and section deleted, contact
 *     details nulled, badges, imports, views and endorsements removed
 *   - contact consent: every unlock revoked, pending approaches withdrawn (recruiter
 *     side) or declined (candidate side), open applications WITHDRAWN
 *   - graph: connections, follows and company follows removed (counters move)
 *   - recruiting: the recruiter row is SUSPENDED (jobs they posted stay with the company)
 *   - message requests they sent that were never accepted are deleted
 * Content stays and is shown under "Deleted user". Being the only OWNER of a company
 * that has other active members blocks self-deletion (409 OWNER_MUST_TRANSFER), and so
 * does being the last active admin (409 LAST_ADMIN).
 *
 * Export (GET /api/users/me/export) streams one JSON document of the caller's own data,
 * read in pages of EXPORT_PAGE rows so a large account never sits in memory at once.
 */
import type { Response } from "express";
import { sql } from "kysely";
import type { Actor, RequestMeta } from "../core/context";
import { withTransaction, type Effects } from "../core/effects";
import { conflict } from "../core/errors";
import { db, type Executor } from "../db/kysely";
import { toMe } from "../presenters/user.presenter";
import { recoveryCodeRepo } from "../repositories/recovery-code.repository";
import { sessionRepo } from "../repositories/session.repository";
import { userRepo } from "../repositories/user.repository";
import { hashPassword } from "../security/passwords";
import { randomToken } from "../security/tokens";
import { audit } from "./audit.service";
import { confirmIdentity } from "./auth.service";

export const DELETED_DISPLAY_NAME = "Deleted user";

/** Refuse self-deletion while it would orphan a company team or the platform. */
async function assertCanLeave(userId: string, role: string): Promise<void> {
  const ownerOf = await db
    .selectFrom("recruiters as r")
    .innerJoin("companies as c", "c.id", "r.company_id")
    .select(["c.name", "c.slug", "c.id"])
    .where("r.user_id", "=", userId)
    .where("r.role", "=", "OWNER")
    .where("r.status", "=", "ACTIVE")
    .where((eb) =>
      eb.and([
        eb.exists(eb.selectFrom("recruiters as o").select("o.id").whereRef("o.company_id", "=", "c.id").where("o.user_id", "<>", userId).where("o.status", "=", "ACTIVE")),
        eb.not(eb.exists(eb.selectFrom("recruiters as o2").select("o2.id").whereRef("o2.company_id", "=", "c.id").where("o2.user_id", "<>", userId).where("o2.status", "=", "ACTIVE").where("o2.role", "=", "OWNER"))),
      ]),
    )
    .executeTakeFirst();
  if (ownerOf) throw conflict("Make another teammate an owner of your company page before deleting your account", "OWNER_MUST_TRANSFER", { company: { name: ownerOf.name, slug: String(ownerOf.slug) } });
  if (role === "ADMIN") {
    const others = await db.selectFrom("users").select("id").where("role", "=", "ADMIN").where("status", "=", "ACTIVE").where("id", "<>", userId).executeTakeFirst();
    if (!others) throw conflict("You are the last administrator; make someone else an admin first", "LAST_ADMIN");
  }
}

export async function deleteAccount(actor: Actor, input: { password: string; totp?: string; recoveryCode?: string }, meta: RequestMeta): Promise<void> {
  const user = await confirmIdentity(actor, input);
  await assertCanLeave(user.id, user.role);
  await withTransaction(async (trx, fx) => {
    await anonymiseUser(user.id, trx, fx);
    await audit({ actorId: user.id, action: "user.deleted", entityType: "user", entityId: user.id, ip: meta.ip }, trx);
  });
}

/** Strip everything that identifies a person (see the header). Runs inside the caller's transaction. */
export async function anonymiseUser(id: string, trx: Executor, fx: Effects): Promise<void> {
  const now = new Date();
  const unusable = await hashPassword(randomToken());
  await trx
    .updateTable("users")
    .set({
      status: "DEACTIVATED",
      role: "USER",
      email: `deleted+${id.toLowerCase()}@invalid.example`,
      username: `deleted-${id.slice(-12).toLowerCase()}`,
      display_name: DELETED_DISPLAY_NAME,
      avatar_upload_id: null,
      cover_upload_id: null,
      password_hash: unusable,
      totp_enabled: false,
      totp_secret: null,
      totp_last_step: null,
      email_digest: false,
      suspended_until: null,
      connection_count: 0,
      follower_count: 0,
      following_count: 0,
      updated_at: now,
    })
    .where("id", "=", id)
    .execute();
  await recoveryCodeRepo.deleteAll(id, trx);
  await trx.deleteFrom("auth_tokens").where("user_id", "=", id).execute();
  await trx.deleteFrom("username_history").where("user_id", "=", id).execute();
  await sessionRepo.revokeAllForUser(id, trx);
  await userRepo.bumpTokenVersion(id, trx);

  // The talent profile: every section, every private field.
  const profile = await trx.selectFrom("talent_profiles").select("id").where("user_id", "=", id).executeTakeFirst();
  if (profile) {
    const pid = profile.id;
    for (const table of ["profile_experiences", "profile_educations", "profile_projects", "profile_skills", "profile_certifications", "profile_links", "profile_badges", "profile_views", "saved_candidates"] as const) {
      await trx.deleteFrom(table).where("profile_id", "=", pid).execute();
    }
    await trx
      .updateTable("talent_profiles")
      .set({
        status: "DRAFT",
        headline: null,
        about: null,
        current_title: null,
        current_company: null,
        location: null,
        country_code: null,
        timezone: null,
        years_experience: null,
        languages: [],
        open_to_work: "OFF",
        open_to_roles: [],
        employment_types: [],
        workplace_types: [],
        available_from: null,
        rate_min: null,
        rate_max: null,
        rate_currency: null,
        rate_period: null,
        contact_email: null,
        contact_phone: null,
        whatsapp_phone: null,
        section_visibility: JSON.stringify({}),
        completeness: 0,
        published_at: null,
        search_text: "",
        skill_names: [],
        updated_at: now,
      })
      .where("id", "=", pid)
      .execute();
  }
  await trx.deleteFrom("profile_imports").where("user_id", "=", id).execute();
  await trx.deleteFrom("skill_endorsements").where("endorser_id", "=", id).execute();

  // Contact consent and hiring.
  await trx.updateTable("contact_unlocks").set({ revoked_at: now, revoked_reason: "Account deleted" }).where("candidate_id", "=", id).where("revoked_at", "is", null).execute();
  await trx.updateTable("approaches").set({ status: "DECLINED", responded_at: now, decline_reason: null }).where("candidate_id", "=", id).where("status", "=", "PENDING").execute();
  await trx.updateTable("applications").set({ stage: "WITHDRAWN", stage_changed_at: now, updated_at: now }).where("candidate_id", "=", id).where("stage", "not in", ["HIRED", "REJECTED", "WITHDRAWN"]).execute();
  const recruiter = await trx.selectFrom("recruiters").select(["id", "company_id", "status"]).where("user_id", "=", id).executeTakeFirst();
  if (recruiter) {
    await trx.updateTable("approaches").set({ status: "WITHDRAWN", responded_at: now }).where("recruiter_id", "=", recruiter.id).where("status", "=", "PENDING").execute();
    await trx.updateTable("contact_unlocks").set({ revoked_at: now, revoked_reason: "Recruiter account deleted" }).where("recruiter_id", "=", recruiter.id).where("revoked_at", "is", null).execute();
    if (recruiter.status === "ACTIVE") await trx.updateTable("companies").set((eb) => ({ member_count: sql`GREATEST(${eb.ref("member_count")} - 1, 0)` })).where("id", "=", recruiter.company_id).execute();
    await trx.updateTable("recruiters").set({ status: "SUSPENDED", suspended_reason: "Account deleted", work_email: `deleted+${recruiter.id.toLowerCase()}@invalid.example`, phone: null, updated_at: now }).where("id", "=", recruiter.id).execute();
  }

  // The graph, with the other side's counters.
  await sql`UPDATE users SET connection_count = GREATEST(connection_count - 1, 0)
             WHERE id IN (SELECT CASE WHEN requester_id = ${id} THEN addressee_id ELSE requester_id END FROM connections
                          WHERE (requester_id = ${id} OR addressee_id = ${id}) AND status = 'ACCEPTED')`.execute(trx);
  await trx.deleteFrom("connections").where((eb) => eb.or([eb("requester_id", "=", id), eb("addressee_id", "=", id)])).execute();
  await sql`UPDATE users SET follower_count = GREATEST(follower_count - 1, 0) WHERE id IN (SELECT followee_id FROM follows WHERE follower_id = ${id})`.execute(trx);
  await sql`UPDATE users SET following_count = GREATEST(following_count - 1, 0) WHERE id IN (SELECT follower_id FROM follows WHERE followee_id = ${id})`.execute(trx);
  await trx.deleteFrom("follows").where((eb) => eb.or([eb("follower_id", "=", id), eb("followee_id", "=", id)])).execute();
  await sql`UPDATE companies SET follower_count = GREATEST(follower_count - 1, 0) WHERE id IN (SELECT company_id FROM company_follows WHERE user_id = ${id})`.execute(trx);
  await trx.deleteFrom("company_follows").where("user_id", "=", id).execute();
  await trx.deleteFrom("saved_jobs").where("user_id", "=", id).execute();

  // Message requests they sent that nobody accepted disappear from the recipients' requests.
  await sql`DELETE FROM dm_threads t WHERE t.created_by = ${id}
             AND EXISTS (SELECT 1 FROM dm_participants p WHERE p.thread_id = t.id AND p.user_id <> ${id} AND p.state = 'REQUESTED')`.execute(trx);
  await trx.updateTable("dm_participants").set({ state: "DECLINED", muted_until: null }).where("user_id", "=", id).execute();

  fx.disconnect([id], "SIGNED_OUT");
}

// ─── Export ─────────────────────────────────────────────────────────────────

const EXPORT_PAGE = 500;

type Section = { name: string; query: (after: string | null) => Promise<{ id: string }[]> };

/** One paged query per exported list. Every list is keyed by a unique `id` column. */
function page<T extends { id: string }>(build: (after: string | null) => Promise<T[]>): (after: string | null) => Promise<T[]> {
  return build;
}

function sections(userId: string, profileId: string | null, recruiterId: string | null): Section[] {
  const pid = profileId ?? "";
  const rid = recruiterId ?? "";
  const after = <Q extends { where: (...a: any[]) => Q }>(q: Q, col: string, cursor: string | null): Q => (cursor ? q.where(col, ">", cursor) : q);
  return [
    { name: "experience", query: page((c) => after(db.selectFrom("profile_experiences").selectAll().where("profile_id", "=", pid), "id", c).orderBy("id").limit(EXPORT_PAGE).execute()) },
    { name: "education", query: page((c) => after(db.selectFrom("profile_educations").selectAll().where("profile_id", "=", pid), "id", c).orderBy("id").limit(EXPORT_PAGE).execute()) },
    { name: "projects", query: page((c) => after(db.selectFrom("profile_projects").selectAll().where("profile_id", "=", pid), "id", c).orderBy("id").limit(EXPORT_PAGE).execute()) },
    { name: "skills", query: page((c) => after(db.selectFrom("profile_skills").selectAll().where("profile_id", "=", pid), "id", c).orderBy("id").limit(EXPORT_PAGE).execute()) },
    { name: "certifications", query: page((c) => after(db.selectFrom("profile_certifications").selectAll().where("profile_id", "=", pid), "id", c).orderBy("id").limit(EXPORT_PAGE).execute()) },
    { name: "links", query: page((c) => after(db.selectFrom("profile_links").selectAll().where("profile_id", "=", pid), "id", c).orderBy("id").limit(EXPORT_PAGE).execute()) },
    { name: "badges", query: page((c) => after(db.selectFrom("profile_badges").select(["id", "kind", "source", "label", "rationale", "is_visible", "created_at"]).where("profile_id", "=", pid), "id", c).orderBy("id").limit(EXPORT_PAGE).execute()) },
    { name: "posts", query: page((c) => after(db.selectFrom("posts").select(["id", "kind", "visibility", "body", "status", "shared_post_id", "job_id", "created_at", "edited_at"]).where("author_id", "=", userId), "id", c).orderBy("id").limit(EXPORT_PAGE).execute()) },
    { name: "comments", query: page((c) => after(db.selectFrom("comments").select(["id", "post_id", "parent_id", "body", "status", "created_at", "edited_at"]).where("author_id", "=", userId), "id", c).orderBy("id").limit(EXPORT_PAGE).execute()) },
    { name: "directMessages", query: page((c) => after(db.selectFrom("dm_messages").select(["id", "thread_id", "body", "status", "created_at", "edited_at"]).where("sender_id", "=", userId), "id", c).orderBy("id").limit(EXPORT_PAGE).execute()) },
    {
      name: "connections",
      query: page((c) =>
        after(
          db
            .selectFrom("connections as k")
            .innerJoin("users as u", (j) => j.on((eb) => eb.and([eb.or([eb("k.requester_id", "=", userId), eb("k.addressee_id", "=", userId)]), eb("u.id", "<>", userId), eb.or([eb("u.id", "=", eb.ref("k.requester_id")), eb("u.id", "=", eb.ref("k.addressee_id"))])])))
            .select(["k.id", "u.username", "k.status", "k.created_at", "k.responded_at"]),
          "k.id",
          c,
        )
          .orderBy("k.id")
          .limit(EXPORT_PAGE)
          .execute(),
      ),
    },
    { name: "following", query: page((c) => after(db.selectFrom("follows as f").innerJoin("users as u", "u.id", "f.followee_id").select(["u.id", "u.username", "f.created_at"]).where("f.follower_id", "=", userId), "u.id", c).orderBy("u.id").limit(EXPORT_PAGE).execute()) },
    { name: "blocks", query: page((c) => after(db.selectFrom("blocks as b").innerJoin("users as u", "u.id", "b.blocked_id").select(["u.id", "u.username", "b.created_at"]).where("b.blocker_id", "=", userId), "u.id", c).orderBy("u.id").limit(EXPORT_PAGE).execute()) },
    { name: "approachesReceived", query: page((c) => after(db.selectFrom("approaches").select(["id", "company_id", "role_title", "message", "status", "created_at", "responded_at"]).where("candidate_id", "=", userId), "id", c).orderBy("id").limit(EXPORT_PAGE).execute()) },
    { name: "approachesSent", query: page((c) => after(db.selectFrom("approaches").select(["id", "candidate_id", "role_title", "message", "status", "created_at", "responded_at"]).where("recruiter_id", "=", rid), "id", c).orderBy("id").limit(EXPORT_PAGE).execute()) },
    { name: "contactAccessLog", query: page((c) => after(db.selectFrom("contact_access_log").select(["id", "recruiter_id", "channel", "viewed_at"]).where("candidate_id", "=", userId), "id", c).orderBy("id").limit(EXPORT_PAGE).execute()) },
    { name: "applications", query: page((c) => after(db.selectFrom("applications").select(["id", "job_id", "stage", "cover_note", "answers", "created_at", "stage_changed_at"]).where("candidate_id", "=", userId), "id", c).orderBy("id").limit(EXPORT_PAGE).execute()) },
    { name: "ratingsGiven", query: page((c) => after(db.selectFrom("ratings").select(["id", "engagement_id", "score", "sub_scores", "comment", "created_at"]).where("rater_id", "=", userId), "id", c).orderBy("id").limit(EXPORT_PAGE).execute()) },
    { name: "complaints", query: page((c) => after(db.selectFrom("complaints").select(["id", "against_user_id", "category", "description", "status", "admin_note", "created_at"]).where("complainant_id", "=", userId), "id", c).orderBy("id").limit(EXPORT_PAGE).execute()) },
    { name: "reports", query: page((c) => after(db.selectFrom("reports").select(["id", "target_type", "target_id", "reason", "details", "created_at"]).where("reporter_id", "=", userId), "id", c).orderBy("id").limit(EXPORT_PAGE).execute()) },
    { name: "notifications", query: page((c) => after(db.selectFrom("notifications").select(["id", "type", "entity_type", "entity_id", "snippet", "read_at", "created_at"]).where("recipient_id", "=", userId), "id", c).orderBy("id").limit(EXPORT_PAGE).execute()) },
  ];
}

/** Stream the caller's data as one JSON document: { exportedAt, account, profile, experience: [...], ... }. */
export async function exportAccount(actor: Actor, res: Response): Promise<void> {
  const user = await userRepo.findById(actor.id);
  if (!user) return void res.status(404).end();
  const profile = await db.selectFrom("talent_profiles").selectAll().where("user_id", "=", user.id).executeTakeFirst();
  const recruiter = await db.selectFrom("recruiters").select(["id", "company_id", "role", "status", "title", "work_email", "created_at"]).where("user_id", "=", user.id).executeTakeFirst();
  const account = { ...(await toMe(user)), createdAt: user.created_at.toISOString() };
  const { search: _search, search_text: _text, ...profileOut } = profile ?? ({} as Record<string, unknown>);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${user.username}-export.json"`);
  res.setHeader("Cache-Control", "no-store");
  const write = (chunk: string) => new Promise<void>((resolve) => (res.write(chunk) ? resolve() : res.once("drain", resolve)));
  await write(`{"exportedAt":${JSON.stringify(new Date().toISOString())},"account":${JSON.stringify(account)},"profile":${JSON.stringify(profile ? profileOut : null)},"recruiter":${JSON.stringify(recruiter ?? null)}`);
  for (const section of sections(user.id, profile?.id ?? null, recruiter?.id ?? null)) {
    await write(`,${JSON.stringify(section.name)}:[`);
    let cursor: string | null = null;
    let first = true;
    for (;;) {
      const rows = await section.query(cursor);
      for (const row of rows) {
        await write(`${first ? "" : ","}${JSON.stringify(row)}`);
        first = false;
      }
      if (rows.length < EXPORT_PAGE) break;
      cursor = rows[rows.length - 1]!.id;
    }
    await write("]");
  }
  await write("}");
  res.end();
  await audit({ actorId: user.id, action: "user.export", entityType: "user", entityId: user.id });
}
