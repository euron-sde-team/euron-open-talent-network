/**
 * /api/search: the talent directory and its filters, facets, and the typeahead across
 * people, jobs and companies. Every test tags its profiles with a unique skill or word,
 * so other files' data in the shared database never leaks into the assertions.
 */
import { describe, expect, test } from "vitest";
import type { SearchResults, TalentCard } from "@open-talent/types";
import { db } from "../../src/db/kysely";
import { anon, as, createUser, type TestUser } from "./harness";
import { allPages, block, makeCompanyRecruiter, makeJob, makeProfile, teammate, uniq } from "./talent-fixtures";

type Query = Record<string, string | number | boolean>;
const people = async (viewer: TestUser | null, query: Query) => (await as(viewer).get("/api/search/people").query(query).expect(200)).body.items as TalentCard[];
const ids = (cards: TalentCard[]) => cards.map((c) => c.user.id);
const sorted = (xs: string[]) => [...xs].sort();

describe("the directory", () => {
  test("skills are all required, matched ignoring case; drafts never listed", async () => {
    const [a, b] = [uniq("Skl"), uniq("Skl")];
    const both = await makeProfile({ skills: [a, b] });
    const one = await makeProfile({ skills: [a] });
    await makeProfile({ skills: [a, b], status: "DRAFT" });
    await makeProfile({ skills: [a, b], status: "UNLISTED" });
    expect(sorted(ids(await people(null, { skills: a })))).toEqual(sorted([both.id, one.id]));
    const all = await people(null, { skills: `${a.toLowerCase()},${b.toUpperCase()}` });
    expect(ids(all)).toEqual([both.id]);
    expect(all[0]!.matchedSkills.sort()).toEqual([a, b].sort());
    // A card carries no private data.
    const json = JSON.stringify(all);
    expect(json).not.toContain(both.contact.email!);
    expect(json).not.toContain(both.contact.phone!);
  });

  test("free text: headline words (prefix), display name and location", async () => {
    const word = uniq("zeph").toLowerCase();
    const byHeadline = await makeProfile({ headline: `Principal ${word}ologist` });
    const byName = await makeProfile({ displayName: `Quinn ${word}` });
    const byPlace = await makeProfile({ location: `${word} Harbour` });
    expect(sorted(ids(await people(null, { q: word })))).toEqual(sorted([byHeadline.id, byName.id, byPlace.id]));
    expect(ids(await people(null, { q: `${word}olog` }))).toEqual([byHeadline.id]);
  });

  test("location filter is a contains match", async () => {
    const town = uniq("Town");
    const here = await makeProfile({ location: `${town}, Atlantis` });
    await makeProfile({ location: "Elsewhere" });
    expect(ids(await people(null, { location: town.slice(1).toLowerCase() }))).toEqual([here.id]);
  });

  test("LIKE wildcards in text are literal: % and _ never match everything", async () => {
    const s = uniq("Wild");
    await makeProfile({ skills: [s] });
    await makeProfile({ skills: [s] });
    for (const q of ["%", "_", "%%", "\\", "%_%"]) {
      expect(await people(null, { skills: s, q }), q).toEqual([]);
      expect(await people(null, { skills: s, location: q }), q).toEqual([]);
    }
  });

  test("years of experience bounds and sort by experience", async () => {
    const s = uniq("Yrs");
    const junior = await makeProfile({ skills: [s] });
    const mid = await makeProfile({ skills: [s] });
    const senior = await makeProfile({ skills: [s] });
    await as(junior).patch("/api/profiles/me").send({ yearsExperience: 1 }).expect(200);
    await as(senior).patch("/api/profiles/me").send({ yearsExperience: 15 }).expect(200);
    expect(sorted(ids(await people(null, { skills: s, minYears: 5 })))).toEqual(sorted([mid.id, senior.id]));
    expect(sorted(ids(await people(null, { skills: s, maxYears: 6 })))).toEqual(sorted([junior.id, mid.id]));
    expect(ids(await people(null, { skills: s, minYears: 2, maxYears: 10 }))).toEqual([mid.id]);
    expect(ids(await people(null, { skills: s, sort: "experience" }))).toEqual([senior.id, mid.id, junior.id]);
    // Recent: newest published first.
    expect(ids(await people(null, { skills: s, sort: "recent" }))).toEqual([senior.id, mid.id, junior.id]);
    await anon().get("/api/search/people").query({ minYears: "lots" }).expect(400);
    await anon().get("/api/search/people").query({ sort: "random" }).expect(400);
  });

  test("open to work: PUBLIC for everyone, RECRUITERS mode only for active recruiters; employment and workplace filters", async () => {
    const s = uniq("Otw");
    const loud = await makeProfile({ skills: [s], openToWork: "PUBLIC" });
    const quiet = await makeProfile({ skills: [s], openToWork: "RECRUITERS" });
    await makeProfile({ skills: [s] });
    await as(loud).put("/api/profiles/me/open-to-work").send({ mode: "PUBLIC", employmentTypes: ["CONTRACT"], workplaceTypes: ["REMOTE"] }).expect(200);
    const recruiter = await makeCompanyRecruiter();
    const member = await createUser();
    expect(ids(await people(null, { skills: s, openToWork: true }))).toEqual([loud.id]);
    expect(ids(await people(member, { skills: s, openToWork: true }))).toEqual([loud.id]);
    expect(sorted(ids(await people(recruiter, { skills: s, openToWork: true })))).toEqual(sorted([loud.id, quiet.id]));
    const anonCards = await people(null, { skills: s });
    expect(anonCards.find((c) => c.user.id === quiet.id)?.openToWork).toBe(false);
    expect((await people(recruiter, { skills: s })).find((c) => c.user.id === quiet.id)?.openToWork).toBe(true);
    expect(ids(await people(null, { skills: s, employment: "CONTRACT,FREELANCE" }))).toEqual([loud.id]);
    expect(ids(await people(null, { skills: s, workplace: "REMOTE" }))).toEqual([loud.id]);
    await anon().get("/api/search/people").query({ employment: "FOREVER" }).expect(400);
  });

  test("blocked people and restricted accounts are not listed", async () => {
    const s = uniq("Blk");
    const visible = await makeProfile({ skills: [s] });
    const blocked = await makeProfile({ skills: [s] });
    const suspended = await makeProfile({ skills: [s] });
    await db.updateTable("users").set({ status: "SUSPENDED" }).where("id", "=", suspended.id).execute();
    const viewer = await createUser();
    await block(blocked, viewer);
    expect(ids(await people(viewer, { skills: s }))).toEqual([visible.id]);
    expect(sorted(ids(await people(null, { skills: s })))).toEqual(sorted([visible.id, blocked.id]));
  });

  test("pagination walks every card once, in both recent and relevance order", async () => {
    const s = uniq("Pg");
    const made: string[] = [];
    for (let i = 0; i < 5; i++) made.push((await makeProfile({ skills: [s], headline: `Engineer ${s}` })).id);
    for (const sort of ["recent", "relevance", "experience"]) {
      const all = await allPages<TalentCard>(async (cursor) => (await anon().get("/api/search/people").query({ skills: s, sort, limit: 2, ...(cursor ? { cursor } : {}) }).expect(200)).body);
      expect(all, sort).toHaveLength(5);
      expect(sorted(ids(all)), sort).toEqual(sorted(made));
    }
    await anon().get("/api/search/people").query({ cursor: "not-a-cursor" }).expect((r) => expect([200, 400]).toContain(r.status));
  });
});

