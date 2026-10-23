/**
 * The talent page: the owner's editor (basics, open-to-work, rate, private contact,
 * sections, per-section visibility, publish, username), the public read for everyone
 * else, view counting, analytics, endorsements and badge visibility.
 *
 * Rules (several fix the source system):
 *   - A profile is public only when its owner publishes it. Publishing needs
 *     completeness >= settings.profile.publishThreshold and at least one private contact
 *     channel; nothing is ever published on someone's behalf.
 *   - UNLISTED profiles open by direct link but stay out of the directory and search.
 *   - Every URL goes through safeUrl(); section sizes are bounded by the validators.
 *   - A renamed username keeps resolving (301 to the new handle); a username can change
 *     once per settings.profile.usernameCooldownDays.
 *   - Views count once per viewer per profile per day; signed-out viewers are keyed by a
 *     salted hash of their IP, never the IP itself.
 *   - Only connections can endorse a skill.
 */
import type { ContactAccessEntry, MyProfile, Profile, ProfileAnalytics, ProfileSection, SectionAudience } from "@open-talent/types";
import crypto from "node:crypto";
import { sql } from "kysely";
import { config } from "../core/config";
import type { Actor } from "../core/context";
import { isStaff, requireActive } from "../core/context";
import { withTransaction } from "../core/effects";
import { badRequest, conflict, forbidden, HttpError, notFound } from "../core/errors";
import { newId } from "../core/ids";
import { db, type Executor } from "../db/kysely";
import { parseYearMonth } from "../domain/months";
import { completeness, publishBlock } from "../domain/profile";
import { safeUrl } from "../domain/safe-url";
import { uniqueSkills } from "../domain/search-text";
import { isReservedUsername, USERNAME_PATTERN, usernameSuggestions } from "../domain/username";
import { activeRecruiterOf, presentMyProfile, presentProfile, type ProfileContext } from "../presenters/profile.presenter";
import { loadSummaries } from "../presenters/user.presenter";
import { areConnected, isBlockedEitherWay } from "../repositories/visibility";
import { profileRepo, usernameHeldByHistory, type ProfileRow } from "../repositories/profile.repository";
import { audit } from "./audit.service";
import { claimSingle } from "./media-attach.service";
import { notify } from "./notification.service";
import { getSettings } from "./settings.service";

type FullRow = ProfileContext["row"];

async function ownRow(actor: Actor, exec: Executor = db): Promise<FullRow> {
  const r = await exec
    .selectFrom("talent_profiles as p")
    .innerJoin("users as u", "u.id", "p.user_id")
    .selectAll("p")
    .select(["u.username", "u.display_name", "u.cover_upload_id", "u.connection_count", "u.follower_count"])
    .where("p.user_id", "=", actor.id)
    .executeTakeFirst();
  if (r) return r;
  // Accounts created before profiles existed (or by an older seed): create it now.
  await exec.insertInto("talent_profiles").values({ id: newId(), user_id: actor.id }).onConflict((oc) => oc.column("user_id").doNothing()).execute();
  return ownRow(actor, exec);
}

async function contextFor(row: FullRow, exec: Executor = db): Promise<ProfileContext> {
  const [sections, badges] = await Promise.all([profileRepo.sections(row.id, exec), profileRepo.badges(row.id, exec)]);
  return { row, sections, badges };
}

export async function getMine(actor: Actor): Promise<MyProfile> {
  const row = await ownRow(actor);
  const ctx = await contextFor(row);
  const settings = await getSettings();
  const { missing } = completeness({
    headline: !!row.headline?.trim(),
    about: !!row.about?.trim(),
    avatar: !!(await db.selectFrom("users").select("avatar_upload_id").where("id", "=", actor.id).executeTakeFirst())?.avatar_upload_id,
    skills: ctx.sections.skills.length > 0,
    experience: ctx.sections.experience.length > 0,
    projects: ctx.sections.projects.length > 0,
    education: ctx.sections.education.length > 0,
    links: ctx.sections.links.length > 0,
    contact: !!(row.contact_email || row.contact_phone || row.whatsapp_phone),
  });
  return presentMyProfile(actor, ctx, missing, settings.profile.publishThreshold);
}

