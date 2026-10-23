/**
 * The /admin control plane. Every function opens with requireArea(actor, area), the one
 * RBAC table in domain/admin-permissions.ts:
 *
 *   overview     KPIs over a date range (and a CSV of the daily series)
 *   recruiters   the approval queue: approve, reject with a reason, suspend, reinstate, quota
 *   companies    verify, suspend, restore, domains and auto-approval
 *   people       accounts (search, suspend, ban), profiles (suspend, restore), verification badges
 *   jobs         close or hide postings
 *   complaints   triage, resolve with an optional enforcement action, both sides told
 *   settings     platform settings, role changes, erasure (ADMIN only)
 *   audit        the trail of every change
 *
 * Every change writes an audit_log row with the operator's id (the source recorded the
 * literal "undefined" for admin actions) and, where a person is affected, notifies them.
 * Account actions go through moderation/actions.service.ts so the console and the
 * moderation queue leave the same trail and disconnect sockets the same way.
 */
import type { AdminComplaintRow, AdminCompanyRow, AdminPermissions, AdminRecruiterRow, AdminStats, AdminUserRow, AuditEntry, ComplaintStatus, Job, Page, PlatformSettings, UserRole, UserStatus } from "@open-talent/types";
import { sql } from "kysely";
import { requireArea, type Actor } from "../core/context";
import { decodeCursor, toPage } from "../core/cursor";
import { withTransaction } from "../core/effects";
import { badRequest, conflict, forbidden, notFound } from "../core/errors";
import { newId } from "../core/ids";
import { db, type Executor } from "../db/kysely";
import { permissionsFor } from "../domain/admin-permissions";
import { domainMatches, isFreeMail } from "../domain/recruiter-verification";
import { baseDomain } from "../domain/safe-url";
import { likeContains } from "../domain/search-text";
import { config } from "../core/config";
import { sendMail } from "../integrations/mail/mailer";
import * as templates from "../integrations/mail/templates";
import { presentCompanySummaries } from "../presenters/company.presenter";
import { presentJobs } from "../presenters/job.presenter";
import { loadMedia } from "../presenters/media.presenter";
import { loadSummaries } from "../presenters/user.presenter";
import { msOf } from "../repositories/moderation.repository";
import { anonymiseUser } from "./account.service";
import { audit } from "./audit.service";
import * as counters from "./counters.service";
import { applyAccountAction, type AccountAction } from "./moderation/actions.service";
import { leaveCompanyJobRooms } from "./recruiter.service";
import { notify } from "./notification.service";
import { getSettings, networkName, saveSettings } from "./settings.service";

export function permissions(actor: Actor): { role: UserRole; areas: AdminPermissions } {
  return { role: actor.role, areas: permissionsFor(actor.role) };
}

// ─── Settings ───────────────────────────────────────────────────────────────

export async function readSettings(actor: Actor): Promise<PlatformSettings> {
  requireArea(actor, "settings");
  return getSettings();
}

export async function updateSettings(actor: Actor, patch: Partial<PlatformSettings>, ip: string | null): Promise<PlatformSettings> {
  requireArea(actor, "settings");
  return withTransaction(async (trx) => {
    const before = await getSettings(trx);
    const next = await saveSettings(patch, actor.id, trx);
    const changed = Object.keys(patch).filter((k) => JSON.stringify((before as unknown as Record<string, unknown>)[k]) !== JSON.stringify((next as unknown as Record<string, unknown>)[k]));
    await audit({ actorId: actor.id, action: "settings.update", entityType: "settings", entityId: "platform", ip, data: { keys: changed, before: Object.fromEntries(changed.map((k) => [k, (before as unknown as Record<string, unknown>)[k]])), after: Object.fromEntries(changed.map((k) => [k, (next as unknown as Record<string, unknown>)[k]])) } }, trx);
    return next;
  });
}

// ─── Overview ───────────────────────────────────────────────────────────────

