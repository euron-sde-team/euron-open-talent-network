/**
 * Finding people: the talent directory (with recruiter-only filters), facets, global
 * typeahead across people, jobs and companies, and the recruiter workspace's saved
 * candidates and saved searches.
 *
 * Only PUBLISHED profiles of ACTIVE accounts are listed (UNLISTED ones open by link but
 * never appear here), minus anyone with a block either way. The open-to-work filter and
 * badge follow the person's choice: RECRUITERS mode is visible to (and filterable by)
 * ACTIVE recruiters only. Text matches go through the tsvector index or escaped trigram
 * ILIKE; every list is keyset paginated (the source used OFFSET plus count(*) OVER()).
 */
import type { EmploymentType, Page, SearchResults, TalentCard, WorkplaceType } from "@open-talent/types";
import { sql, type Expression, type SqlBool } from "kysely";
import type { Actor } from "../core/context";
import { isStaff, requireActive } from "../core/context";
import { badRequest, notFound } from "../core/errors";
import { newId } from "../core/ids";
import { db } from "../db/kysely";
import { canSeeSection, displayRating, readAudience } from "../domain/profile";
import { likeContains, prefixTsQuery, uniqueSkills } from "../domain/search-text";
import { presentCompanySummaries } from "../presenters/company.presenter";
import { loadSummaries } from "../presenters/user.presenter";
import { connectionRepo } from "../repositories/connection.repository";
import { atKey, belowScore, decodeScore, decodeTime, encodeScore, encodeTime, olderThan, pageBy } from "../repositories/keyset";
import { isActiveRecruiter } from "../repositories/messaging-facts";
import { notBlocked } from "../repositories/visibility";
import * as jobs from "./job.service";
import { requireRecruiter } from "./recruiter.service";

export interface DirectoryQuery {
  q?: string;
  skills?: string[];
  location?: string;
  openToWork?: boolean;
  employment?: EmploymentType[];
  workplace?: WorkplaceType[];
  minYears?: number;
  maxYears?: number;
  sort?: "relevance" | "recent" | "experience";
  cursor?: string;
  limit: number;
}

function base(viewerId: string | null) {
  return db
    .selectFrom("talent_profiles as p")
    .innerJoin("users as u", "u.id", "p.user_id")
    .selectAll("p")
    .select(["u.display_name", "u.username"])
    .where("p.status", "=", "PUBLISHED")
    .where("u.status", "=", "ACTIVE")
    .where(notBlocked(viewerId, "p.user_id"));
}

function textMatch(q: string): Expression<SqlBool> {
  const ts = prefixTsQuery(q);
  const like = likeContains(q);
  return sql<boolean>`(${ts ? sql`p.search @@ to_tsquery('simple', ${ts})` : sql`false`} OR (u.display_name || ' ' || u.username::text) ILIKE ${like} OR p.location ILIKE ${like})`;
}

function relevance(q: string) {
  const ts = prefixTsQuery(q);
  return sql<number>`(${ts ? sql`ts_rank(p.search, to_tsquery('simple', ${ts}))` : sql`0`} + similarity(u.display_name, ${q}) * 0.5 + p.completeness / 1000.0)::float8`;
}

async function cards(viewer: Actor | null, rows: { id: string; user_id: string; headline: string | null; location: string | null; years_experience: number | null; skill_names: unknown[]; rating_avg: unknown; rating_count: number; open_to_work: string; section_visibility: unknown }[], wanted: string[], recruiter: boolean): Promise<TalentCard[]> {
  if (!rows.length) return [];
  const [users, badges, states, saved] = await Promise.all([
    loadSummaries(rows.map((r) => r.user_id)),
    db
      .selectFrom("profile_badges")
      .select(["profile_id", "slug", "label", "kind"])
      .where(
        "profile_id",
        "in",
        rows.map((r) => r.id),
      )
      .where("is_visible", "=", true)
      .orderBy("created_at")
      .execute(),
    viewer ? connectionRepo.states(viewer.id, rows.map((r) => r.user_id)) : Promise.resolve(new Map()),
    // `saved` only ever comes from the viewer's own ACTIVE recruiter record, one query per page.
    viewer && recruiter
      ? db
          .selectFrom("saved_candidates as s")
          .innerJoin("recruiters as r", "r.id", "s.recruiter_id")
          .select("s.profile_id")
          .where("r.user_id", "=", viewer.id)
          .where("r.status", "=", "ACTIVE")
          .where(
            "s.profile_id",
            "in",
            rows.map((r) => r.id),
          )
          .execute()
      : Promise.resolve([]),
  ]);
  const savedIds = new Set(saved.map((s) => s.profile_id));
  const want = new Set(wanted.map((w) => w.toLowerCase()));
  return rows
    .filter((r) => users.has(r.user_id))
    .map((r) => {
      // The card follows the skills section's audience, like the profile page does.
      const rel = { isSelf: viewer?.id === r.user_id, isStaff: isStaff(viewer), connected: states.get(r.user_id)?.state === "CONNECTED", isRecruiter: recruiter };
      const skills = canSeeSection(readAudience(r.section_visibility, "skills"), rel) ? r.skill_names.map(String) : [];
      const otw = r.open_to_work === "PUBLIC" || (r.open_to_work === "RECRUITERS" && recruiter);
      return {
        user: { ...users.get(r.user_id)!, openToWork: otw },
        headline: r.headline,
        location: r.location,
        yearsExperience: r.years_experience,
        topSkills: skills.slice(0, 6),
        badges: badges.filter((b) => b.profile_id === r.id).slice(0, 3).map((b) => ({ slug: b.slug, label: b.label, kind: b.kind })),
        rating: { average: displayRating(r.rating_avg === null ? null : Number(r.rating_avg), r.rating_count), count: r.rating_count },
        openToWork: otw,
        saved: savedIds.has(r.id),
        connection: states.get(r.user_id)?.state ?? "NONE",
        matchedSkills: skills.filter((s) => want.has(s.toLowerCase())),
      };
    });
}