// ─── Basics ─────────────────────────────────────────────────────────────────

export interface BasicsPatch {
  headline?: string | null;
  about?: string | null;
  currentTitle?: string | null;
  currentCompany?: string | null;
  location?: string | null;
  countryCode?: string | null;
  timezone?: string | null;
  yearsExperience?: number | null;
  languages?: string[];
  rate?: { min: number | null; max: number | null; currency: string | null; period: ProfileRow["rate_period"] } | null;
}

/** Fields other people see: a change to any of them is scanned (a REVIEW case at most, never a hide). */
const SCANNED: (keyof BasicsPatch)[] = ["headline", "about", "currentTitle", "currentCompany", "location"];

async function save(actor: Actor, build: (row: FullRow, trx: Executor) => Promise<Partial<ProfileRow>>, opts: { scan?: boolean } = {}): Promise<MyProfile> {
  requireActive(actor);
  await withTransaction(async (trx, fx) => {
    const row = await ownRow(actor, trx);
    await trx.selectFrom("talent_profiles").select("id").where("id", "=", row.id).forUpdate().execute();
    const patch = await build(row, trx);
    if (Object.keys(patch).length) await profileRepo.update(row.id, patch, trx);
    await profileRepo.refreshDerived(row.id, trx);
    if (opts.scan && (row.status === "PUBLISHED" || row.status === "UNLISTED")) fx.job("moderation.scan", { targetType: "PROFILE", targetId: row.id });
  });
  return getMine(actor);
}

export async function updateBasics(actor: Actor, p: BasicsPatch): Promise<MyProfile> {
  if (p.rate && p.rate.min !== null && p.rate.max !== null && p.rate.max < p.rate.min) throw badRequest("The upper rate is below the lower one", "RATE_INVALID");
  return save(
    actor,
    async () => ({
      ...(p.headline !== undefined ? { headline: p.headline } : {}),
      ...(p.about !== undefined ? { about: p.about } : {}),
      ...(p.currentTitle !== undefined ? { current_title: p.currentTitle } : {}),
      ...(p.currentCompany !== undefined ? { current_company: p.currentCompany } : {}),
      ...(p.location !== undefined ? { location: p.location } : {}),
      ...(p.countryCode !== undefined ? { country_code: p.countryCode?.toUpperCase() ?? null } : {}),
      ...(p.timezone !== undefined ? { timezone: p.timezone } : {}),
      ...(p.yearsExperience !== undefined ? { years_experience: p.yearsExperience } : {}),
      ...(p.languages !== undefined ? { languages: p.languages } : {}),
      ...(p.rate !== undefined ? { rate_min: p.rate?.min ?? null, rate_max: p.rate?.max ?? null, rate_currency: p.rate?.currency?.toUpperCase() ?? null, rate_period: p.rate?.period ?? null } : {}),
    }),
    { scan: SCANNED.some((k) => p[k] !== undefined) },
  );
}

export async function updateOpenToWork(actor: Actor, p: { mode: ProfileRow["open_to_work"]; roles: string[]; employmentTypes: ProfileRow["employment_types"]; workplaceTypes: ProfileRow["workplace_types"]; availableFrom: string | null }): Promise<MyProfile> {
  return save(actor, async () => ({
    open_to_work: p.mode,
    open_to_roles: p.roles,
    employment_types: p.employmentTypes,
    workplace_types: p.workplaceTypes,
    available_from: p.availableFrom ? new Date(`${p.availableFrom}T00:00:00Z`) : null,
  }));
}

/** Private contact details. They are never in a Profile; recruiters see them only after the owner shares a channel. */
export async function updateContact(actor: Actor, p: { email: string | null; phone: string | null; whatsapp: string | null }): Promise<MyProfile> {
  return save(actor, async () => ({ contact_email: p.email, contact_phone: p.phone, whatsapp_phone: p.whatsapp }));
}

export async function updateVisibility(actor: Actor, p: Partial<Record<ProfileSection, SectionAudience>>): Promise<MyProfile> {
  return save(actor, async (row) => ({ section_visibility: JSON.stringify({ ...((row.section_visibility as object) ?? {}), ...p }) }));
}

