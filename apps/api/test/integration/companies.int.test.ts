/** /api/companies: company pages, editing by page admins, the team, follows, people, jobs and posts. */
import { describe, expect, test } from "vitest";
import type { Company, CompanySummary, Job, TeamMember } from "@open-talent/types";
import { db } from "../../src/db/kysely";
import { anon, as, createUser, type TestUser } from "./harness";
import { allPages, approach, makeCompanyRecruiter, makeJob, makeProfile, notificationsOf, operator, teammate, uniq, verifyCompany } from "./talent-fixtures";

const page = async (viewer: TestUser | null, slug: string) => (await as(viewer).get(`/api/companies/${slug}`).expect(200)).body as Company;
const team = async (viewer: TestUser | null, slug: string) => (await as(viewer).get(`/api/companies/${slug}/team`).expect(200)).body as TeamMember[];
const companyRow = (id: string) => db.selectFrom("companies").selectAll().where("id", "=", id).executeTakeFirstOrThrow();

describe("reading company pages", () => {
  test("get by slug; management fields only for page admins and staff", async () => {
    const owner = await makeCompanyRecruiter();
    const anonView = await page(null, owner.company.slug);
    expect(anonView).toMatchObject({ id: owner.company.id, slug: owner.company.slug, name: owner.company.name, status: "UNVERIFIED", memberCount: 1, viewer: { following: false, role: null, canManage: false } });
    expect(anonView.manage).toBeUndefined();
    expect(JSON.stringify(anonView)).not.toContain('"domains"');
    const own = await page(owner, owner.company.slug);
    expect(own.viewer).toEqual({ following: false, role: "OWNER", canManage: true });
    expect(own.manage).toEqual({ domains: [owner.company.domain], autoApproveDomain: false });
    for (const role of ["MODERATOR", "RECRUITER_OPS", "ADMIN"] as const) expect((await page(await operator(role), owner.company.slug)).manage, role).toBeDefined();
  });

  test("bad and unknown slugs are 404 COMPANY_NOT_FOUND", async () => {
    for (const slug of ["UPPER_case!", "a", uniq("missing")]) {
      expect((await anon().get(`/api/companies/${encodeURIComponent(slug)}`).expect(404)).body.code, slug).toBe("COMPANY_NOT_FOUND");
    }
  });

  test("list: text search, industry filter, most followed first, suspended companies gone", async () => {
    const word = uniq("Nimbus");
    const a = await makeCompanyRecruiter({ companyName: `${word} Analytics` });
    const b = await makeCompanyRecruiter({ companyName: `${word} Robotics` });
    await as(b).patch(`/api/companies/${b.company.slug}`).send({ industry: `Robotics ${word}` }).expect(200);
    await as(await createUser()).put(`/api/companies/${b.company.slug}/follow`).expect(200);
    const found = (await anon().get("/api/companies").query({ q: word }).expect(200)).body.items as CompanySummary[];
    expect(found.map((c) => c.id)).toEqual([b.company.id, a.company.id]);
    const byIndustry = (await anon().get("/api/companies").query({ industry: `Robotics ${word}` }).expect(200)).body.items as CompanySummary[];
    expect(byIndustry.map((c) => c.id)).toEqual([b.company.id]);
    const all = await allPages<CompanySummary>(async (cursor) => (await anon().get("/api/companies").query({ q: word, limit: 1, ...(cursor ? { cursor } : {}) }).expect(200)).body);
    expect(all.map((c) => c.id)).toEqual([b.company.id, a.company.id]);
    await as(await operator("ADMIN")).patch(`/api/admin/companies/${a.company.id}`).send({ status: "SUSPENDED", reason: "Fake listings" }).expect(200);
    expect(((await anon().get("/api/companies").query({ q: word }).expect(200)).body.items as CompanySummary[]).map((c) => c.id)).toEqual([b.company.id]);
    // LIKE wildcards are literal.
    expect((await anon().get("/api/companies").query({ q: "%", industry: `Robotics ${word}` }).expect(200)).body.items).toEqual([]);
  });

  test("a suspended company is a 404 to outsiders, visible to its team and to staff; its jobs close", async () => {
    const owner = await makeCompanyRecruiter();
    const job = await makeJob(owner);
    await as(await operator("ADMIN")).patch(`/api/admin/companies/${owner.company.id}`).send({ status: "SUSPENDED", reason: "Scam reports" }).expect(200);
    await anon().get(`/api/companies/${owner.company.slug}`).expect(404);
    await as(await createUser()).get(`/api/companies/${owner.company.slug}`).expect(404);
    await anon().get(`/api/companies/${owner.company.slug}/jobs`).expect(404);
    await anon().get(`/api/companies/${owner.company.slug}/people`).expect(404);
    expect((await page(owner, owner.company.slug)).status).toBe("SUSPENDED");
    for (const role of ["MODERATOR", "RECRUITER_OPS", "ADMIN"] as const) await as(await operator(role)).get(`/api/companies/${owner.company.slug}`).expect(200);
    expect((await db.selectFrom("jobs").select("status").where("id", "=", job.id).executeTakeFirstOrThrow()).status).toBe("CLOSED");
    // A suspended company's team can no longer recruit.
    expect((await as(owner).patch(`/api/companies/${owner.company.slug}`).send({ tagline: "Still here" }).expect(403)).body.code).toBe("RECRUITER_REQUIRED");
  });
});