/** KPIs between `from` and `to` (inclusive days, in the analytics timezone). */
export async function stats(actor: Actor, range: { from?: string; to?: string }): Promise<AdminStats> {
  requireArea(actor, "overview");
  const tz = (await getSettings()).analytics.timezone;
  const to = range.to ?? new Date().toISOString().slice(0, 10);
  const from = range.from ?? new Date(Date.now() - 29 * 86400_000).toISOString().slice(0, 10);
  if (from > to) throw badRequest("The start date is after the end date", "RANGE_INVALID");
  if ((Date.parse(to) - Date.parse(from)) / 86400_000 > 366) throw badRequest("Pick a range of at most a year", "RANGE_TOO_LONG");
  // [start, end) as timestamps in the analytics timezone.
  const start = sql`(${from}::date)::timestamp AT TIME ZONE ${tz}`;
  const end = sql`((${to}::date) + 1)::timestamp AT TIME ZONE ${tz}`;
  const totals = await sql<Record<string, number>>`
    SELECT
      (SELECT count(*) FROM users WHERE status <> 'DEACTIVATED')::int AS users,
      (SELECT count(*) FROM users WHERE last_seen_at > now() - interval '7 days')::int AS active,
      (SELECT count(*) FROM talent_profiles WHERE status = 'PUBLISHED')::int AS published,
      (SELECT count(*) FROM companies WHERE status <> 'SUSPENDED')::int AS companies,
      (SELECT count(*) FROM companies WHERE status = 'VERIFIED')::int AS verified,
      (SELECT count(*) FROM recruiters WHERE status = 'ACTIVE')::int AS recruiters,
      (SELECT count(*) FROM recruiters WHERE status = 'PENDING_REVIEW')::int AS pending,
      (SELECT count(*) FROM jobs WHERE status = 'OPEN' AND content_status = 'PUBLISHED')::int AS jobs,
      (SELECT count(*) FROM applications)::int AS applications,
      (SELECT count(*) FROM moderation_cases WHERE status = 'OPEN')::int AS cases,
      (SELECT count(*) FROM complaints WHERE status IN ('OPEN', 'UNDER_REVIEW'))::int AS complaints`.execute(db);
  const inRange = await sql<Record<string, number | null>>`
    SELECT
      (SELECT count(*) FROM users WHERE created_at >= ${start} AND created_at < ${end})::int AS signups,
      (SELECT count(*) FROM talent_profiles WHERE published_at >= ${start} AND published_at < ${end})::int AS published,
      (SELECT count(*) FROM applications WHERE created_at >= ${start} AND created_at < ${end})::int AS applied,
      (SELECT count(*) FROM application_events WHERE to_stage = 'HIRED' AND created_at >= ${start} AND created_at < ${end})::int AS hired,
      (SELECT count(*) FROM approaches WHERE created_at >= ${start} AND created_at < ${end})::int AS approaches,
      (SELECT (count(*) FILTER (WHERE status = 'ACCEPTED'))::float8 / NULLIF(count(*) FILTER (WHERE status IN ('ACCEPTED', 'DECLINED', 'EXPIRED')), 0)
         FROM approaches WHERE created_at >= ${start} AND created_at < ${end}) AS acceptance,
      (SELECT count(*)::float8 / NULLIF((SELECT count(*) FROM jobs WHERE status = 'OPEN'), 0) FROM applications WHERE created_at >= ${start} AND created_at < ${end}) AS per_job,
      (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM e.created_at - a.created_at) / 86400)
         FROM application_events e JOIN applications a ON a.id = e.application_id
        WHERE e.to_stage = 'HIRED' AND e.created_at >= ${start} AND e.created_at < ${end}) AS days_to_hire,
      (SELECT count(*) FROM complaints WHERE created_at >= ${start} AND created_at < ${end})::int AS complaints,
      (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM resolved_at - created_at) / 3600)
         FROM complaints WHERE resolved_at >= ${start} AND resolved_at < ${end}) AS complaint_hours,
      (SELECT count(*) FROM moderation_cases WHERE resolved_at >= ${start} AND resolved_at < ${end})::int AS cases_resolved`.execute(db);
  const daily = await sql<{ date: string; signups: number; published: number; applications: number; approaches: number; posts: number }>`
    WITH d AS (SELECT generate_series(${from}::date, ${to}::date, interval '1 day')::date AS day),
    b AS (SELECT day, (day::timestamp AT TIME ZONE ${tz}) AS s, ((day + 1)::timestamp AT TIME ZONE ${tz}) AS e FROM d)
    SELECT to_char(b.day, 'YYYY-MM-DD') AS date,
      (SELECT count(*) FROM users u WHERE u.created_at >= b.s AND u.created_at < b.e)::int AS signups,
      (SELECT count(*) FROM talent_profiles p WHERE p.published_at >= b.s AND p.published_at < b.e)::int AS published,
      (SELECT count(*) FROM applications a WHERE a.created_at >= b.s AND a.created_at < b.e)::int AS applications,
      (SELECT count(*) FROM approaches x WHERE x.created_at >= b.s AND x.created_at < b.e)::int AS approaches,
      (SELECT count(*) FROM posts p WHERE p.created_at >= b.s AND p.created_at < b.e)::int AS posts
    FROM b ORDER BY b.day`.execute(db);
  const skills = await sql<{ name: string; n: number }>`
    SELECT s.name::text AS name, count(*)::int AS n FROM talent_profiles p, unnest(p.skill_names) s(name)
     WHERE p.status = 'PUBLISHED' GROUP BY 1 ORDER BY n DESC LIMIT 12`.execute(db);
  const t = totals.rows[0]!;
  const r = inRange.rows[0]!;
  const num = (v: number | null | undefined) => (v === null || v === undefined ? null : Math.round(Number(v) * 100) / 100);
  return {
    range: { from, to, timezone: tz },
    totals: {
      users: Number(t.users),
      activeUsers7d: Number(t.active),
      profilesPublished: Number(t.published),
      companies: Number(t.companies),
      companiesVerified: Number(t.verified),
      recruitersActive: Number(t.recruiters),
      recruitersPendingReview: Number(t.pending),
      jobsOpen: Number(t.jobs),
      applications: Number(t.applications),
      openCases: Number(t.cases),
      openComplaints: Number(t.complaints),
    },
    funnel: { signups: Number(r.signups), profilesPublished: Number(r.published), applied: Number(r.applied), hired: Number(r.hired) },
    hiring: { approachesSent: Number(r.approaches), approachAcceptanceRate: num(r.acceptance), applicationsPerOpenJob: num(r.per_job), medianDaysToHire: num(r.days_to_hire) },
    trust: { complaintsOpened: Number(r.complaints), medianComplaintHours: num(r.complaint_hours), casesResolved: Number(r.cases_resolved) },
    daily: daily.rows.map((d) => ({ date: d.date, signups: Number(d.signups), published: Number(d.published), applications: Number(d.applications), approaches: Number(d.approaches), posts: Number(d.posts) })),
    topSkills: skills.rows.map((s) => ({ name: s.name, count: Number(s.n) })),
  };
}