export async function setCover(actor: Actor, uploadId: string | null): Promise<MyProfile> {
  const cover = await claimSingle(actor.id, uploadId, "COVER");
  await db.updateTable("users").set({ cover_upload_id: cover, updated_at: new Date() }).where("id", "=", actor.id).execute();
  return getMine(actor);
}

// ─── Sections ───────────────────────────────────────────────────────────────

export interface ExperienceInput {
  title: string;
  companyName: string;
  companySlug?: string | null;
  employmentType?: ProfileRow["employment_types"][number] | null;
  workplaceType?: ProfileRow["workplace_types"][number] | null;
  location?: string | null;
  startMonth: string;
  endMonth?: string | null;
  description?: string | null;
  skills?: string[];
}
export interface EducationInput {
  institution: string;
  degree?: string | null;
  field?: string | null;
  startYear?: number | null;
  endYear?: number | null;
  grade?: string | null;
  description?: string | null;
}
export interface ProjectInput {
  name: string;
  description?: string | null;
  url?: string | null;
  repoUrl?: string | null;
  coverUploadId?: string | null;
  skills?: string[];
  startMonth?: string | null;
  endMonth?: string | null;
}
export interface SkillInput {
  name: string;
  category?: string | null;
  years?: number | null;
}
export interface CertificationInput {
  name: string;
  issuer?: string | null;
  issuedMonth?: string | null;
  expiresMonth?: string | null;
  credentialId?: string | null;
  credentialUrl?: string | null;
}
export interface LinkInput {
  kind: "WEBSITE" | "GITHUB" | "LINKEDIN" | "X" | "YOUTUBE" | "MEDIUM" | "KAGGLE" | "HUGGINGFACE" | "BEHANCE" | "DRIBBBLE" | "OTHER";
  url: string;
  label?: string | null;
  featured?: boolean;
}

export type SectionInput =
  | { section: "experience"; items: ExperienceInput[] }
  | { section: "education"; items: EducationInput[] }
  | { section: "projects"; items: ProjectInput[] }
  | { section: "skills"; items: SkillInput[] }
  | { section: "certifications"; items: CertificationInput[] }
  | { section: "links"; items: LinkInput[] };

function month(raw: string | null | undefined, label: string): Date | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const d = parseYearMonth(raw);
  if (!d) throw badRequest(`${label} must be a month like 2024-03`, "MONTH_INVALID");
  return d;
}

function url(raw: string | null | undefined, label: string): string | null {
  if (!raw?.trim()) return null;
  const u = safeUrl(raw);
  if (!u) throw badRequest(`${label} is not a valid web address`, "URL_INVALID", { value: raw.slice(0, 100) });
  return u;
}