describe("editing", () => {
  test("page admins edit; URLs are checked; the body is strict", async () => {
    const owner = await makeCompanyRecruiter();
    const res = (await as(owner).patch(`/api/companies/${owner.company.slug}`).send({ tagline: "Small tools, well made", about: "We build developer tools.", website: "fictional-tools.example.com", sizeBand: "11-50", foundedYear: 2019 }).expect(200)).body as Company;
    expect(res).toMatchObject({ tagline: "Small tools, well made", website: "https://fictional-tools.example.com/", sizeBand: "11-50", foundedYear: 2019 });
    expect((await as(owner).patch(`/api/companies/${owner.company.slug}`).send({ website: "javascript:alert(1)" }).expect(400)).body.code).toBe("URL_INVALID");
    await as(owner).patch(`/api/companies/${owner.company.slug}`).send({ status: "VERIFIED" }).expect(400);
    await as(owner).patch(`/api/companies/${owner.company.slug}`).send({ slug: "new-slug" }).expect(400);
    await as(owner).patch(`/api/companies/${owner.company.slug}`).send({ foundedYear: 1500 }).expect(400);
    await as(owner).patch(`/api/companies/${owner.company.slug}`).send({ name: "x" }).expect(400);
  });

  test("only page admins of this company may edit", async () => {
    const owner = await makeCompanyRecruiter();
    const mate = await teammate(owner);
    expect(mate.account.role).toBe("RECRUITER");
    expect((await as(mate).patch(`/api/companies/${owner.company.slug}`).send({ tagline: "Hijack" }).expect(403)).body.code).toBe("NOT_COMPANY_ADMIN");
    const otherOwner = await makeCompanyRecruiter();
    expect((await as(otherOwner).patch(`/api/companies/${owner.company.slug}`).send({ tagline: "Hijack" }).expect(403)).body.code).toBe("NOT_COMPANY_ADMIN");
    expect((await as(await createUser()).patch(`/api/companies/${owner.company.slug}`).send({ tagline: "Hijack" }).expect(403)).body.code).toBe("RECRUITER_REQUIRED");
    await anon().patch(`/api/companies/${owner.company.slug}`).send({ tagline: "Hijack" }).expect(401);
    // Promoted to ADMIN, the teammate may edit.
    await as(owner).patch(`/api/companies/team/${mate.recruiterId}`).send({ role: "ADMIN" }).expect(200);
    await as(mate).patch(`/api/companies/${owner.company.slug}`).send({ tagline: "Now allowed" }).expect(200);
    expect((await page(null, owner.company.slug)).tagline).toBe("Now allowed");
  });

  test("changing the domains of a VERIFIED company sends it back to UNVERIFIED; same domains do not", async () => {
    const owner = await makeCompanyRecruiter();
    await verifyCompany(owner.company.id);
    const same = (await as(owner).patch(`/api/companies/${owner.company.slug}`).send({ domains: [`jobs.${owner.company.domain}`] }).expect(200)).body as Company;
    expect(same.status).toBe("VERIFIED");
    expect(same.manage?.domains).toEqual([owner.company.domain]);
    const changed = (await as(owner).patch(`/api/companies/${owner.company.slug}`).send({ domains: [owner.company.domain, "second-site.example.com", "not a domain"] }).expect(200)).body as Company;
    expect(changed.status).toBe("UNVERIFIED");
    expect(changed.manage?.domains).toEqual([owner.company.domain, "example.com"]);
    const row = await companyRow(owner.company.id);
    expect(row.verified_at).toBeNull();
    expect(row.verified_by).toBeNull();
  });
});