/** The daily series as CSV (the overview's export button). No personal data. */
export async function statsCsv(actor: Actor, range: { from?: string; to?: string }): Promise<string> {
  const s = await stats(actor, range);
  return ["date,signups,profiles_published,applications,approaches,posts", ...s.daily.map((d) => [d.date, d.signups, d.published, d.applications, d.approaches, d.posts].join(","))].join("\n") + "\n";
}

// ─── People ─────────────────────────────────────────────────────────────────

async function userRows(ids: string[], exec: Executor = db): Promise<AdminUserRow[]> {
  if (!ids.length) return [];
  const rows = await exec
    .selectFrom("users as u")
    .leftJoin("talent_profiles as p", "p.user_id", "u.id")
    .select(["u.id", "u.email", "u.status", "u.created_at", "u.last_seen_at", "u.suspended_until", "p.status as profile_status"])
    .where("u.id", "in", ids)
    .execute();
  const summaries = await loadSummaries(ids, exec);
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.flatMap((id) => {
    const r = byId.get(id);
    const s = summaries.get(id);
    if (!r || !s) return [];
    return [{ ...s, email: String(r.email), status: r.status, profileStatus: r.profile_status ?? "DRAFT", createdAt: r.created_at.toISOString(), lastSeenAt: r.last_seen_at?.toISOString() ?? null, suspendedUntil: r.suspended_until?.toISOString() ?? null }];
  });
}

export async function listUsers(actor: Actor, q: { q?: string; status?: UserStatus; role?: UserRole; cursor?: string; limit: number }): Promise<Page<AdminUserRow>> {
  requireArea(actor, "people");
  const c = decodeCursor(q.cursor);
  let query = db.selectFrom("users").select(["id", "created_at"]);
  // Same expression as users_name_trgm_idx, so ILIKE uses the trigram index.
  if (q.q) query = query.where((eb) => eb.or([eb(sql`display_name || ' ' || username::text`, "ilike", likeContains(q.q!)), eb("email", "=", q.q!)]));
  if (q.status) query = query.where("status", "=", q.status);
  if (q.role) query = query.where("role", "=", q.role);
  if (c) query = query.where((eb) => eb.or([eb(msOf("created_at"), "<", c.at), eb.and([eb(msOf("created_at"), "=", c.at), eb("id", "<", c.id)])]));
  const rows = await query.orderBy(msOf("created_at"), "desc").orderBy("id", "desc").limit(q.limit + 1).execute();
  const page = toPage(rows, q.limit, (r) => ({ at: r.created_at, id: r.id }));
  return { items: await userRows(page.items.map((r) => r.id)), nextCursor: page.nextCursor };
}

export async function changeRole(actor: Actor, userId: string, role: UserRole, ip: string | null): Promise<AdminUserRow> {
  requireArea(actor, "settings");
  if (userId === actor.id) throw forbidden("You cannot change your own role", "CANNOT_CHANGE_OWN_ROLE");
  await withTransaction(async (trx) => {
    // Lock every admin row so two concurrent demotions cannot both pass the last-admin check.
    const admins = await trx.selectFrom("users").select("id").where("role", "=", "ADMIN").where("status", "=", "ACTIVE").forUpdate().execute();
    const user = await trx.selectFrom("users").select(["id", "role"]).where("id", "=", userId).forUpdate().executeTakeFirst();
    if (!user) throw notFound("User not found", "USER_NOT_FOUND");
    if (user.role === "ADMIN" && role !== "ADMIN" && admins.filter((a) => a.id !== userId).length === 0) throw conflict("The network needs at least one admin", "LAST_ADMIN");
    await trx.updateTable("users").set({ role, updated_at: new Date() }).where("id", "=", userId).execute();
    await audit({ actorId: actor.id, action: "user.role_change", entityType: "user", entityId: userId, ip, data: { from: user.role, to: role } }, trx);
  });
  return (await userRows([userId]))[0]!;
}

export async function accountAction(actor: Actor, userId: string, kind: AccountAction, opts: { days?: number; reason?: string | null }, ip: string | null): Promise<AdminUserRow> {
  requireArea(actor, "people");
  await withTransaction((trx, fx) => applyAccountAction(actor, userId, kind, { ...opts, ip }, trx, fx));
  const row = (await userRows([userId]))[0];
  if (!row) throw notFound("User not found", "USER_NOT_FOUND");
  return row;
}

/** Suspend a talent profile: it leaves the directory and search at once, and every live contact unlock ends. */
export async function suspendProfile(actor: Actor, userId: string, reason: string, ip: string | null): Promise<AdminUserRow> {
  requireArea(actor, "people");
  await withTransaction(async (trx, fx) => {
    const p = await trx.selectFrom("talent_profiles").select(["id", "status"]).where("user_id", "=", userId).forUpdate().executeTakeFirst();
    if (!p) throw notFound("Profile not found", "PROFILE_NOT_FOUND");
    if (p.status === "SUSPENDED") throw conflict("This profile is already suspended", "ALREADY_SUSPENDED");
    const now = new Date();
    await trx.updateTable("talent_profiles").set({ status: "SUSPENDED", suspended_reason: reason, updated_at: now }).where("id", "=", p.id).execute();
    await trx.updateTable("contact_unlocks").set({ revoked_at: now, revoked_reason: "Profile suspended" }).where("candidate_id", "=", userId).where("revoked_at", "is", null).execute();
    await trx.insertInto("moderation_actions").values({ id: newId(), case_id: null, actor_id: actor.id, action: "HIDE", target_type: "PROFILE", target_id: p.id, reason, data: JSON.stringify({ via: "admin" }) }).execute();
    await audit({ actorId: actor.id, action: "profile.suspend", entityType: "profile", entityId: p.id, ip, data: { reason, from: p.status } }, trx);
    await notify({ recipientId: userId, actorId: null, type: "MODERATION_ACTION", entityType: "profile", entityId: p.id, snippet: `Your profile was suspended: ${reason}` }, fx, trx);
  });
  return (await userRows([userId]))[0]!;
}