describe("saved on talent cards", () => {
  test("true only for the ACTIVE recruiter who saved the candidate; never for anyone else", async () => {
    const skill = uniq("Svd");
    const word = uniq("Keeper").toLowerCase();
    const [kept, other] = [await makeProfile({ skills: [skill], headline: `${word} specialist` }), await makeProfile({ skills: [skill] })];
    const r = await makeCompanyRecruiter();
    await as(r).put(`/api/recruiter/saved/${kept.username}`).send({ note: "Strong" }).expect(204);
    const savedFlags = async (viewer: TestUser | null) => Object.fromEntries((await people(viewer, { skills: skill })).map((c) => [c.user.id, c.saved]));
    expect(await savedFlags(r)).toEqual({ [kept.id]: true, [other.id]: false });
    // The typeahead's people and the saved list agree.
    const typeahead = (await as(r).get("/api/search").query({ q: word }).expect(200)).body as SearchResults;
    expect(typeahead.people.find((c) => c.user.id === kept.id)?.saved).toBe(true);
    expect(((await as(r).get("/api/recruiter/saved").expect(200)).body.items as TalentCard[]).map((c) => [c.user.id, c.saved])).toEqual([[kept.id, true]]);
    // A teammate, another company's recruiter, a member, the candidate and anonymous viewers all see false.
    const viewers: (TestUser | null)[] = [await teammate(r), await makeCompanyRecruiter(), await createUser(), kept, null];
    for (const v of viewers) expect(Object.values(await savedFlags(v)), v?.username ?? "anonymous").toEqual([false, false]);
    // A recruiter who is no longer ACTIVE keeps the row but no longer sees it on cards.
    await db.updateTable("recruiters").set({ status: "SUSPENDED" }).where("id", "=", r.recruiterId).execute();
    expect(Object.values(await savedFlags(r))).toEqual([false, false]);
    // Unsaving clears it.
    await db.updateTable("recruiters").set({ status: "ACTIVE" }).where("id", "=", r.recruiterId).execute();
    await as(r).delete(`/api/recruiter/saved/${kept.username}`).expect(204);
    expect(await savedFlags(r)).toEqual({ [kept.id]: false, [other.id]: false });
  });
});