describe("the team", () => {
  test("pending members are listed for page admins and staff only", async () => {
    const owner = await makeCompanyRecruiter();
    const mate = await teammate(owner);
    const pending = await makeCompanyRecruiter({ companySlug: owner.company.slug, domain: owner.company.domain, stopAt: "EMAIL_PENDING" });
    const publicTeam = await team(null, owner.company.slug);
    expect(publicTeam.map((m) => m.recruiterId).sort()).toEqual([owner.recruiterId, mate.recruiterId].sort());
    expect(publicTeam.every((m) => m.status === "ACTIVE")).toBe(true);
    expect((await team(mate, owner.company.slug)).map((m) => m.recruiterId)).not.toContain(pending.recruiterId);
    const adminView = await team(owner, owner.company.slug);
    expect(adminView.find((m) => m.recruiterId === pending.recruiterId)).toMatchObject({ status: "EMAIL_PENDING", role: "RECRUITER" });
    expect((await team(await operator("RECRUITER_OPS"), owner.company.slug)).map((m) => m.recruiterId)).toContain(pending.recruiterId);
    expect(adminView.find((m) => m.recruiterId === owner.recruiterId)).toMatchObject({ role: "OWNER", title: "Talent Partner", user: { id: owner.id } });
    // Team payloads carry no work emails.
    expect(JSON.stringify(adminView)).not.toContain(`@${owner.company.domain}`);
  });

  test("roles: owners manage admins and owners; admins only recruiters; the last owner stays", async () => {
    const owner = await makeCompanyRecruiter();
    const [a, b] = [await teammate(owner), await teammate(owner)];
    expect((await as(a).patch(`/api/companies/team/${b.recruiterId}`).send({ role: "ADMIN" }).expect(403)).body.code).toBe("NOT_COMPANY_ADMIN");
    await as(owner).patch(`/api/companies/team/${a.recruiterId}`).send({ role: "ADMIN" }).expect(200);
    expect((await as(a).patch(`/api/companies/team/${b.recruiterId}`).send({ role: "OWNER" }).expect(403)).body.code).toBe("OWNER_ONLY");
    expect((await as(a).patch(`/api/companies/team/${owner.recruiterId}`).send({ role: "RECRUITER" }).expect(403)).body.code).toBe("OWNER_ONLY");
    expect((await as(owner).patch(`/api/companies/team/${owner.recruiterId}`).send({ role: "ADMIN" }).expect(409)).body.code).toBe("LAST_OWNER");
    await as(owner).patch(`/api/companies/team/${b.recruiterId}`).send({ role: "OWNER" }).expect(200);
    const after = (await as(owner).patch(`/api/companies/team/${owner.recruiterId}`).send({ role: "ADMIN" }).expect(200)).body as TeamMember[];
    expect(after.find((m) => m.recruiterId === owner.recruiterId)?.role).toBe("ADMIN");
    expect(after.find((m) => m.recruiterId === b.recruiterId)?.role).toBe("OWNER");
    // Another company's teammate is not found.
    const stranger = await makeCompanyRecruiter();
    await as(b).patch(`/api/companies/team/${stranger.recruiterId}`).send({ role: "RECRUITER" }).expect(404);
    await as(b).patch(`/api/companies/team/${a.recruiterId}`).send({ role: "SUPERUSER" }).expect(400);
  });

  test("removing a teammate withdraws their pending approaches and takes away access", async () => {
    const owner = await makeCompanyRecruiter();
    const mate = await teammate(owner);
    const candidate = await makeProfile();
    const a = await approach(mate, candidate);
    const job = await makeJob(mate);
    expect((await as(owner).delete(`/api/companies/team/${owner.recruiterId}`).expect(400)).body.code).toBe("SELF_ACTION");
    expect((await as(mate).delete(`/api/companies/team/${owner.recruiterId}`).expect(403)).body.code).toBe("NOT_COMPANY_ADMIN");
    await as(owner).delete(`/api/companies/team/${mate.recruiterId}`).expect(204);
    expect((await db.selectFrom("approaches").select("status").where("id", "=", a.id).executeTakeFirstOrThrow()).status).toBe("WITHDRAWN");
    expect((await db.selectFrom("jobs").select("posted_by").where("id", "=", job.id).executeTakeFirstOrThrow()).posted_by).toBe(owner.recruiterId);
    expect((await as(mate).get("/api/approaches/sent").expect(403)).body.code).toBe("RECRUITER_REQUIRED");
    expect((await team(null, owner.company.slug)).map((m) => m.recruiterId)).toEqual([owner.recruiterId]);
    expect((await page(null, owner.company.slug)).memberCount).toBe(1);
    const other = await makeCompanyRecruiter();
    await as(owner).delete(`/api/companies/team/${other.recruiterId}`).expect(404);
  });
});