/** Restore to UNLISTED: the owner decides when to be public again. */
export async function restoreProfile(actor: Actor, userId: string, ip: string | null): Promise<AdminUserRow> {
  requireArea(actor, "people");
  await withTransaction(async (trx, fx) => {
    const res = await trx.updateTable("talent_profiles").set({ status: "UNLISTED", suspended_reason: null, updated_at: new Date() }).where("user_id", "=", userId).where("status", "=", "SUSPENDED").returning("id").executeTakeFirst();
    if (!res) throw conflict("This profile is not suspended", "NOT_SUSPENDED");
    await trx.insertInto("moderation_actions").values({ id: newId(), case_id: null, actor_id: actor.id, action: "RESTORE", target_type: "PROFILE", target_id: res.id, reason: null, data: JSON.stringify({ via: "admin" }) }).execute();
    await audit({ actorId: actor.id, action: "profile.restore", entityType: "profile", entityId: res.id, ip }, trx);
    await notify({ recipientId: userId, actorId: null, type: "MODERATION_ACTION", entityType: "profile", entityId: res.id, snippet: "Your profile was restored. It is unlisted until you publish it again." }, fx, trx);
  });
  return (await userRows([userId]))[0]!;
}

export async function grantBadge(actor: Actor, userId: string, input: { label: string; rationale?: string | null }, ip: string | null): Promise<{ id: string }> {
  requireArea(actor, "people");
  const p = await db.selectFrom("talent_profiles").select("id").where("user_id", "=", userId).executeTakeFirst();
  if (!p) throw notFound("Profile not found", "PROFILE_NOT_FOUND");
  const slug = `verified-${input.label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40)}`;
  const row = await db
    .insertInto("profile_badges")
    .values({ id: newId(), profile_id: p.id, kind: "VERIFICATION", source: "ADMIN", slug, label: input.label.slice(0, 40), rationale: input.rationale ?? `Verified by the ${await networkName()} team`, granted_by: actor.id })
    .onConflict((oc) => oc.columns(["profile_id", "slug"]).doUpdateSet({ label: input.label.slice(0, 40), rationale: input.rationale ?? null, granted_by: actor.id }))
    .returning("id")
    .executeTakeFirstOrThrow();
  await audit({ actorId: actor.id, action: "badge.grant", entityType: "profile", entityId: p.id, ip, data: { slug } });
  return { id: row.id };
}

export async function revokeBadge(actor: Actor, badgeId: string, ip: string | null): Promise<void> {
  requireArea(actor, "people");
  const row = await db.deleteFrom("profile_badges").where("id", "=", badgeId).returning(["profile_id", "slug"]).executeTakeFirst();
  if (!row) throw notFound("Badge not found");
  await audit({ actorId: actor.id, action: "badge.revoke", entityType: "profile", entityId: row.profile_id, ip, data: { slug: row.slug } });
}

/** GDPR erasure: the same anonymisation as self-deletion, by an ADMIN, audited. */
export async function eraseUser(actor: Actor, userId: string, reason: string, ip: string | null): Promise<void> {
  requireArea(actor, "settings");
  if (userId === actor.id) throw badRequest("Delete your own account from Settings", "SELF_ACTION");
  await withTransaction(async (trx, fx) => {
    const u = await trx.selectFrom("users").select(["id", "role", "status"]).where("id", "=", userId).forUpdate().executeTakeFirst();
    if (!u) throw notFound("User not found", "USER_NOT_FOUND");
    if (u.role === "ADMIN") throw forbidden("Demote an admin before erasing the account", "TARGET_PROTECTED");
    await anonymiseUser(userId, trx, fx);
    await audit({ actorId: actor.id, action: "user.erase", entityType: "user", entityId: userId, ip, data: { reason } }, trx);
  });
}

// ─── Recruiters ─────────────────────────────────────────────────────────────