/** Turn validated input into rows. Shared with the AI import, which feeds the same shapes. */
export async function sectionRows(ownerId: string, input: SectionInput, exec: Executor): Promise<Record<string, unknown>[]> {
  switch (input.section) {
    case "experience": {
      const slugs = [...new Set(input.items.map((i) => i.companySlug).filter((x): x is string => !!x))];
      const companies = slugs.length ? await exec.selectFrom("companies").select(["id", "slug"]).where("slug", "in", slugs).where("status", "<>", "SUSPENDED").execute() : [];
      const bySlug = new Map(companies.map((c) => [String(c.slug).toLowerCase(), c.id]));
      return input.items.map((i) => {
        const start = month(i.startMonth, "Start");
        if (!start) throw badRequest("Each role needs a start month", "MONTH_INVALID");
        const end = month(i.endMonth, "End");
        if (end && end < start) throw badRequest(`"${i.title}" ends before it starts`, "DATES_INVALID");
        return {
          id: newId(),
          title: i.title,
          company_name: i.companyName,
          company_id: i.companySlug ? (bySlug.get(i.companySlug.toLowerCase()) ?? null) : null,
          employment_type: i.employmentType ?? null,
          workplace_type: i.workplaceType ?? null,
          location: i.location ?? null,
          start_month: start,
          end_month: end,
          description: i.description ?? null,
          skills: uniqueSkills(i.skills ?? [], 20),
        };
      });
    }
    case "education":
      return input.items.map((i) => {
        if (i.startYear && i.endYear && i.endYear < i.startYear) throw badRequest(`"${i.institution}" ends before it starts`, "DATES_INVALID");
        return { id: newId(), institution: i.institution, degree: i.degree ?? null, field: i.field ?? null, start_year: i.startYear ?? null, end_year: i.endYear ?? null, grade: i.grade ?? null, description: i.description ?? null };
      });
    case "projects": {
      const rows: Record<string, unknown>[] = [];
      for (const i of input.items) {
        rows.push({
          id: newId(),
          name: i.name,
          description: i.description ?? null,
          url: url(i.url, "Project link"),
          repo_url: url(i.repoUrl, "Repository link"),
          cover_upload_id: i.coverUploadId ? await claimSingle(ownerId, i.coverUploadId, "PROJECT_COVER", exec) : null,
          skills: uniqueSkills(i.skills ?? [], 20),
          start_month: month(i.startMonth, "Start"),
          end_month: month(i.endMonth, "End"),
        });
      }
      return rows;
    }
    case "skills": {
      const names = uniqueSkills(input.items.map((i) => i.name), 50);
      // The first spelling wins (as in uniqueSkills), and so do its category and years.
      const byName = new Map([...input.items].reverse().map((i) => [i.name.trim().toLowerCase(), i]));
      return names.map((name) => {
        const i = byName.get(name.toLowerCase());
        return { id: newId(), name, category: i?.category ?? null, years: i?.years ?? null };
      });
    }
    case "certifications":
      return input.items.map((i) => ({
        id: newId(),
        name: i.name,
        issuer: i.issuer ?? null,
        issued_month: month(i.issuedMonth, "Issued"),
        expires_month: month(i.expiresMonth, "Expiry"),
        credential_id: i.credentialId ?? null,
        credential_url: url(i.credentialUrl, "Credential link"),
      }));
    case "links":
      return input.items.map((i) => ({ id: newId(), kind: i.kind, url: url(i.url, "Link") as string, label: i.label ?? null, featured: !!i.featured }));
  }
}

const TABLE = {
  experience: "profile_experiences",
  education: "profile_educations",
  projects: "profile_projects",
  skills: "profile_skills",
  certifications: "profile_certifications",
  links: "profile_links",
} as const;

export async function replaceSection(actor: Actor, input: SectionInput): Promise<MyProfile> {
  return save(
    actor,
    async (row, trx) => {
      const rows = await sectionRows(actor.id, input, trx);
      await profileRepo.replace(TABLE[input.section], row.id, rows, trx);
      return {};
    },
    { scan: true },
  );
}

// ─── Publish and username ───────────────────────────────────────────────────

const PUBLISH_COPY = {
  SUSPENDED: "This profile is suspended. You can appeal from your moderation page.",
  INCOMPLETE: "Add a bit more first: a headline, a short About section, and at least one role or project.",
  NO_CONTACT: "Add at least one private contact channel so recruiters can reach you once you say yes.",
} as const;

export async function setStatus(actor: Actor, next: "PUBLISHED" | "UNLISTED" | "DRAFT"): Promise<MyProfile> {
  requireActive(actor);
  const settings = await getSettings();
  await withTransaction(async (trx, fx) => {
    const row = await ownRow(actor, trx);
    if (row.status === "SUSPENDED") throw forbidden(PUBLISH_COPY.SUSPENDED, "PROFILE_SUSPENDED");
    if (next !== "DRAFT") {
      const { score } = await profileRepo.refreshDerived(row.id, trx);
      const fresh = await profileRepo.byId(row.id, trx);
      const block = publishBlock({ status: row.status, score, hasContact: !!(fresh?.contact_email || fresh?.contact_phone || fresh?.whatsapp_phone) }, settings.profile.publishThreshold);
      if (block) throw new HttpError(422, PUBLISH_COPY[block], `PUBLISH_${block}`, { completeness: score, threshold: settings.profile.publishThreshold });
    }
    await profileRepo.update(row.id, { status: next, ...(next === "PUBLISHED" && !row.published_at ? { published_at: new Date() } : {}) }, trx);
    await audit({ actorId: actor.id, action: `profile.${next.toLowerCase()}`, entityType: "profile", entityId: row.id }, trx);
    if (next !== "DRAFT") fx.job("moderation.scan", { targetType: "PROFILE", targetId: row.id });
  });
  return getMine(actor);
}