describe("follows, people, jobs and posts", () => {
  test("follow and unfollow are idempotent, counted, and tell the owners", async () => {
    const owner = await makeCompanyRecruiter();
    const fan = await createUser();
    expect((await as(fan).put(`/api/companies/${owner.company.slug}/follow`).expect(200)).body).toMatchObject({ followerCount: 1, viewer: { following: true } });
    expect((await as(fan).put(`/api/companies/${owner.company.slug}/follow`).expect(200)).body.followerCount).toBe(1);
    expect((await notificationsOf(owner.id)).filter((n) => n.type === "COMPANY_FOLLOW")).toHaveLength(1);
    expect((await as(fan).delete(`/api/companies/${owner.company.slug}/follow`).expect(200)).body).toMatchObject({ followerCount: 0, viewer: { following: false } });
    expect((await as(fan).delete(`/api/companies/${owner.company.slug}/follow`).expect(200)).body.followerCount).toBe(0);
    await anon().put(`/api/companies/${owner.company.slug}/follow`).expect(401);
    expect((await as(await createUser({ status: "SUSPENDED" })).put(`/api/companies/${owner.company.slug}/follow`).expect(403)).body.code).toBe("ACCOUNT_RESTRICTED");
  });

  test("summaries carry viewerFollowing for the viewer: list, search, landing; false signed out", async () => {
    const word = uniq("Beacon");
    const followed = await makeCompanyRecruiter({ companyName: `${word} Labs` });
    const other = await makeCompanyRecruiter({ companyName: `${word} Forge` });
    const fan = await createUser();
    await as(fan).put(`/api/companies/${followed.company.slug}/follow`).expect(200);
    const flags = (items: CompanySummary[]) => Object.fromEntries(items.map((c) => [c.slug, c.viewerFollowing]));
    const list = async (viewer: TestUser | null) => (await as(viewer).get("/api/companies").query({ q: word }).expect(200)).body.items as CompanySummary[];
    expect(flags(await list(fan))).toEqual({ [followed.company.slug]: true, [other.company.slug]: false });
    // Signed out, and someone who follows nothing, never see it set.
    expect(flags(await list(null))).toEqual({ [followed.company.slug]: false, [other.company.slug]: false });
    expect(flags(await list(await createUser()))).toEqual({ [followed.company.slug]: false, [other.company.slug]: false });
    // The landing strip is the same list without a query.
    const landing = await allPages<CompanySummary>(async (cursor) => (await as(fan).get("/api/companies").query({ limit: 50, ...(cursor ? { cursor } : {}) }).expect(200)).body);
    expect(landing.find((c) => c.slug === followed.company.slug)?.viewerFollowing).toBe(true);
    expect(landing.filter((c) => c.viewerFollowing).map((c) => c.slug)).toEqual([followed.company.slug]);
    // The typeahead's companies.
    const search = async (viewer: TestUser | null) => (await as(viewer).get("/api/search").query({ q: word }).expect(200)).body.companies as CompanySummary[];
    expect(flags(await search(fan))).toEqual({ [followed.company.slug]: true, [other.company.slug]: false });
    expect(flags(await search(null))).toEqual({ [followed.company.slug]: false, [other.company.slug]: false });
    // Agrees with the full page, and follows through an unfollow.
    expect((await page(fan, followed.company.slug)).viewer.following).toBe(true);
    await as(fan).delete(`/api/companies/${followed.company.slug}/follow`).expect(200);
    expect(flags(await list(fan))[followed.company.slug]).toBe(false);
    // A recruiter's own account summary says whether they follow their company page.
    expect(((await as(other).get("/api/recruiter/me").expect(200)).body as { company: CompanySummary }).company.viewerFollowing).toBe(false);
    await as(other).put(`/api/companies/${other.company.slug}/follow`).expect(200);
    expect(((await as(other).get("/api/recruiter/me").expect(200)).body as { company: CompanySummary }).company.viewerFollowing).toBe(true);
  });

  test("people: published profiles whose current role is linked to the company", async () => {
    const owner = await makeCompanyRecruiter();
    const current = await makeProfile();
    await as(current).put("/api/profiles/me/sections/experience").send({ items: [{ title: "Engineer", companyName: owner.company.name, companySlug: owner.company.slug, startMonth: "2022-01" }] }).expect(200);
    const former = await makeProfile();
    await as(former).put("/api/profiles/me/sections/experience").send({ items: [{ title: "Engineer", companyName: owner.company.name, companySlug: owner.company.slug, startMonth: "2018-01", endMonth: "2020-01" }] }).expect(200);
    const draft = await makeProfile({ status: "DRAFT" });
    await as(draft).put("/api/profiles/me/sections/experience").send({ items: [{ title: "Engineer", companyName: owner.company.name, companySlug: owner.company.slug, startMonth: "2022-01" }] }).expect(200);
    const res = (await anon().get(`/api/companies/${owner.company.slug}/people`).expect(200)).body;
    expect(res.items.map((u: { id: string }) => u.id)).toEqual([current.id]);
    expect(JSON.stringify(res)).not.toContain(current.contact.email!);
    // The experience links to the company page.
    const profile = (await anon().get(`/api/profiles/${current.username}`).expect(200)).body;
    expect(profile.experience[0].company).toMatchObject({ slug: owner.company.slug, name: owner.company.name });
  });

  test("jobs: OPEN ones for everyone, every status for the team", async () => {
    const owner = await makeCompanyRecruiter();
    const open = await makeJob(owner);
    const draft = await makeJob(owner, { publish: false });
    const closed = await makeJob(owner);
    await as(owner).post(`/api/jobs/${closed.id}/status`).send({ status: "CLOSED" }).expect(200);
    const outside = (await anon().get(`/api/companies/${owner.company.slug}/jobs`).expect(200)).body.items as Job[];
    expect(outside.map((j) => j.id)).toEqual([open.id]);
    // Outsiders cannot widen the filter.
    expect(((await anon().get(`/api/companies/${owner.company.slug}/jobs`).query({ status: "DRAFT" }).expect(200)).body.items as Job[]).map((j) => j.id)).toEqual([open.id]);
    const inside = (await as(owner).get(`/api/companies/${owner.company.slug}/jobs`).expect(200)).body.items as Job[];
    expect(inside.map((j) => j.id).sort()).toEqual([open.id, draft.id, closed.id].sort());
    expect(((await as(owner).get(`/api/companies/${owner.company.slug}/jobs`).query({ status: "DRAFT" }).expect(200)).body.items as Job[]).map((j) => j.id)).toEqual([draft.id]);
    expect((await page(null, owner.company.slug)).openJobCount).toBe(1);
  });

  test("posts made as the company page, by page admins only", async () => {
    const owner = await makeCompanyRecruiter();
    const mate = await teammate(owner);
    const body = `We are hiring ${uniq("w")}`;
    const post = (await as(owner).post("/api/posts").send({ body, companyId: owner.company.id }).expect(201)).body;
    expect((await as(mate).post("/api/posts").send({ body: "As the page", companyId: owner.company.id }).expect(403)).body.code).toBe("NOT_COMPANY_ADMIN");
    const list = (await anon().get(`/api/companies/${owner.company.slug}/posts`).expect(200)).body.items as { id: string; body: string }[];
    expect(list.map((p) => p.id)).toEqual([post.id]);
    expect(list[0]!.body).toBe(body);
    // A personal post by the owner is not a company post.
    await as(owner).post("/api/posts").send({ body: "Personal note" }).expect(201);
    expect((await anon().get(`/api/companies/${owner.company.slug}/posts`).expect(200)).body.items).toHaveLength(1);
  });
});