export async function listRecruiters(actor: Actor, q: { status?: AdminRecruiterRow["status"]; q?: string; cursor?: string; limit: number }): Promise<Page<AdminRecruiterRow>> {
  requireArea(actor, "recruiters");
  const settings = await getSettings();
  const c = decodeCursor(q.cursor);
  let query = db.selectFrom("recruiters as r").innerJoin("companies as c", "c.id", "r.company_id").innerJoin("users as u", "u.id", "r.user_id").selectAll("r");
  query = query.where("r.status", "=", q.status ?? "PENDING_REVIEW");
  if (q.q) query = query.where((eb) => eb.or([sql<boolean>`c.name ILIKE ${likeContains(q.q!)}`, eb("r.work_email", "=", q.q!), sql<boolean>`(u.display_name || ' ' || u.username::text) ILIKE ${likeContains(q.q!)}`]));
  // The queue is first-in first-out; other statuses newest first.
  const asc = (q.status ?? "PENDING_REVIEW") === "PENDING_REVIEW";
  if (c) query = query.where((eb) => (asc ? eb.or([eb(msOf("r.created_at"), ">", c.at), eb.and([eb(msOf("r.created_at"), "=", c.at), eb("r.id", ">", c.id)])]) : eb.or([eb(msOf("r.created_at"), "<", c.at), eb.and([eb(msOf("r.created_at"), "=", c.at), eb("r.id", "<", c.id)])])));
  const rows = await query.orderBy(msOf("r.created_at"), asc ? "asc" : "desc").orderBy("r.id", asc ? "asc" : "desc").limit(q.limit + 1).execute();
  const page = toPage(rows, q.limit, (r) => ({ at: r.created_at, id: r.id }));
  const [people, companies, reviewers] = await Promise.all([
    loadSummaries(page.items.map((r) => r.user_id)),
    db.selectFrom("companies").selectAll().where("id", "in", page.items.length ? page.items.map((r) => r.company_id) : [""]).execute(),
    loadSummaries(page.items.map((r) => r.reviewed_by)),
  ]);
  const emails = new Map((await db.selectFrom("users").select(["id", "email"]).where("id", "in", page.items.length ? page.items.map((r) => r.user_id) : [""]).execute()).map((u) => [u.id, String(u.email)]));
  const summaries = new Map((await presentCompanySummaries(companies, null)).map((s) => [s.id, s]));
  const companyRow = new Map(companies.map((c) => [c.id, c]));
  return {
    items: page.items
      .filter((r) => people.has(r.user_id) && summaries.has(r.company_id))
      .map((r) => {
        const co = companyRow.get(r.company_id)!;
        const domains = co.domains.map(String);
        return {
          id: r.id,
          user: { ...people.get(r.user_id)!, email: emails.get(r.user_id) ?? "" },
          company: { ...summaries.get(r.company_id)!, domains },
          status: r.status,
          title: r.title,
          workEmail: String(r.work_email),
          workEmailVerified: !!r.work_email_verified_at,
          domainMatches: domainMatches({ workEmail: String(r.work_email), companyDomains: domains, freeMailDomains: settings.recruiter.freeMailDomains }),
          freeMail: isFreeMail(String(r.work_email), settings.recruiter.freeMailDomains),
          applicationNote: r.application_note,
          reviewNote: r.review_note,
          reviewedBy: r.reviewed_by ? (reviewers.get(r.reviewed_by) ?? null) : null,
          reviewedAt: r.reviewed_at?.toISOString() ?? null,
          approachesSent: r.approaches_sent,
          createdAt: r.created_at.toISOString(),
        };
      }),
    nextCursor: page.nextCursor,
  };
}

async function decisionMail(recruiterId: string, approved: boolean, note: string | null, exec: Executor): Promise<void> {
  const r = await exec.selectFrom("recruiters as r").innerJoin("users as u", "u.id", "r.user_id").innerJoin("companies as c", "c.id", "r.company_id").select(["u.email", "u.display_name", "c.name"]).where("r.id", "=", recruiterId).executeTakeFirst();
  if (r) await sendMail(templates.recruiterDecision(await networkName(exec), String(r.email), r.display_name, r.name, approved, note, `${config.APP_WEB_URL}/recruiter`)).catch(() => undefined);
}

export async function reviewRecruiter(actor: Actor, recruiterId: string, decision: "APPROVE" | "REJECT", note: string | null, ip: string | null): Promise<void> {
  requireArea(actor, "recruiters");
  if (decision === "REJECT" && !note?.trim()) throw badRequest("Tell the applicant why, so they can fix it", "NOTE_REQUIRED");
  await withTransaction(async (trx, fx) => {
    const r = await trx.selectFrom("recruiters").selectAll().where("id", "=", recruiterId).forUpdate().executeTakeFirst();
    if (!r) throw notFound("Recruiter not found");
    if (r.user_id === actor.id) throw forbidden("You cannot review your own application", "SELF_REVIEW");
    if (r.status !== "PENDING_REVIEW") throw conflict("This application is not waiting for review", "NOT_PENDING_REVIEW");
    const now = new Date();
    await trx.updateTable("recruiters").set({ status: decision === "APPROVE" ? "ACTIVE" : "REJECTED", review_note: note, reviewed_by: actor.id, reviewed_at: now, updated_at: now }).where("id", "=", r.id).execute();
    if (decision === "APPROVE") await trx.updateTable("companies").set({ member_count: sql`member_count + 1` }).where("id", "=", r.company_id).execute();
    await audit({ actorId: actor.id, action: `recruiter.${decision === "APPROVE" ? "approve" : "reject"}`, entityType: "recruiter", entityId: r.id, ip, data: { note } }, trx);
    const company = await trx.selectFrom("companies").select("name").where("id", "=", r.company_id).executeTakeFirstOrThrow();
    await notify({ recipientId: r.user_id, actorId: null, type: decision === "APPROVE" ? "RECRUITER_APPROVED" : "RECRUITER_REJECTED", entityType: "recruiter", entityId: r.id, snippet: decision === "APPROVE" ? company.name : (note ?? company.name) }, fx, trx);
    fx.after(() => decisionMail(r.id, decision === "APPROVE", note, db));
  });
}

/** Suspend a recruiter: their pending approaches are withdrawn and every contact unlock ends. */
export async function suspendRecruiter(actor: Actor, recruiterId: string, reason: string, ip: string | null): Promise<void> {
  requireArea(actor, "recruiters");
  await withTransaction(async (trx, fx) => {
    const r = await trx.selectFrom("recruiters").selectAll().where("id", "=", recruiterId).forUpdate().executeTakeFirst();
    if (!r) throw notFound("Recruiter not found");
    if (r.status === "SUSPENDED") throw conflict("Already suspended", "ALREADY_SUSPENDED");
    const now = new Date();
    await trx.updateTable("recruiters").set({ status: "SUSPENDED", suspended_reason: reason, updated_at: now }).where("id", "=", r.id).execute();
    await trx.updateTable("approaches").set({ status: "WITHDRAWN", responded_at: now }).where("recruiter_id", "=", r.id).where("status", "=", "PENDING").execute();
    await trx.updateTable("contact_unlocks").set({ revoked_at: now, revoked_reason: "Recruiter suspended" }).where("recruiter_id", "=", r.id).where("revoked_at", "is", null).execute();
    if (r.status === "ACTIVE") await trx.updateTable("companies").set({ member_count: sql`greatest(0, member_count - 1)` }).where("id", "=", r.company_id).execute();
    await leaveCompanyJobRooms(fx, r.user_id, r.company_id, trx);
    await audit({ actorId: actor.id, action: "recruiter.suspend", entityType: "recruiter", entityId: r.id, ip, data: { reason, from: r.status } }, trx);
  });
}