export async function usernameAvailable(username: string, actor: Actor | null): Promise<{ available: boolean; reason: "INVALID" | "RESERVED" | "TAKEN" | null; suggestions: string[] }> {
  const u = username.trim();
  const display = actor?.displayName ?? u;
  if (!USERNAME_PATTERN.test(u)) return { available: false, reason: "INVALID", suggestions: await freeSuggestions(display) };
  if (isReservedUsername(u)) return { available: false, reason: "RESERVED", suggestions: await freeSuggestions(display) };
  const owner = await db.selectFrom("users").select("id").where("username", "=", u).executeTakeFirst();
  if ((owner && owner.id !== actor?.id) || (await usernameHeldByHistory(u))) {
    const history = await db.selectFrom("username_history").select("user_id").where("old_username", "=", u).executeTakeFirst();
    if (!(history && history.user_id === actor?.id)) return { available: false, reason: "TAKEN", suggestions: await freeSuggestions(display) };
  }
  return { available: true, reason: null, suggestions: [] };
}

async function freeSuggestions(displayName: string): Promise<string[]> {
  const candidates = usernameSuggestions(displayName, 8);
  if (!candidates.length) return [];
  const [taken, held] = await Promise.all([
    db.selectFrom("users").select("username").where("username", "in", candidates).execute(),
    db.selectFrom("username_history").select("old_username").where("old_username", "in", candidates).execute(),
  ]);
  const used = new Set([...taken.map((t) => String(t.username).toLowerCase()), ...held.map((h) => String(h.old_username).toLowerCase())]);
  return candidates.filter((c) => !used.has(c.toLowerCase())).slice(0, 4);
}

export async function changeUsername(actor: Actor, username: string): Promise<MyProfile> {
  requireActive(actor);
  const check = await usernameAvailable(username, actor);
  if (!check.available) throw conflict(check.reason === "INVALID" ? "Use 3 to 40 letters, digits or hyphens" : "That username is not available", `USERNAME_${check.reason}`, { suggestions: check.suggestions });
  const settings = await getSettings();
  await withTransaction(async (trx) => {
    const user = await trx.selectFrom("users").select(["id", "username"]).where("id", "=", actor.id).forUpdate().executeTakeFirstOrThrow();
    if (String(user.username).toLowerCase() === username.toLowerCase()) return;
    const last = await trx.selectFrom("username_history").select("created_at").where("user_id", "=", actor.id).orderBy("created_at", "desc").executeTakeFirst();
    // A cooldown of 0 means none (the row's time is the database clock, which may run ahead of ours).
    if (last && settings.profile.usernameCooldownDays > 0 && last.created_at.getTime() + settings.profile.usernameCooldownDays * 86400_000 > Date.now()) {
      throw new HttpError(429, `You can change your username once every ${settings.profile.usernameCooldownDays} days`, "USERNAME_COOLDOWN", { retryAt: new Date(last.created_at.getTime() + settings.profile.usernameCooldownDays * 86400_000).toISOString() });
    }
    // Reclaiming your own old handle removes it from history.
    await trx.deleteFrom("username_history").where("old_username", "=", username).where("user_id", "=", actor.id).execute();
    await trx.insertInto("username_history").values({ old_username: user.username, user_id: actor.id }).onConflict((oc) => oc.column("old_username").doNothing()).execute();
    await trx.updateTable("users").set({ username, updated_at: new Date() }).where("id", "=", actor.id).execute();
    await audit({ actorId: actor.id, action: "profile.username", entityType: "user", entityId: actor.id, data: { from: user.username, to: username } }, trx);
  });
  return getMine(actor);
}

// ─── Public read ────────────────────────────────────────────────────────────