export async function search(viewer: Actor | null, f: DirectoryQuery): Promise<Page<TalentCard>> {
  const recruiter = viewer ? await isActiveRecruiter(viewer.id) : false;
  const skills = uniqueSkills(f.skills ?? [], 10);
  let q = base(viewer?.id ?? null);
  if (f.q?.trim()) q = q.where(textMatch(f.q.trim()));
  if (skills.length) {
    // Filtering by skill would reveal a hidden skills section, so only profiles whose skills
    // the viewer may see can match (CONNECTIONS-only skills are not searchable).
    const audiences = recruiter ? ["PUBLIC", "RECRUITERS"] : ["PUBLIC"];
    q = q.where(sql<boolean>`p.skill_names @> ${skills}::citext[]`).where(sql<boolean>`coalesce(p.section_visibility->>'skills', 'PUBLIC') = ANY(${audiences}::text[])`);
  }
  if (f.location?.trim()) q = q.where(sql<boolean>`p.location ILIKE ${likeContains(f.location.trim())}`);
  if (f.openToWork) q = q.where("p.open_to_work", "in", recruiter ? ["PUBLIC", "RECRUITERS"] : ["PUBLIC"]);
  if (f.employment?.length) q = q.where(sql<boolean>`p.employment_types && ${f.employment}::employment_type[]`);
  if (f.workplace?.length) q = q.where(sql<boolean>`p.workplace_types && ${f.workplace}::workplace_type[]`);
  if (f.minYears !== undefined) q = q.where("p.years_experience", ">=", f.minYears);
  if (f.maxYears !== undefined) q = q.where("p.years_experience", "<=", f.maxYears);

  const sort = f.sort ?? (f.q?.trim() ? "relevance" : "recent");
  if (sort === "recent") {
    const rows = await q.select(atKey("p.published_at")).where(olderThan("p.published_at", "p.id", decodeTime(f.cursor))).orderBy("p.published_at", "desc").orderBy("p.id", "desc").limit(f.limit + 1).execute();
    const page = pageBy(rows, f.limit, (r) => encodeTime(r._at, r.id));
    return { items: await cards(viewer, page.items, skills, recruiter), nextCursor: page.nextCursor };
  }
  const score = sort === "experience" ? sql<number>`coalesce(p.years_experience, -1)::float8` : relevance(f.q?.trim() ?? "");
  const rows = await q.select(score.as("_score")).where(belowScore(score, "p.id", decodeScore(f.cursor))).orderBy(score, "desc").orderBy("p.id", "desc").limit(f.limit + 1).execute();
  const page = pageBy(rows, f.limit, (r) => encodeScore(Number(r._score), r.id));
  return { items: await cards(viewer, page.items, skills, recruiter), nextCursor: page.nextCursor };
}

/** The most common skills and locations among published profiles (the filter chips). */
export async function facets(): Promise<{ skills: { name: string; count: number }[]; locations: { name: string; count: number }[] }> {
  const [skills, locations] = await Promise.all([
    sql<{ name: string; n: number }>`
      SELECT s.name::text AS name, count(*)::int AS n FROM talent_profiles p, unnest(p.skill_names) AS s(name)
       WHERE p.status = 'PUBLISHED' AND coalesce(p.section_visibility->>'skills', 'PUBLIC') = 'PUBLIC'
       GROUP BY lower(s.name::text), s.name ORDER BY n DESC, name LIMIT 24`.execute(db),
    sql<{ name: string; n: number }>`
      SELECT location AS name, count(*)::int AS n FROM talent_profiles
       WHERE status = 'PUBLISHED' AND location IS NOT NULL AND location <> '' GROUP BY location ORDER BY n DESC, location LIMIT 16`.execute(db),
  ]);
  return { skills: skills.rows.map((r) => ({ name: r.name, count: Number(r.n) })), locations: locations.rows.map((r) => ({ name: r.name, count: Number(r.n) })) };
}