export async function reinstateRecruiter(actor: Actor, recruiterId: string, ip: string | null): Promise<void> {
  requireArea(actor, "recruiters");
  await withTransaction(async (trx, fx) => {
    const r = await trx.updateTable("recruiters").set({ status: "ACTIVE", suspended_reason: null, updated_at: new Date() }).where("id", "=", recruiterId).where("status", "=", "SUSPENDED").where("work_email_verified_at", "is not", null).returning(["id", "company_id", "user_id"]).executeTakeFirst();
    if (!r) throw conflict("Only a suspended recruiter with a confirmed work email can be reinstated", "NOT_REINSTATABLE");
    await trx.updateTable("companies").set({ member_count: sql`member_count + 1` }).where("id", "=", r.company_id).execute();
    await audit({ actorId: actor.id, action: "recruiter.reinstate", entityType: "recruiter", entityId: r.id, ip }, trx);
    await notify({ recipientId: r.user_id, actorId: null, type: "RECRUITER_APPROVED", entityType: "recruiter", entityId: r.id, snippet: "Your recruiter account is active again" }, fx, trx);
  });
}

export async function setRecruiterQuota(actor: Actor, recruiterId: string, quota: number | null, ip: string | null): Promise<void> {
  requireArea(actor, "recruiters");
  const res = await db.updateTable("recruiters").set({ approach_quota_daily: quota, updated_at: new Date() }).where("id", "=", recruiterId).executeTakeFirst();
  if (Number(res.numUpdatedRows) !== 1) throw notFound("Recruiter not found");
  await audit({ actorId: actor.id, action: "recruiter.quota", entityType: "recruiter", entityId: recruiterId, ip, data: { quota } });
}

// ─── Companies ──────────────────────────────────────────────────────────────

export async function listCompanies(actor: Actor, q: { status?: AdminCompanyRow["status"]; q?: string; cursor?: string; limit: number }): Promise<Page<AdminCompanyRow>> {
  requireArea(actor, "companies");
  const c = decodeCursor(q.cursor);
  let query = db.selectFrom("companies").selectAll();
  if (q.status) query = query.where("status", "=", q.status);
  if (q.q) query = query.where((eb) => eb.or([sql<boolean>`name ILIKE ${likeContains(q.q!)}`, eb("slug", "=", q.q!), sql<boolean>`${q.q!.toLowerCase()} = ANY(domains::text[])`]));
  if (c) query = query.where((eb) => eb.or([eb(msOf("created_at"), "<", c.at), eb.and([eb(msOf("created_at"), "=", c.at), eb("id", "<", c.id)])]));
  const rows = await query.orderBy(msOf("created_at"), "desc").orderBy("id", "desc").limit(q.limit + 1).execute();
  const page = toPage(rows, q.limit, (r) => ({ at: r.created_at, id: r.id }));
  return { items: await companyRows(page.items), nextCursor: page.nextCursor };
}

async function companyRows(rows: Awaited<ReturnType<typeof companyById>>[]): Promise<AdminCompanyRow[]> {
  const summaries = new Map((await presentCompanySummaries(rows, null)).map((s) => [s.id, s]));
  return rows.map((r) => ({ ...summaries.get(r.id)!, domains: r.domains.map(String), autoApproveDomain: r.auto_approve_domain, memberCount: r.member_count, website: r.website, verifiedAt: r.verified_at?.toISOString() ?? null, suspendedReason: r.suspended_reason, createdAt: r.created_at.toISOString() }));
}

function companyById(id: string) {
  return db.selectFrom("companies").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
}

export async function updateCompany(actor: Actor, id: string, p: { status?: "VERIFIED" | "UNVERIFIED" | "SUSPENDED"; reason?: string | null; domains?: string[]; autoApproveDomain?: boolean }, ip: string | null): Promise<AdminCompanyRow> {
  requireArea(actor, "companies");
  if (p.status === "SUSPENDED" && !p.reason?.trim()) throw badRequest("Give a reason for suspending the company", "REASON_REQUIRED");
  await withTransaction(async (trx, fx) => {
    const row = await trx.selectFrom("companies").selectAll().where("id", "=", id).forUpdate().executeTakeFirst();
    if (!row) throw notFound("Company not found", "COMPANY_NOT_FOUND");
    const now = new Date();
    const domains = p.domains ? [...new Set(p.domains.map((d) => baseDomain(d.trim())).filter((d): d is string => !!d))].slice(0, 10) : undefined;
    await trx
      .updateTable("companies")
      .set({
        ...(p.status ? { status: p.status } : {}),
        ...(p.status === "VERIFIED" ? { verified_at: now, verified_by: actor.id, suspended_reason: null } : {}),
        ...(p.status === "UNVERIFIED" ? { verified_at: null, verified_by: null, suspended_reason: null } : {}),
        ...(p.status === "SUSPENDED" ? { suspended_reason: p.reason ?? null } : {}),
        ...(domains ? { domains } : {}),
        ...(p.autoApproveDomain !== undefined ? { auto_approve_domain: p.autoApproveDomain } : {}),
        updated_at: now,
      })
      .where("id", "=", id)
      .execute();
    if (p.status === "SUSPENDED" && row.status !== "SUSPENDED") {
      // A suspended company recruits nobody: its pending approaches are withdrawn, its jobs close.
      await trx.updateTable("approaches").set({ status: "WITHDRAWN", responded_at: now }).where("company_id", "=", id).where("status", "=", "PENDING").execute();
      await trx.updateTable("jobs").set({ status: "CLOSED", closed_at: now }).where("company_id", "=", id).where("status", "=", "OPEN").execute();
      await counters.refreshOpenJobs(id, trx);
      // Its team stops receiving live pipeline cards at once.
      for (const m of await trx.selectFrom("recruiters").select("user_id").where("company_id", "=", id).execute()) await leaveCompanyJobRooms(fx, m.user_id, id, trx);
    }
    await audit({ actorId: actor.id, action: "company.admin_update", entityType: "company", entityId: id, ip, data: { from: { status: row.status, domains: row.domains }, to: p } }, trx);
  });
  return (await companyRows([await companyById(id)]))[0]!;
}