/**
 * A profile by username. PUBLISHED and UNLISTED profiles are readable by anyone (except
 * across a block); DRAFT and SUSPENDED ones by their owner and staff only. A renamed
 * handle answers 301 with details.username so the web app can redirect.
 */
export async function getPublic(viewer: Actor | null, username: string): Promise<Profile> {
  const { row, renamedTo } = await profileRepo.byUsername(username);
  if (!row) {
    if (renamedTo) throw new HttpError(301, "This profile moved", "PROFILE_MOVED", { username: renamedTo });
    throw notFound("Profile not found", "PROFILE_NOT_FOUND");
  }
  const isOwner = viewer?.id === row.user_id;
  const staff = isStaff(viewer);
  if (!isOwner && !staff) {
    if (row.user_status !== "ACTIVE" && row.user_status !== "SUSPENDED") throw notFound("Profile not found", "PROFILE_NOT_FOUND");
    if (row.status !== "PUBLISHED" && row.status !== "UNLISTED") throw notFound("Profile not found", "PROFILE_NOT_FOUND");
    if (viewer && (await isBlockedEitherWay(viewer.id, row.user_id))) throw notFound("Profile not found", "PROFILE_NOT_FOUND");
  }
  return presentProfile(viewer, await contextFor(row));
}

function viewerKey(viewer: Actor | null, ip: string | null): string | null {
  if (viewer) return viewer.id;
  if (!ip) return null;
  return `ip:${crypto.createHmac("sha256", config.VIEW_HASH_SALT).update(ip).digest("hex").slice(0, 32)}`;
}

/** The view beacon. Owners do not count; once per viewer per day. */
export async function recordView(viewer: Actor | null, username: string, ip: string | null): Promise<void> {
  const { row } = await profileRepo.byUsername(username);
  if (!row || viewer?.id === row.user_id || (row.status !== "PUBLISHED" && row.status !== "UNLISTED")) return;
  if (viewer && (await isBlockedEitherWay(viewer.id, row.user_id))) return;
  const key = viewerKey(viewer, ip);
  if (!key) return;
  const recruiter = viewer ? await activeRecruiterOf(viewer.id) : undefined;
  await profileRepo.recordView({ profile_id: row.id, viewer_key: key, viewer_id: viewer?.id ?? null, viewer_company: recruiter?.company_id ?? null });
}

export async function analytics(actor: Actor): Promise<ProfileAnalytics> {
  const row = await ownRow(actor);
  const [series, companies, approaches, appearances] = await Promise.all([
    sql<{ day: string; views: number }>`
      SELECT to_char(d::date, 'YYYY-MM-DD') AS day, count(v.profile_id)::int AS views
        FROM generate_series(current_date - interval '29 days', current_date, interval '1 day') d
        LEFT JOIN profile_views v ON v.profile_id = ${row.id} AND v.day = d::date
       GROUP BY d ORDER BY d`.execute(db),
    sql<{ name: string; slug: string; views: number }>`
      SELECT c.name, c.slug::text AS slug, count(*)::int AS views FROM profile_views v JOIN companies c ON c.id = v.viewer_company
       WHERE v.profile_id = ${row.id} AND v.day >= current_date - 29 AND c.status <> 'SUSPENDED'
       GROUP BY c.id, c.name, c.slug ORDER BY views DESC LIMIT 10`.execute(db),
    db
      .selectFrom("approaches")
      .select([(eb) => eb.fn.countAll<number>().as("total"), sql<number>`count(*) FILTER (WHERE status = 'PENDING')`.as("pending"), sql<number>`count(*) FILTER (WHERE status = 'ACCEPTED')`.as("accepted")])
      .where("candidate_id", "=", actor.id)
      .executeTakeFirstOrThrow(),
    // Appearances in recruiter search are counted as saved-candidate adds plus profile
    // views by recruiters: an honest lower bound, not a guess.
    sql<{ n: number }>`SELECT count(*)::int AS n FROM profile_views WHERE profile_id = ${row.id} AND viewer_company IS NOT NULL AND day >= current_date - 29`.execute(db),
  ]);
  const daily = series.rows.map((r) => ({ date: r.day, views: Number(r.views) }));
  const sum = (days: number) => daily.slice(-days).reduce((a, b) => a + b.views, 0);
  return {
    views7d: sum(7),
    views30d: sum(30),
    daily,
    recruiterCompanies: companies.rows.map((c) => ({ name: c.name, slug: c.slug, views: Number(c.views) })),
    approaches: { pending: Number(approaches.pending), accepted: Number(approaches.accepted), total: Number(approaches.total) },
    searchAppearances30d: Number(appearances.rows[0]?.n ?? 0),
  };
}