/** The header typeahead and the search page's "All" tab. */
export async function everything(viewer: Actor | null, q: string, limit = 5): Promise<SearchResults> {
  const term = q.trim();
  if (!term) return { people: [], jobs: [], companies: [] };
  const [people, jobPage, companies] = await Promise.all([
    search(viewer, { q: term, sort: "relevance", limit }),
    jobs.search(viewer, { q: term, sort: "relevance", limit }),
    db
      .selectFrom("companies as c")
      .selectAll("c")
      .where("c.status", "<>", "SUSPENDED")
      .where((eb) => eb.or([sql<boolean>`c.name ILIKE ${likeContains(term)}`, prefixTsQuery(term) ? sql<boolean>`c.search @@ to_tsquery('simple', ${prefixTsQuery(term)})` : sql<boolean>`false`]))
      .orderBy("c.follower_count", "desc")
      .limit(limit)
      .execute(),
  ]);
  return { people: people.items, jobs: jobPage.items, companies: await presentCompanySummaries(companies, viewer) };
}

// ─── Recruiter workspace ────────────────────────────────────────────────────

export async function saveCandidate(actor: Actor, username: string, note: string | null, on: boolean): Promise<void> {
  const r = await requireRecruiter(actor);
  const profile = await db
    .selectFrom("talent_profiles as p")
    .innerJoin("users as u", "u.id", "p.user_id")
    .select(["p.id", "p.status", "u.id as user_id"])
    .where("u.username", "=", username)
    .executeTakeFirst();
  if (!profile || (profile.status !== "PUBLISHED" && profile.status !== "UNLISTED")) throw notFound("Profile not found", "PROFILE_NOT_FOUND");
  if (on) {
    await db
      .insertInto("saved_candidates")
      .values({ recruiter_id: r.id, profile_id: profile.id, note })
      .onConflict((oc) => oc.columns(["recruiter_id", "profile_id"]).doUpdateSet({ note }))
      .execute();
  } else await db.deleteFrom("saved_candidates").where("recruiter_id", "=", r.id).where("profile_id", "=", profile.id).execute();
}

/** Saved candidates whose profiles are still published (or unlisted): a suspended or unpublished profile drops out. */
export async function savedCandidates(actor: Actor, q: { cursor?: string; limit: number }): Promise<Page<TalentCard & { note: string | null; savedAt: string }>> {
  const r = await requireRecruiter(actor);
  const rows = await db
    .selectFrom("saved_candidates as s")
    .innerJoin("talent_profiles as p", "p.id", "s.profile_id")
    .innerJoin("users as u", "u.id", "p.user_id")
    .selectAll("p")
    .select(["s.note", atKey("s.created_at", "_sat")])
    .where("s.recruiter_id", "=", r.id)
    .where("p.status", "in", ["PUBLISHED", "UNLISTED"])
    .where("u.status", "=", "ACTIVE")
    .where(notBlocked(actor.id, "p.user_id"))
    .where(olderThan("s.created_at", "s.profile_id", decodeTime(q.cursor)))
    .orderBy("s.created_at", "desc")
    .orderBy("s.profile_id", "desc")
    .limit(q.limit + 1)
    .execute();
  const page = pageBy(rows, q.limit, (x) => encodeTime(x._sat, x.id));
  const list = await cards(actor, page.items, [], true);
  const byUser = new Map(page.items.map((x) => [x.user_id, x]));
  return { items: list.map((c) => ({ ...c, note: byUser.get(c.user.id)?.note ?? null, savedAt: byUser.get(c.user.id)?._sat ?? "" })), nextCursor: page.nextCursor };
}

export async function savedSearches(actor: Actor) {
  const r = await requireRecruiter(actor);
  const rows = await db.selectFrom("saved_searches").selectAll().where("recruiter_id", "=", r.id).orderBy("created_at", "desc").limit(50).execute();
  return rows.map((s) => ({ id: s.id, name: s.name, query: s.query as Partial<DirectoryQuery>, createdAt: s.created_at.toISOString() }));
}

export async function saveSearch(actor: Actor, name: string, query: Partial<DirectoryQuery>) {
  const r = await requireRecruiter(actor);
  requireActive(actor);
  const count = await db.selectFrom("saved_searches").select((eb) => eb.fn.countAll<number>().as("n")).where("recruiter_id", "=", r.id).executeTakeFirstOrThrow();
  if (Number(count.n) >= 50) throw badRequest("You can keep at most 50 saved searches", "TOO_MANY_SEARCHES");
  const { cursor: _c, limit: _l, ...rest } = query;
  const row = await db.insertInto("saved_searches").values({ id: newId(), recruiter_id: r.id, name, query: JSON.stringify(rest) }).returningAll().executeTakeFirstOrThrow();
  return { id: row.id, name: row.name, query: rest, createdAt: row.created_at.toISOString() };
}

export async function deleteSearch(actor: Actor, id: string): Promise<void> {
  const r = await requireRecruiter(actor);
  await db.deleteFrom("saved_searches").where("id", "=", id).where("recruiter_id", "=", r.id).execute();
}