// ─── Jobs ───────────────────────────────────────────────────────────────────

export async function listJobs(actor: Actor, q: { status?: Job["status"]; q?: string; cursor?: string; limit: number }): Promise<Page<Job>> {
  requireArea(actor, "jobs");
  const c = decodeCursor(q.cursor);
  let query = db.selectFrom("jobs").selectAll();
  if (q.status) query = query.where("status", "=", q.status);
  if (q.q) query = query.where(sql<boolean>`title ILIKE ${likeContains(q.q)}`);
  if (c) query = query.where((eb) => eb.or([eb(msOf("created_at"), "<", c.at), eb.and([eb(msOf("created_at"), "=", c.at), eb("id", "<", c.id)])]));
  const rows = await query.orderBy(msOf("created_at"), "desc").orderBy("id", "desc").limit(q.limit + 1).execute();
  const page = toPage(rows, q.limit, (r) => ({ at: r.created_at, id: r.id }));
  return { items: await presentJobs(actor, page.items), nextCursor: page.nextCursor };
}

export async function closeJob(actor: Actor, id: string, reason: string, ip: string | null): Promise<void> {
  requireArea(actor, "jobs");
  await withTransaction(async (trx) => {
    const job = await trx.updateTable("jobs").set({ status: "CLOSED", closed_at: new Date(), updated_at: new Date() }).where("id", "=", id).where("status", "=", "OPEN").returning(["id", "company_id"]).executeTakeFirst();
    if (!job) throw conflict("This job is not open", "JOB_NOT_OPEN");
    await counters.refreshOpenJobs(job.company_id, trx);
    await audit({ actorId: actor.id, action: "job.admin_close", entityType: "job", entityId: id, ip, data: { reason } }, trx);
  });
}

// ─── Complaints ─────────────────────────────────────────────────────────────

export async function listComplaints(actor: Actor, q: { status?: ComplaintStatus; cursor?: string; limit: number }): Promise<Page<AdminComplaintRow>> {
  requireArea(actor, "complaints");
  const c = decodeCursor(q.cursor);
  let query = db.selectFrom("complaints").selectAll();
  query = q.status ? query.where("status", "=", q.status) : query.where("status", "in", ["OPEN", "UNDER_REVIEW"]);
  if (c) query = query.where((eb) => eb.or([eb(msOf("created_at"), ">", c.at), eb.and([eb(msOf("created_at"), "=", c.at), eb("id", ">", c.id)])]));
  const rows = await query.orderBy(msOf("created_at"), "asc").orderBy("id", "asc").limit(q.limit + 1).execute();
  const page = toPage(rows, q.limit, (r) => ({ at: r.created_at, id: r.id }));
  const ids = page.items.flatMap((r) => [r.complainant_id, r.against_user_id]);
  const [people, emails, priors, media] = await Promise.all([
    loadSummaries(ids),
    db.selectFrom("users").select(["id", "email"]).where("id", "in", ids.length ? ids : [""]).execute(),
    sql<{ against_user_id: string; n: number }>`SELECT against_user_id, count(*)::int AS n FROM complaints WHERE against_user_id = ANY(${page.items.map((r) => r.against_user_id)}::text[]) GROUP BY 1`.execute(db),
    // Evidence is signed the same way trust.service shows it to the complainant.
    loadMedia(page.items.flatMap((r) => r.evidence_upload_ids)),
  ]);
  const email = new Map(emails.map((e) => [e.id, String(e.email)]));
  const prior = new Map(priors.rows.map((p) => [p.against_user_id, Number(p.n)]));
  return {
    items: page.items
      .filter((r) => people.has(r.complainant_id) && people.has(r.against_user_id))
      .map((r) => ({
        id: r.id,
        complainant: { ...people.get(r.complainant_id)!, email: email.get(r.complainant_id) ?? "" },
        against: { ...people.get(r.against_user_id)!, email: email.get(r.against_user_id) ?? "" },
        category: r.category,
        description: r.description,
        evidenceCount: r.evidence_upload_ids.length,
        evidence: r.evidence_upload_ids.map((id) => media.get(id)).filter((m): m is NonNullable<typeof m> => !!m),
        engagementId: r.engagement_id,
        approachId: r.approach_id,
        applicationId: r.application_id,
        status: r.status,
        adminNote: r.admin_note,
        priorComplaintsAgainst: Math.max(0, (prior.get(r.against_user_id) ?? 1) - 1),
        createdAt: r.created_at.toISOString(),
        resolvedAt: r.resolved_at?.toISOString() ?? null,
      })),
    nextCursor: page.nextCursor,
  };
}