describe("facets", () => {
  test("the most common skills and locations among published profiles", async () => {
    await makeProfile();
    const res = await anon().get("/api/search/facets").expect(200);
    expect(res.headers["cache-control"]).toBe("public, max-age=300");
    expect(Array.isArray(res.body.skills)).toBe(true);
    expect(Array.isArray(res.body.locations)).toBe(true);
    for (const f of [...res.body.skills, ...res.body.locations]) {
      expect(typeof f.name).toBe("string");
      expect(f.count).toBeGreaterThan(0);
    }
    // The fixture default skills are the most common ones in this test database.
    expect(res.body.skills.map((s: { name: string }) => s.name.toLowerCase())).toContain("typescript");
  });
});

describe("typeahead", () => {
  test("people, open jobs and companies in one call", async () => {
    const word = uniq("Orbit").toLowerCase();
    const person = await makeProfile({ headline: `${word} specialist` });
    const recruiter = await makeCompanyRecruiter({ companyName: `${word} Works` });
    const job = await makeJob(recruiter, { title: `Senior ${word} Engineer` });
    await makeJob(recruiter, { title: `Draft ${word} role`, publish: false });
    const res = (await anon().get("/api/search").query({ q: word }).expect(200)).body as SearchResults;
    expect(ids(res.people)).toEqual([person.id]);
    expect(res.jobs.map((j) => j.id)).toEqual([job.id]);
    expect(res.companies.map((c) => c.slug)).toEqual([recruiter.company.slug]);
    expect(JSON.stringify(res)).not.toContain(person.contact.email!);
    await anon().get("/api/search").expect(400);
    await anon().get("/api/search").query({ q: "" }).expect(400);
    expect((await anon().get("/api/search").query({ q: "%" }).expect(200)).body.companies.every((c: { name: string }) => c.name.includes("%"))).toBe(true);
  });

  test("a suspended company leaves the typeahead", async () => {
    const word = uniq("Gone").toLowerCase();
    const recruiter = await makeCompanyRecruiter({ companyName: `${word} Holdings` });
    const admin = await createUser({ role: "ADMIN" });
    await as(admin).patch(`/api/admin/companies/${recruiter.company.id}`).send({ status: "SUSPENDED", reason: "Fraud reports" }).expect(200);
    const res = (await anon().get("/api/search").query({ q: word }).expect(200)).body as SearchResults;
    expect(res.companies).toEqual([]);
  });
});