/** "Who has seen your details": every logged reveal of a shared contact channel. */
export async function contactLog(actor: Actor, limit = 100): Promise<ContactAccessEntry[]> {
  const rows = await db
    .selectFrom("contact_access_log as l")
    .innerJoin("recruiters as r", "r.id", "l.recruiter_id")
    .innerJoin("companies as c", "c.id", "r.company_id")
    .select(["l.id", "l.channel", "l.viewed_at", "r.user_id", "c.name", "c.slug"])
    .where("l.candidate_id", "=", actor.id)
    .orderBy("l.viewed_at", "desc")
    .limit(limit)
    .execute();
  const users = await loadSummaries(rows.map((r) => r.user_id));
  return rows
    .filter((r) => users.has(r.user_id))
    .map((r) => ({ id: r.id, recruiter: users.get(r.user_id)!, company: { name: r.name, slug: String(r.slug) }, channel: r.channel, viewedAt: r.viewed_at.toISOString() }));
}

// ─── Endorsements and badges ────────────────────────────────────────────────

export async function endorse(actor: Actor, skillId: string, on: boolean): Promise<{ endorsementCount: number; endorsedByViewer: boolean }> {
  requireActive(actor);
  return withTransaction(async (trx, fx) => {
    const skill = await trx
      .selectFrom("profile_skills as s")
      .innerJoin("talent_profiles as p", "p.id", "s.profile_id")
      .innerJoin("users as u", "u.id", "p.user_id")
      .select(["s.id", "s.name", "s.endorsement_count", "p.user_id", "u.username"])
      .where("s.id", "=", skillId)
      .forUpdate("s")
      .executeTakeFirst();
    if (!skill) throw notFound("Skill not found");
    if (skill.user_id === actor.id) throw badRequest("You cannot endorse your own skills", "SELF_ACTION");
    if (!(await areConnected(actor.id, skill.user_id, trx))) throw forbidden("Only connections can endorse skills", "NOT_CONNECTED");
    if (on) {
      const added = await trx.insertInto("skill_endorsements").values({ skill_id: skill.id, endorser_id: actor.id }).onConflict((oc) => oc.columns(["skill_id", "endorser_id"]).doNothing()).returning("skill_id").executeTakeFirst();
      if (added) {
        await trx.updateTable("profile_skills").set({ endorsement_count: sql`endorsement_count + 1` }).where("id", "=", skill.id).execute();
        await notify({ recipientId: skill.user_id, actorId: actor.id, type: "ENDORSEMENT", entityType: "skill", entityId: skill.id, snippet: String(skill.name), data: { username: skill.username } }, fx, trx);
      }
    } else {
      const removed = await trx.deleteFrom("skill_endorsements").where("skill_id", "=", skill.id).where("endorser_id", "=", actor.id).returning("skill_id").executeTakeFirst();
      if (removed) await trx.updateTable("profile_skills").set({ endorsement_count: sql`greatest(0, endorsement_count - 1)` }).where("id", "=", skill.id).execute();
    }
    const fresh = await trx.selectFrom("profile_skills").select("endorsement_count").where("id", "=", skill.id).executeTakeFirstOrThrow();
    return { endorsementCount: fresh.endorsement_count, endorsedByViewer: on };
  });
}

export async function setBadgeVisibility(actor: Actor, badgeId: string, visible: boolean): Promise<MyProfile> {
  const row = await ownRow(actor);
  const res = await db.updateTable("profile_badges").set({ is_visible: visible }).where("id", "=", badgeId).where("profile_id", "=", row.id).executeTakeFirst();
  if (Number(res.numUpdatedRows) !== 1) throw notFound("Badge not found");
  return getMine(actor);
}