/**
 * Resolve a complaint, optionally taking an action against the account it names
 * (WARN or SUSPEND through the moderation module, linked on the complaint). Both
 * parties are notified of the outcome; the admin note is shown to both.
 */
export async function resolveComplaint(actor: Actor, id: string, input: { status: Exclude<ComplaintStatus, "OPEN">; note: string | null; action?: { kind: "WARN" | "SUSPEND"; days?: number } }, ip: string | null): Promise<void> {
  requireArea(actor, "complaints");
  if (input.status !== "UNDER_REVIEW" && !input.note?.trim()) throw badRequest("Write a short note both sides will read", "NOTE_REQUIRED");
  await withTransaction(async (trx, fx) => {
    const c = await trx.selectFrom("complaints").selectAll().where("id", "=", id).forUpdate().executeTakeFirst();
    if (!c) throw notFound("Complaint not found");
    if (c.status === "ACTION_TAKEN" || c.status === "DISMISSED") throw conflict("This complaint is already resolved", "COMPLAINT_RESOLVED");
    if (c.complainant_id === actor.id || c.against_user_id === actor.id) throw forbidden("You are part of this complaint", "SELF_REVIEW");
    let actionId: string | null = null;
    if (input.action && input.status === "ACTION_TAKEN") {
      await applyAccountAction(actor, c.against_user_id, input.action.kind, { days: input.action.days, reason: input.note, ip }, trx, fx);
      actionId = (await trx.selectFrom("moderation_actions").select("id").where("actor_id", "=", actor.id).where("target_id", "=", c.against_user_id).orderBy("created_at", "desc").executeTakeFirst())?.id ?? null;
    }
    const final = input.status !== "UNDER_REVIEW";
    await trx.updateTable("complaints").set({ status: input.status, admin_note: input.note, action_id: actionId, ...(final ? { resolved_by: actor.id, resolved_at: new Date() } : {}) }).where("id", "=", id).execute();
    await audit({ actorId: actor.id, action: `complaint.${input.status.toLowerCase()}`, entityType: "complaint", entityId: id, ip, data: { note: input.note, action: input.action ?? null } }, trx);
    if (final) for (const recipient of [c.complainant_id, c.against_user_id]) await notify({ recipientId: recipient, actorId: null, type: "COMPLAINT_UPDATED", entityType: "complaint", entityId: id, snippet: input.note }, fx, trx);
  });
}

export async function hideRating(actor: Actor, ratingId: string, reason: string, ip: string | null): Promise<void> {
  requireArea(actor, "complaints");
  await withTransaction(async (trx) => {
    const r = await trx.updateTable("ratings").set({ hidden_at: new Date(), hidden_reason: reason }).where("id", "=", ratingId).where("hidden_at", "is", null).returning(["ratee_id", "direction"]).executeTakeFirst();
    if (!r) throw notFound("Rating not found");
    if (r.direction === "RECRUITER_TO_CANDIDATE") {
      const scores = await trx.selectFrom("ratings").select("score").where("ratee_id", "=", r.ratee_id).where("direction", "=", r.direction).where("revealed_at", "is not", null).where("hidden_at", "is", null).execute();
      const avg = scores.length ? Math.round((scores.reduce((a, b) => a + b.score, 0) / scores.length) * 100) / 100 : null;
      await trx.updateTable("talent_profiles").set({ rating_avg: avg, rating_count: scores.length }).where("user_id", "=", r.ratee_id).execute();
    }
    await audit({ actorId: actor.id, action: "rating.hide", entityType: "rating", entityId: ratingId, ip, data: { reason } }, trx);
  });
}

// ─── Audit ──────────────────────────────────────────────────────────────────

export async function listAudit(actor: Actor, q: { action?: string; actorId?: string; entityType?: string; entityId?: string; cursor?: string; limit: number }): Promise<Page<AuditEntry>> {
  requireArea(actor, "audit");
  const c = decodeCursor(q.cursor);
  let query = db.selectFrom("audit_log").select(["id", "actor_id", "action", "entity_type", "entity_id", "data", "created_at"]);
  if (q.action) query = query.where("action", "like", `${q.action.replace(/[\\%_]/g, "\\$&")}%`);
  if (q.actorId) query = query.where("actor_id", "=", q.actorId);
  if (q.entityType) query = query.where("entity_type", "=", q.entityType);
  if (q.entityId) query = query.where("entity_id", "=", q.entityId);
  if (c) query = query.where((eb) => eb.or([eb(msOf("created_at"), "<", c.at), eb.and([eb(msOf("created_at"), "=", c.at), eb("id", "<", c.id)])]));
  const rows = await query.orderBy(msOf("created_at"), "desc").orderBy("id", "desc").limit(q.limit + 1).execute();
  const page = toPage(rows, q.limit, (r) => ({ at: r.created_at, id: r.id }));
  const people = await loadSummaries(page.items.map((r) => r.actor_id));
  return {
    items: page.items.map((r) => ({
      id: r.id,
      actor: r.actor_id ? (people.get(r.actor_id) ?? null) : null,
      action: r.action,
      entityType: r.entity_type,
      entityId: r.entity_id,
      data: (r.data as Record<string, unknown>) ?? {},
      createdAt: r.created_at.toISOString(),
    })),
    nextCursor: page.nextCursor,
  };
}
