/**
 * The authorization sweep: one describe per rule that must hold on EVERY route, not just
 * the one a feature test happens to exercise.
 *
 *   1. identity comes from the session, never from the body
 *   2. a block cuts messaging, approaches, contact reveal, feeds and profiles
 *   3. private contact details and hidden sections never reach a public payload
 *   4. suspended recruiters, companies and accounts lose access at once
 *   5. DRAFT, UNLISTED and SUSPENDED profiles stay out of search and saved lists
 *   6. conditional transitions: under concurrency exactly one request wins
 *   7. realtime events reach only the rooms that should hear them
 *   8. RBAC on /admin and the moderation desk
 */
import { afterAll, afterEach, describe, expect, test } from "vitest";
import { db } from "../../src/db/kysely";
import { anon, as, createUser, recordRealtime, type TestUser } from "./harness";
import {
  acceptedApproach,
  apply,
  approach,
  block,
  connect,
  lastCodeFor,
  makeCompanyRecruiter,
  makeJob,
  makeProfile,
  operator,
  resetSettings,
  setSettings,
  teammate,
  uniq,
  uniquePhone,
  type Recruiter,
  type Talent,
} from "./talent-fixtures";

afterAll(async () => {
  await resetSettings();
});

const FAKE_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

async function post(user: TestUser, body = `Shipping notes ${uniq("p")}`, extra: Record<string, unknown> = {}) {
  const res = await as(user).post("/api/posts").send({ body, ...extra });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as { id: string; author: { id: string } };
}

async function dmThread(a: TestUser, b: TestUser): Promise<string> {
  const res = await as(a).post("/api/dms/threads").send({ userId: b.id });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.id as string;
}

/** A hired application, so the hiring team may propose an engagement. */
async function hired(r: Recruiter, cand: TestUser) {
  const job = await makeJob(r);
  const app = await apply(cand, job.id);
  await as(r).post(`/api/applications/${app.id}/move`).send({ to: "HIRED" }).expect(200);
  return { job, app };
}

// ─── 1. Body identity forgery ───────────────────────────────────────────────

describe("identity comes from the session, never the body", () => {
  test("strict bodies reject identity fields on every talent write route", async () => {
    const victim = await makeProfile();
    const cand = await makeProfile();
    const r = await makeCompanyRecruiter();
    const job = await makeJob(r);
    const app = await apply(cand, job.id);
    const { approach: accepted } = await acceptedApproach(["EMAIL"], { recruiter: r });

    const forged: [string, (u: TestUser) => Promise<{ status: number; body: any }>, TestUser][] = [
      ["recruiter register", (u) => as(u).post("/api/recruiter/register").send({ newCompany: { name: "Forged Labs" }, workEmail: `x@${uniq("f")}.test`, userId: victim.id }), await createUser()],
      ["approach send", (u) => as(u).post("/api/approaches").send({ username: victim.username, roleTitle: "Engineer", message: "x".repeat(40), recruiterId: FAKE_ID }), r],
      ["approach send as a company", (u) => as(u).post("/api/approaches").send({ username: victim.username, roleTitle: "Engineer", message: "x".repeat(40), companyId: FAKE_ID }), r],
      ["apply", (u) => as(u).post(`/api/jobs/${job.id}/apply`).send({ candidateId: victim.id }), victim],
      ["pipeline move", (u) => as(u).post(`/api/applications/${app.id}/move`).send({ to: "SCREENING", recruiterId: FAKE_ID }), r],
      ["bulk move", (u) => as(u).post("/api/applications/bulk-move").send({ ids: [app.id], to: "SCREENING", authorId: FAKE_ID }), r],
      ["team note", (u) => as(u).post("/api/recruiter/notes").send({ candidateId: cand.id, body: "Strong", authorId: victim.id }), r],
      ["engagement propose", (u) => as(u).post("/api/trust/engagements").send({ approachId: accepted.id, title: "Contract", candidateId: victim.id }), r],
      ["rating", (u) => as(u).post(`/api/trust/engagements/${FAKE_ID}/rating`).send({ score: 5, raterId: victim.id }), cand],
      ["complaint", (u) => as(u).post("/api/trust/complaints").send({ againstUsername: r.username, category: "SPAM", description: "x".repeat(30), approachId: accepted.id, complainantId: victim.id }), cand],
      ["profile basics", (u) => as(u).patch("/api/profiles/me").send({ headline: "Forged", userId: victim.id }), cand],
      ["profile contact", (u) => as(u).put("/api/profiles/me/contact").send({ email: null, phone: null, whatsapp: null, userId: victim.id }), cand],
      ["profile section", (u) => as(u).put("/api/profiles/me/sections/skills").send({ items: [{ name: "Go" }], profileId: FAKE_ID }), cand],
      ["profile section item", (u) => as(u).put("/api/profiles/me/sections/skills").send({ items: [{ name: "Go", profileId: FAKE_ID }] }), cand],
      ["account", (u) => as(u).patch("/api/users/me").send({ displayName: "Forged", id: victim.id }), cand],
      ["account role", (u) => as(u).patch("/api/users/me").send({ role: "ADMIN" }), cand],
      ["post", (u) => as(u).post("/api/posts").send({ body: "hello", authorId: victim.id }), cand],
      ["comment", (u) => as(u).post(`/api/posts/${FAKE_ID}/comments`).send({ body: "hello", authorId: victim.id }), cand],
      ["connection", (u) => as(u).post("/api/network/connections").send({ userId: victim.id, requesterId: FAKE_ID }), cand],
      ["job create", (u) => as(u).post("/api/jobs").send({ title: "Engineer", description: "x".repeat(40), employmentType: "FULL_TIME", workplaceType: "REMOTE", companyId: FAKE_ID }), r],
      ["job edit", (u) => as(u).patch(`/api/jobs/${job.id}`).send({ companyId: FAKE_ID }), r],
      ["company edit", (u) => as(u).patch(`/api/companies/${r.company.slug}`).send({ status: "VERIFIED" }), r],
    ];
    for (const [name, call, user] of forged) {
      const res = await call(user);
      expect(res.status, `${name}: ${JSON.stringify(res.body)}`).toBe(400);
      expect(res.body.code, name).toBe("VALIDATION_FAILED");
    }
    // Nothing was written in the victim's name.
    expect((await as(victim).get("/api/profiles/me").expect(200)).body.headline).not.toBe("Forged");
    expect(await db.selectFrom("recruiters").select("id").where("user_id", "=", victim.id).executeTakeFirst()).toBeUndefined();
  });

  test("a DM body naming another sender is ignored: the message is the session user's", async () => {
    const [a, b, c] = [await createUser(), await createUser(), await createUser()];
    await connect(a, b);
    const t = await dmThread(a, b);
    const res = await as(a).post(`/api/dms/threads/${t}/messages`).send({ body: "hi", senderId: c.id, userId: c.id }).expect(201);
    expect(res.body.sender.id).toBe(a.id);
    const row = await db.selectFrom("dm_messages").select("sender_id").where("id", "=", res.body.id).executeTakeFirstOrThrow();
    expect(row.sender_id).toBe(a.id);
  });

  test("posting as a company needs page admin rights at that company", async () => {
    const r = await makeCompanyRecruiter();
    const other = await makeCompanyRecruiter();
    const member = await teammate(r);
    expect((await as(other).post("/api/posts").send({ body: "hi", companyId: r.company.id }).expect(403)).body.code).toBe("NOT_COMPANY_ADMIN");
    // A plain RECRUITER on the team is not a page admin either.
    expect((await as(member).post("/api/posts").send({ body: "hi", companyId: r.company.id }).expect(403)).body.code).toBe("NOT_COMPANY_ADMIN");
    const ok = await as(r).post("/api/posts").send({ body: "We are hiring", companyId: r.company.id }).expect(201);
    expect(ok.body.company.id).toBe(r.company.id);
    expect(ok.body.author.id).toBe(r.id);
  });

  test("a recruiter cannot reach another company's jobs, applications, approaches or notes", async () => {
    const mine = await makeCompanyRecruiter();
    const theirs = await makeCompanyRecruiter();
    const cand = await makeProfile();
    const job = await makeJob(theirs, { publish: false });
    const openJob = await makeJob(theirs);
    const app = await apply(cand, openJob.id);
    const a = await approach(theirs, cand);
    await as(theirs).post("/api/recruiter/notes").send({ candidateId: cand.id, body: "Their private note" }).expect(201);

    const c = as(mine);
    expect((await c.get(`/api/jobs/${job.id}`)).status).toBe(404);
    expect((await c.patch(`/api/jobs/${openJob.id}`).send({ title: "Taken over" })).status).toBe(404);
    expect((await c.post(`/api/jobs/${openJob.id}/status`).send({ status: "CLOSED" })).status).toBe(404);
    expect((await c.get(`/api/jobs/${openJob.id}/pipeline`)).status).toBe(404);
    expect((await c.get(`/api/jobs/${openJob.id}/pipeline/APPLIED`)).status).toBe(404);
    expect((await c.get(`/api/applications/${app.id}`)).status).toBe(404);
    expect((await c.post(`/api/applications/${app.id}/move`).send({ to: "SCREENING" })).status).toBe(404);
    expect((await c.post("/api/applications/bulk-move").send({ ids: [app.id], to: "SCREENING" })).status).toBe(404);
    expect((await c.post(`/api/applications/${app.id}/thread`).send({})).status).toBe(404);
    expect((await c.post("/api/recruiter/notes").send({ applicationId: app.id, body: "x" })).status).toBe(404);
    expect((await c.get(`/api/approaches/${a.id}`)).status).toBe(404);
    expect((await c.post(`/api/approaches/${a.id}/withdraw`).send({})).status).toBe(404);
    expect((await c.get(`/api/approaches/${a.id}/contact`)).status).toBe(403);
    expect((await c.post(`/api/jobs/${openJob.id}/invites`).send({ username: cand.username })).status).toBe(404);
    // Notes are per company: theirs are invisible to mine.
    expect((await c.get(`/api/recruiter/notes/${cand.id}`).expect(200)).body).toEqual([]);
    // The card did not move.
    expect((await db.selectFrom("applications").select("stage").where("id", "=", app.id).executeTakeFirstOrThrow()).stage).toBe("APPLIED");
    // A candidate cannot act on approaches addressed to someone else.
    const stranger = await makeProfile();
    expect((await as(stranger).post(`/api/approaches/${a.id}/accept`).send({ channels: ["EMAIL"] })).status).toBe(404);
    expect((await as(stranger).post(`/api/approaches/${a.id}/decline`).send({})).status).toBe(404);
    expect((await as(stranger).post(`/api/applications/${app.id}/withdraw`).send({})).status).toBe(404);
  });

  test("only the hiring team proposes an engagement from a hired application", async () => {
    const r = await makeCompanyRecruiter();
    const cand = await makeProfile();
    const { app } = await hired(r, cand);
    const other = await makeCompanyRecruiter();
    expect((await as(other).post("/api/trust/engagements").send({ applicationId: app.id, title: "Contract" }).expect(403)).body.code).toBe("NOT_HIRING_TEAM");
    expect((await as(cand).post("/api/trust/engagements").send({ applicationId: app.id, title: "Contract" }).expect(403)).body.code).toBe("NOT_HIRING_TEAM");
    const e = (await as(r).post("/api/trust/engagements").send({ applicationId: app.id, title: "Contract" }).expect(201)).body;
    expect(e.recruiter.id).toBe(r.id);
    expect(e.candidate.id).toBe(cand.id);
  });

  test("engagements, ratings and complaints only between the two people who dealt with each other", async () => {
    const { recruiter, candidate, approach: a } = await acceptedApproach();
    const outsider = await makeProfile();
    expect((await as(outsider).post("/api/trust/engagements").send({ approachId: a.id, title: "Contract" })).status).toBe(404);
    const e = (await as(recruiter).post("/api/trust/engagements").send({ approachId: a.id, title: "Contract" }).expect(201)).body;
    for (const step of ["confirm", "cancel", "complete", "dispute"]) expect((await as(outsider).post(`/api/trust/engagements/${e.id}/${step}`).send({})).status, step).toBe(404);
    expect((await as(outsider).post(`/api/trust/engagements/${e.id}/rating`).send({ score: 1 })).status).toBe(404);
    expect((await as(outsider).get("/api/trust/engagements").expect(200)).body).toEqual([]);
    // A complaint must name someone you dealt with, through a dealing between you.
    const res = await as(outsider).post("/api/trust/complaints").send({ againstUsername: recruiter.username, category: "SPAM", description: "They spammed me a great deal.", approachId: a.id }).expect(404);
    expect(res.body.code).toBe("NO_RELATIONSHIP");
    await as(candidate).post("/api/trust/complaints").send({ againstUsername: recruiter.username, category: "SPAM", description: "They spammed me a great deal.", approachId: a.id }).expect(201);
  });
});

// ─── 2. Blocks ──────────────────────────────────────────────────────────────

describe("a block cuts every channel, in both directions", () => {
  test("messaging: neither side can open, send to or keep using a conversation", async () => {
    for (const blockerIsA of [true, false]) {
      const [a, b] = [await createUser({ requestPolicy: "ANYONE" }), await createUser({ requestPolicy: "ANYONE" })];
      await connect(a, b);
      const t = await dmThread(a, b);
      await as(a).post(`/api/dms/threads/${t}/messages`).send({ body: "before" }).expect(201);
      await block(blockerIsA ? a : b, blockerIsA ? b : a);
      for (const [from, to] of [
        [a, b],
        [b, a],
      ] as const) {
        const open = await as(from).post("/api/dms/threads").send({ userId: to.id }).expect(403);
        expect(open.body.code).toBe("DM_NOT_ALLOWED");
        const send = await as(from).post(`/api/dms/threads/${t}/messages`).send({ body: "after" }).expect(403);
        expect(send.body.code).toBe("DM_NOT_ALLOWED");
        expect((await as(from).get(`/api/dms/eligibility/${to.id}`).expect(200)).body).toMatchObject({ canMessage: false, canRequest: false, reason: "BLOCKED" });
      }
    }
  });

  test("approaches: a blocked recruiter reads APPROACH_NOT_PUBLISHED, never BLOCKED, and loses the contact reveal", async () => {
    const { recruiter, candidate, approach: a } = await acceptedApproach(["EMAIL", "PHONE"]);
    await as(recruiter).get(`/api/approaches/${a.id}/contact`).expect(200);
    await block(candidate, recruiter);
    const res = await as(recruiter).post("/api/approaches").send({ username: candidate.username, roleTitle: "Engineer", message: "x".repeat(40) }).expect(409);
    expect(res.body.code).toBe("APPROACH_NOT_PUBLISHED");
    expect(JSON.stringify(res.body)).not.toMatch(/block/i);
    expect((await as(recruiter).get(`/api/approaches/${a.id}/contact`).expect(403)).body.code).toBe("CONTACT_NOT_SHARED");
    // The other direction: a recruiter who blocks a candidate cannot approach them either.
    const r2 = await makeCompanyRecruiter();
    const c2 = await makeProfile();
    await block(r2, c2);
    expect((await as(r2).post("/api/approaches").send({ username: c2.username, roleTitle: "Engineer", message: "x".repeat(40) }).expect(409)).body.code).toBe("APPROACH_NOT_PUBLISHED");
  });

  test("the block from an approach (decline and block) ends the unlock too", async () => {
    const { recruiter, candidate, approach: a } = await acceptedApproach(["EMAIL"]);
    await as(candidate).post(`/api/approaches/${a.id}/block`).send({}).expect(204);
    expect((await as(recruiter).get(`/api/approaches/${a.id}/contact`).expect(403)).body.code).toBe("CONTACT_NOT_SHARED");
    expect((await as(recruiter).get(`/api/profiles/${candidate.username}`)).status).toBe(404);
  });

  test("profiles, posts, feeds, search and job applications disappear across a block", async () => {
    const author = await makeProfile({ headline: `Unique headline ${uniq("h")}` });
    const viewer = await makeProfile();
    await connect(author, viewer);
    const p = await post(author);
    await as(viewer).get(`/api/posts/${p.id}`).expect(200);
    expect((await as(viewer).get("/api/posts/feed").expect(200)).body.items.map((x: { id: string }) => x.id)).toContain(p.id);
    const word = author.profile.headline!.split(" ").pop()!;
    expect((await as(viewer).get(`/api/search/people?q=${word}`).expect(200)).body.items.map((c: { user: { id: string } }) => c.user.id)).toContain(author.id);

    await block(viewer, author);
    for (const [from, to] of [
      [viewer, author],
      [author, viewer],
    ] as const) {
      expect((await as(from).get(`/api/profiles/${to.username}`)).status).toBe(404);
    }
    expect((await as(viewer).get(`/api/posts/${p.id}`)).status).toBe(404);
    const feed = (await as(viewer).get("/api/posts/feed").expect(200)).body;
    expect(feed.items.map((x: { id: string }) => x.id)).not.toContain(p.id);
    const activity = await as(viewer).get(`/api/users/${author.username}/posts`);
    if (activity.status === 200) expect(activity.body.items).toEqual([]);
    else expect(activity.status).toBe(404);
    expect((await as(viewer).get(`/api/search/people?q=${word}`).expect(200)).body.items.map((c: { user: { id: string } }) => c.user.id)).not.toContain(author.id);
    // Signed out, the post and profile are still public.
    await anon().get(`/api/posts/${p.id}`).expect(200);
    await anon().get(`/api/profiles/${author.username}`).expect(200);
    // The connection ended.
    expect(await db.selectFrom("connections").select("id").where("status", "=", "ACCEPTED").where((eb) => eb.or([eb.and([eb("requester_id", "=", author.id), eb("addressee_id", "=", viewer.id)]), eb.and([eb("requester_id", "=", viewer.id), eb("addressee_id", "=", author.id)])])).executeTakeFirst()).toBeUndefined();
  });

  test("a candidate who blocked a recruiter cannot apply to (or see) the jobs that recruiter posted", async () => {
    const r = await makeCompanyRecruiter();
    const job = await makeJob(r);
    const cand = await makeProfile();
    await block(cand, r);
    expect((await as(cand).post(`/api/jobs/${job.id}/apply`).send({})).status).toBe(404);
  });
});

// ─── 3. Private data never leaks ────────────────────────────────────────────

describe("contact details and hidden sections never reach a public payload", () => {
  async function world() {
    const r = await makeCompanyRecruiter();
    const people: Talent[] = [];
    const marker = uniq("leak");
    for (let i = 0; i < 3; i++) {
      const t = await makeProfile({ headline: `Data engineer ${marker}`, contact: { email: `secret.${uniq("m")}@private.example.test`, phone: uniquePhone(), whatsapp: uniquePhone() } });
      // Current role at the recruiter's company, so /companies/:slug/people lists them.
      await as(t).put("/api/profiles/me/sections/experience").send({ items: [{ title: "Data Engineer", companyName: r.company.name, companySlug: r.company.slug, startMonth: "2021-01", endMonth: null }] }).expect(200);
      await post(t, `Thoughts on pipelines ${marker}`);
      people.push(t);
    }
    return { r, people, marker };
  }

  function secretsOf(people: Talent[]): string[] {
    return people.flatMap((p) => [p.contact.email, p.contact.phone, p.contact.whatsapp, p.contact.phone?.replace("+", ""), p.contact.whatsapp?.replace("+", "")]).filter((x): x is string => !!x);
  }

  test("no response anyone else can read contains a contact value", async () => {
    const { r, people, marker } = await world();
    const connection = await makeProfile();
    await connect(people[0]!, connection);
    // An approach the candidate has not accepted yet, and an accepted one with a reveal by ANOTHER recruiter.
    await approach(r, people[1]!);
    await acceptedApproach(["EMAIL", "PHONE", "WHATSAPP"], { candidate: people[2] });

    const viewers: [string, TestUser | null][] = [
      ["anon", null],
      ["connection", connection],
      ["recruiter without an unlock", r],
      ["admin", await operator("ADMIN")],
    ];
    const secrets = secretsOf(people);
    for (const [label, v] of viewers) {
      const c = as(v);
      const urls = [
        ...people.map((p) => `/api/profiles/${p.username}`),
        ...people.map((p) => `/api/network/of/${p.username}`),
        ...people.map((p) => `/api/users/${p.username}/posts`),
        `/api/search/people?q=${marker}`,
        `/api/search?q=${marker}`,
        `/api/companies/${r.company.slug}/people`,
        `/api/companies/${r.company.slug}`,
        "/api/search/facets",
      ];
      if (v) urls.push("/api/posts/feed", "/api/notifications", "/api/approaches/sent", "/api/network/suggestions");
      for (const url of urls) {
        const res = await c.get(url);
        if (res.status >= 400) continue;
        const json = JSON.stringify(res.body);
        for (const s of secrets) expect(json.includes(s), `${label} ${url} leaked ${s}`).toBe(false);
      }
      // Post detail of each author.
      const posts = (await anon().get(`/api/users/${people[0]!.username}/posts`).expect(200)).body.items;
      for (const p of posts) expect(JSON.stringify((await c.get(`/api/posts/${p.id}`).expect(200)).body)).not.toContain(people[0]!.contact.email!);
    }
    // The pending approach, as the recruiter sees it, carries no contact either.
    const sent = (await as(r).get("/api/approaches/sent").expect(200)).body.items;
    expect(JSON.stringify(sent)).not.toContain(people[1]!.contact.email!);
    // And the people list really did include them (the grep looked at real data).
    const listed = (await anon().get(`/api/companies/${r.company.slug}/people`).expect(200)).body.items.map((u: { id: string }) => u.id);
    expect(listed).toEqual(expect.arrayContaining(people.map((p) => p.id)));
    expect((await anon().get(`/api/search/people?q=${marker}`).expect(200)).body.items).toHaveLength(3);
  });

  test("the owner reads their own contact details; nobody else's Profile has a contact field", async () => {
    const t = await makeProfile();
    const mine = (await as(t).get("/api/profiles/me").expect(200)).body;
    expect(mine.contact.email).toBe(t.contact.email);
    for (const v of [null, await createUser(), await makeCompanyRecruiter()]) {
      const body = (await as(v).get(`/api/profiles/${t.username}`).expect(200)).body;
      expect(body).not.toHaveProperty("contact");
      expect(body).not.toHaveProperty("sectionVisibility");
    }
  });

  test("CONNECTIONS and RECRUITERS sections are emptied and listed in hiddenSections for viewers outside the audience", async () => {
    const marker = uniq("secretrole");
    const t = await makeProfile({ skills: [`Skill${marker}`] });
    await as(t).put("/api/profiles/me/sections/experience").send({ items: [{ title: `Title ${marker}`, companyName: `Company ${marker}`, startMonth: "2020-01" }] }).expect(200);
    await as(t).put("/api/profiles/me/visibility").send({ experience: "CONNECTIONS", skills: "RECRUITERS" }).expect(200);
    const friend = await createUser();
    await connect(t, friend);
    const r = await makeCompanyRecruiter();

    const view = async (v: TestUser | null) => (await as(v).get(`/api/profiles/${t.username}`).expect(200)).body;
    const outsider = await view(await createUser());
    const signedOut = await view(null);
    for (const p of [outsider, signedOut]) {
      expect(p.experience).toEqual([]);
      expect(p.skills).toEqual([]);
      expect(p.hiddenSections).toEqual(expect.arrayContaining(["experience", "skills"]));
      expect(JSON.stringify(p)).not.toContain(marker);
    }
    const asRecruiter = await view(r);
    expect(asRecruiter.experience).toEqual([]);
    expect(asRecruiter.skills.map((s: { name: string }) => s.name)).toContain(`Skill${marker}`);
    expect(asRecruiter.hiddenSections).toEqual(["experience"]);
    const asFriend = await view(friend);
    expect(asFriend.hiddenSections).toEqual([]);
    expect(asFriend.experience[0].title).toBe(`Title ${marker}`);

    // Directory cards follow the same audience: a RECRUITERS-only skill list is not on the public card.
    const card = (u: TestUser | null) => as(u).get(`/api/search/people?q=${t.username}`).expect(200);
    for (const v of [null, await createUser()]) expect(JSON.stringify((await card(v)).body), "public card").not.toContain(`Skill${marker}`);
    expect(JSON.stringify((await card(r)).body)).toContain(`Skill${marker}`);
    expect(JSON.stringify((await anon().get(`/api/search?q=${t.username}`).expect(200)).body)).not.toContain(`Skill${marker}`);
    // A CONNECTIONS-only current role does not list them on the company's people page.
    await as(t).put("/api/profiles/me/sections/experience").send({ items: [{ title: "Engineer", companyName: r.company.name, companySlug: r.company.slug, startMonth: "2020-01" }] }).expect(200);
    const people = async () => (await anon().get(`/api/companies/${r.company.slug}/people`).expect(200)).body.items.map((u: { id: string }) => u.id);
    expect(await people()).toEqual([]);
    await as(t).put("/api/profiles/me/visibility").send({ experience: "PUBLIC" }).expect(200);
    expect(await people()).toEqual([t.id]);
  });
});

// ─── 4. Suspensions ─────────────────────────────────────────────────────────

describe("suspended recruiters, companies and accounts lose access at once", () => {
  async function recruiterWorld() {
    const r = await makeCompanyRecruiter();
    const job = await makeJob(r);
    const cand = await makeProfile();
    const app = await apply(cand, job.id);
    const { approach: a } = await acceptedApproach(["EMAIL"], { recruiter: r });
    await as(r).get(`/api/approaches/${a.id}/contact`).expect(200);
    return { r, job, cand, app, a };
  }

  async function expectNoRecruiterAccess(r: Recruiter, w: Awaited<ReturnType<typeof recruiterWorld>>) {
    const c = as(r);
    const checks: [string, () => Promise<{ status: number; body: any }>][] = [
      ["send approach", () => c.post("/api/approaches").send({ username: w.cand.username, roleTitle: "Engineer", message: "x".repeat(40) })],
      ["sent list", () => c.get("/api/approaches/sent")],
      ["reveal", () => c.get(`/api/approaches/${w.a.id}/contact`)],
      ["post job", () => c.post("/api/jobs").send({ title: "Engineer", description: "x".repeat(40), employmentType: "FULL_TIME", workplaceType: "REMOTE" })],
      ["edit job", () => c.patch(`/api/jobs/${w.job.id}`).send({ title: "Changed title" })],
      ["pipeline", () => c.get(`/api/jobs/${w.job.id}/pipeline`)],
      ["move", () => c.post(`/api/applications/${w.app.id}/move`).send({ to: "SCREENING" })],
      ["saved candidates", () => c.get("/api/recruiter/saved")],
      ["notes", () => c.get(`/api/recruiter/notes/${w.cand.id}`)],
    ];
    for (const [name, call] of checks) {
      const res = await call();
      expect(res.status, `${name}: ${JSON.stringify(res.body)}`).toBe(403);
      expect(res.body.code, name).toBe("RECRUITER_REQUIRED");
    }
  }

  test("an admin-suspended recruiter: RECRUITER_REQUIRED everywhere, pending approaches withdrawn, unlocks ended", async () => {
    const w = await recruiterWorld();
    const pending = await approach(w.r, await makeProfile());
    await as(await operator("RECRUITER_OPS")).post(`/api/admin/recruiters/${w.r.recruiterId}/suspend`).send({ reason: "Spam outreach" }).expect(204);
    await expectNoRecruiterAccess(w.r, w);
    expect((await db.selectFrom("approaches").select("status").where("id", "=", pending.id).executeTakeFirstOrThrow()).status).toBe("WITHDRAWN");
    expect((await db.selectFrom("contact_unlocks").select("revoked_at").where("approach_id", "=", w.a.id).executeTakeFirstOrThrow()).revoked_at).not.toBeNull();
    // Reinstating restores access, but the ended unlock stays ended.
    await as(await operator("RECRUITER_OPS")).post(`/api/admin/recruiters/${w.r.recruiterId}/reinstate`).send({}).expect(204);
    await as(w.r).get("/api/approaches/sent").expect(200);
    expect((await as(w.r).get(`/api/approaches/${w.a.id}/contact`).expect(403)).body.code).toBe("CONTACT_NOT_SHARED");
  });

  test("a suspended company: its recruiters lose access and its jobs close", async () => {
    const w = await recruiterWorld();
    await as(await operator("RECRUITER_OPS")).patch(`/api/admin/companies/${w.r.company.id}`).send({ status: "SUSPENDED", reason: "Fake company" }).expect(200);
    await expectNoRecruiterAccess(w.r, w);
    expect((await db.selectFrom("jobs").select("status").where("id", "=", w.job.id).executeTakeFirstOrThrow()).status).toBe("CLOSED");
    expect((await anon().get(`/api/jobs/${w.job.id}`)).status).toBe(404);
    expect((await anon().get(`/api/companies/${w.r.company.slug}`)).status).toBe(404);
  });

  test("a suspended account can read but not write; a banned account's token stops working", async () => {
    const u = await makeProfile();
    const other = await makeProfile();
    await connect(u, other);
    const mod = await operator("MODERATOR");
    await as(mod).post(`/api/admin/users/${u.id}/suspend`).send({ days: 3, reason: "Cooling off" }).expect(200);
    await as(u).get("/api/profiles/me").expect(200);
    const writes: [string, () => Promise<{ status: number; body: any }>][] = [
      ["profile", () => as(u).patch("/api/profiles/me").send({ headline: "Back" })],
      ["post", () => as(u).post("/api/posts").send({ body: "hello" })],
      ["dm", () => as(u).post("/api/dms/threads").send({ userId: other.id })],
      ["connect", async () => as(u).post("/api/network/connections").send({ userId: (await createUser()).id })],
      ["account", () => as(u).patch("/api/users/me").send({ displayName: "Renamed" })],
      ["register recruiter", () => as(u).post("/api/recruiter/register").send({ newCompany: { name: "Nope Labs" }, workEmail: `x@${uniq("s")}.test` })],
    ];
    for (const [name, call] of writes) {
      const res = await call();
      expect(res.status, `${name}: ${JSON.stringify(res.body)}`).toBe(403);
      expect(res.body.code, name).toBe("ACCOUNT_RESTRICTED");
    }

    const banned = await createUser();
    await as(await operator("ADMIN")).post(`/api/admin/users/${banned.id}/ban`).send({ reason: "Fraud" }).expect(200);
    const res = await as(banned).get("/api/users/me");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("TOKEN_INVALID");
  });

  test("a suspended profile disappears from everyone but its owner and staff", async () => {
    const t = await makeProfile();
    const r = await makeCompanyRecruiter();
    await as(r).put(`/api/recruiter/saved/${t.username}`).send({ note: "Strong" }).expect(204);
    await as(await operator("MODERATOR")).post(`/api/admin/users/${t.id}/profile/suspend`).send({ reason: "Impersonation" }).expect(200);
    expect((await anon().get(`/api/profiles/${t.username}`)).status).toBe(404);
    expect((await as(r).get(`/api/profiles/${t.username}`)).status).toBe(404);
    await as(t).get(`/api/profiles/${t.username}`).expect(200);
    await as(await operator("MODERATOR")).get(`/api/profiles/${t.username}`).expect(200);
    expect((await as(r).get("/api/recruiter/saved").expect(200)).body.items.map((c: { user: { id: string } }) => c.user.id)).not.toContain(t.id);
    expect((await as(r).post("/api/approaches").send({ username: t.username, roleTitle: "Engineer", message: "x".repeat(40) }).expect(409)).body.code).toBe("APPROACH_NOT_PUBLISHED");
    expect((await as(t).post("/api/profiles/me/status").send({ status: "PUBLISHED" }).expect(403)).body.code).toBe("PROFILE_SUSPENDED");
  });
});

// ─── 5. Directory listing rules ─────────────────────────────────────────────

describe("only PUBLISHED profiles of active accounts are listed", () => {
  test("DRAFT, UNLISTED and SUSPENDED profiles stay out of search; UNLISTED opens by link", async () => {
    const marker = uniq("dir");
    const headline = `Platform engineer ${marker}`;
    const published = await makeProfile({ headline });
    const unlisted = await makeProfile({ headline, status: "UNLISTED" });
    const draft = await makeProfile({ headline, status: "DRAFT" });
    const suspended = await makeProfile({ headline });
    await as(await operator("MODERATOR")).post(`/api/admin/users/${suspended.id}/profile/suspend`).send({ reason: "Spam" }).expect(200);
    const suspendedAccount = await makeProfile({ headline });
    await as(await operator("MODERATOR")).post(`/api/admin/users/${suspendedAccount.id}/suspend`).send({ days: 2, reason: "Spam" }).expect(200);

    const r = await makeCompanyRecruiter();
    for (const v of [null, await createUser(), r]) {
      const ids = (await as(v).get(`/api/search/people?q=${marker}`).expect(200)).body.items.map((c: { user: { id: string } }) => c.user.id);
      expect(ids).toEqual([published.id]);
      const all = (await as(v).get(`/api/search?q=${marker}`).expect(200)).body.people.map((c: { user: { id: string } }) => c.user.id);
      expect(all).toEqual([published.id]);
    }
    await anon().get(`/api/profiles/${unlisted.username}`).expect(200);
    expect((await anon().get(`/api/profiles/${draft.username}`)).status).toBe(404);
  });

  test("saved candidates drop out when a profile goes back to DRAFT, and come back when republished", async () => {
    const r = await makeCompanyRecruiter();
    const t = await makeProfile();
    const u = await makeProfile({ status: "UNLISTED" });
    await as(r).put(`/api/recruiter/saved/${t.username}`).send({ note: "Call next week" }).expect(204);
    await as(r).put(`/api/recruiter/saved/${u.username}`).send({}).expect(204);
    const saved = async () => (await as(r).get("/api/recruiter/saved").expect(200)).body.items.map((c: { user: { id: string } }) => c.user.id);
    expect(await saved()).toEqual(expect.arrayContaining([t.id, u.id]));
    await as(t).post("/api/profiles/me/status").send({ status: "DRAFT" }).expect(200);
    expect(await saved()).toEqual([u.id]);
    // A draft cannot be saved in the first place.
    expect((await as(r).put(`/api/recruiter/saved/${t.username}`).send({})).status).toBe(404);
    await as(t).post("/api/profiles/me/status").send({ status: "PUBLISHED" }).expect(200);
    expect(await saved()).toEqual(expect.arrayContaining([t.id, u.id]));
  });
});

// ─── 6. Concurrency ─────────────────────────────────────────────────────────

describe("conditional transitions: exactly one concurrent request wins", () => {
  const statuses = (rs: { status: number }[]) => rs.map((r) => r.status).sort();

  afterEach(async () => {
    await resetSettings();
  });

  test("double accept of one approach", async () => {
    const r = await makeCompanyRecruiter();
    const cand = await makeProfile();
    const a = await approach(r, cand);
    const res = await Promise.all([as(cand).post(`/api/approaches/${a.id}/accept`).send({ channels: ["EMAIL"] }), as(cand).post(`/api/approaches/${a.id}/accept`).send({ channels: ["PHONE"] })]);
    expect(statuses(res)).toEqual([200, 409]);
    expect(await db.selectFrom("contact_unlocks").select("id").where("approach_id", "=", a.id).execute()).toHaveLength(1);
  });

  test("accept against withdraw", async () => {
    const r = await makeCompanyRecruiter();
    const cand = await makeProfile();
    const a = await approach(r, cand);
    const [acc, wd] = await Promise.all([as(cand).post(`/api/approaches/${a.id}/accept`).send({ channels: ["EMAIL"] }), as(r).post(`/api/approaches/${a.id}/withdraw`).send({})]);
    expect(statuses([acc, wd])).toEqual([200, 409]);
    const row = await db.selectFrom("approaches").select("status").where("id", "=", a.id).executeTakeFirstOrThrow();
    expect(row.status).toBe(acc.status === 200 ? "ACCEPTED" : "WITHDRAWN");
    const unlocks = await db.selectFrom("contact_unlocks").select("id").where("approach_id", "=", a.id).execute();
    expect(unlocks).toHaveLength(acc.status === 200 ? 1 : 0);
  });

  test("two teammates move the same card at once", async () => {
    const r = await makeCompanyRecruiter();
    const mate = await teammate(r);
    const job = await makeJob(r);
    const app = await apply(await makeProfile(), job.id);
    const res = await Promise.all([as(r).post(`/api/applications/${app.id}/move`).send({ to: "SCREENING" }), as(mate).post(`/api/applications/${app.id}/move`).send({ to: "SCREENING" })]);
    expect(statuses(res)).toEqual([200, 409]);
    const events = await db.selectFrom("application_events").select("to_stage").where("application_id", "=", app.id).execute();
    expect(events.map((e) => e.to_stage).sort()).toEqual(["APPLIED", "SCREENING"]);
  });

  test("double accept of one connection invitation", async () => {
    const [a, b] = [await createUser(), await createUser()];
    const { connectionId } = (await as(a).post("/api/network/connections").send({ userId: b.id }).expect(200)).body;
    const res = await Promise.all([as(b).post(`/api/network/invitations/${connectionId}/accept`).send({}), as(b).post(`/api/network/invitations/${connectionId}/accept`).send({})]);
    expect(statuses(res)).toEqual([204, 404]);
    const counts = await db.selectFrom("users").select("connection_count").where("id", "in", [a.id, b.id]).execute();
    expect(counts.map((c) => c.connection_count)).toEqual([1, 1]);
  });

  test("double apply", async () => {
    const r = await makeCompanyRecruiter();
    const job = await makeJob(r);
    const cand = await makeProfile();
    const res = await Promise.all([as(cand).post(`/api/jobs/${job.id}/apply`).send({}), as(cand).post(`/api/jobs/${job.id}/apply`).send({})]);
    expect(statuses(res)).toEqual([201, 409]);
    expect((await db.selectFrom("jobs").select("application_count").where("id", "=", job.id).executeTakeFirstOrThrow()).application_count).toBe(1);
  });

  test("two publishes at an open-job cap of one", async () => {
    await setSettings({ recruiter: { maxOpenJobsPerCompany: 1 } });
    const r = await makeCompanyRecruiter();
    const mate = await teammate(r);
    const body = { title: "Platform Engineer", description: "x".repeat(40), employmentType: "FULL_TIME", workplaceType: "REMOTE", publish: true };
    const res = await Promise.all([as(r).post("/api/jobs").send(body), as(mate).post("/api/jobs").send(body)]);
    expect(statuses(res)).toEqual([201, 409]);
    expect(res.find((x) => x.status === 409)!.body.code).toBe("JOB_CAP_REACHED");
    const open = await db.selectFrom("jobs").select("id").where("company_id", "=", r.company.id).where("status", "=", "OPEN").execute();
    expect(open).toHaveLength(1);
  });

  test("double verification of one work-email code", async () => {
    const r = await makeCompanyRecruiter({ stopAt: "EMAIL_PENDING" });
    const code = lastCodeFor(r.workEmail);
    const res = await Promise.all([as(r).post("/api/recruiter/me/verify").send({ code }), as(r).post("/api/recruiter/me/verify").send({ code })]);
    expect(statuses(res)).toEqual([200, 400]);
    expect(res.find((x) => x.status === 400)!.body.code).toBe("NOT_EMAIL_PENDING");
  });
});

// ─── 7. Realtime rooms ──────────────────────────────────────────────────────

describe("realtime events reach only the right rooms", () => {
  const user = (id: string) => `user:${id}`;

  test("approach:new goes to the candidate only; approach:updated to the two parties only", async () => {
    const r = await makeCompanyRecruiter();
    const cand = await makeProfile();
    const rec = recordRealtime();
    const a = await approach(r, cand);
    const created = rec.emits.filter((e) => e.event === "approach:new");
    expect(created).toHaveLength(1);
    expect(created[0]!.rooms).toEqual([user(cand.id)]);
    expect(JSON.stringify(created[0]!.payload)).not.toContain(cand.contact.email!);
    rec.clear();
    await as(cand).post(`/api/approaches/${a.id}/accept`).send({ channels: ["EMAIL", "PHONE"] }).expect(200);
    const updated = rec.emits.filter((e) => e.event === "approach:updated");
    expect(updated.length).toBeGreaterThan(0);
    for (const e of updated) expect(e.rooms.sort()).toEqual([user(cand.id), user(r.id)].sort());
    // Nothing in any emit carries the contact details: they are only behind the logged reveal.
    for (const e of rec.emits) expect(JSON.stringify(e.payload)).not.toContain(cand.contact.email!);
  });

  test("application:stage goes to the candidate only; pipeline:card only to the job room", async () => {
    const r = await makeCompanyRecruiter();
    const job = await makeJob(r);
    const cand = await makeProfile();
    const rec = recordRealtime();
    const app = await apply(cand, job.id);
    await as(r).post(`/api/applications/${app.id}/move`).send({ to: "INTERVIEW", note: "Team only note" }).expect(200);
    const stage = rec.emits.filter((e) => e.event === "application:stage");
    expect(stage).toHaveLength(1);
    expect(stage[0]!.rooms).toEqual([user(cand.id)]);
    expect(JSON.stringify(stage[0]!.payload)).not.toContain("Team only note");
    const cards = rec.emits.filter((e) => e.event === "pipeline:card");
    expect(cards.length).toBe(2);
    for (const e of cards) expect(e.rooms).toEqual([`job:${job.id}`]);
    // Nothing about the application reached the recruiter's or anybody else's user room as a stage event.
    expect(rec.to(user(r.id), "application:stage")).toEqual([]);
  });

  test("dm events reach the participants only", async () => {
    const [a, b, outsider] = [await createUser(), await createUser(), await createUser()];
    await connect(a, b);
    const t = await dmThread(a, b);
    const rec = recordRealtime();
    await as(a).post(`/api/dms/threads/${t}/messages`).send({ body: "only for b" }).expect(201);
    const msgs = rec.emits.filter((e) => e.event.startsWith("dm:"));
    expect(msgs.length).toBeGreaterThan(0);
    for (const e of msgs) for (const room of e.rooms) expect([user(a.id), user(b.id), `thread:${t}`]).toContain(room);
    expect(rec.emits.filter((e) => e.rooms.includes(user(outsider.id)))).toEqual([]);
    expect(rec.to(user(b.id), "dm:message")).toHaveLength(1);
  });
});

// ─── 8. RBAC ────────────────────────────────────────────────────────────────

describe("RBAC: /admin areas and the moderation desk", () => {
  const adminRoutes = (id: string): [string, string, Record<string, unknown>?][] => [
    ["get", "/api/admin/settings"],
    ["patch", "/api/admin/settings", { networkName: "Taken Over" }],
    ["get", "/api/admin/stats"],
    ["get", "/api/admin/stats.csv"],
    ["get", "/api/admin/users"],
    ["patch", `/api/admin/users/${id}`, { role: "ADMIN" }],
    ["post", `/api/admin/users/${id}/warn`, { reason: "x" }],
    ["post", `/api/admin/users/${id}/suspend`, { days: 1, reason: "x" }],
    ["post", `/api/admin/users/${id}/unsuspend`, {}],
    ["post", `/api/admin/users/${id}/ban`, { reason: "x" }],
    ["post", `/api/admin/users/${id}/unban`, {}],
    ["post", `/api/admin/users/${id}/profile/suspend`, { reason: "x" }],
    ["post", `/api/admin/users/${id}/profile/restore`, {}],
    ["post", `/api/admin/users/${id}/badges`, { label: "Verified" }],
    ["delete", `/api/admin/badges/${id}`],
    ["post", `/api/admin/users/${id}/erase`, { reason: "x" }],
    ["get", "/api/admin/recruiters"],
    ["post", `/api/admin/recruiters/${id}/review`, { decision: "APPROVE" }],
    ["post", `/api/admin/recruiters/${id}/suspend`, { reason: "x" }],
    ["post", `/api/admin/recruiters/${id}/reinstate`, {}],
    ["put", `/api/admin/recruiters/${id}/quota`, { quota: 5 }],
    ["get", "/api/admin/companies"],
    ["patch", `/api/admin/companies/${id}`, { status: "VERIFIED" }],
    ["get", "/api/admin/jobs"],
    ["post", `/api/admin/jobs/${id}/close`, { reason: "x" }],
    ["get", "/api/admin/complaints"],
    ["post", `/api/admin/complaints/${id}/resolve`, { status: "DISMISSED", note: "x" }],
    ["post", `/api/admin/ratings/${id}/hide`, { reason: "x" }],
    ["get", "/api/admin/audit"],
  ];

  function call(u: TestUser | null, [method, url, body]: [string, string, Record<string, unknown>?]) {
    const c = as(u) as unknown as Record<string, (url: string) => { send: (b: unknown) => Promise<{ status: number; body: any }> }>;
    return c[method]!(url).send(body ?? {});
  }

  test("a USER is refused every admin route (and sees no areas on /admin/me); signed out is 401", async () => {
    const u = await createUser();
    const me = (await as(u).get("/api/admin/me").expect(200)).body;
    expect(me.role).toBe("USER");
    expect(Object.values(me.areas).every((v) => v === false)).toBe(true);
    for (const route of adminRoutes(u.id)) {
      const res = await call(u, route);
      expect(res.status, `${route[0]} ${route[1]}`).toBe(403);
      expect((await call(null, route)).status, `anon ${route[1]}`).toBe(401);
    }
    for (const url of ["/api/moderation/cases", "/api/moderation/appeals", "/api/moderation/stats", `/api/moderation/history?targetType=POST&targetId=${FAKE_ID}`]) {
      expect((await as(u).get(url)).status, url).toBe(403);
    }
  });

  test("each staff role opens exactly its areas", async () => {
    const target = await createUser();
    const expectations: Record<"MODERATOR" | "RECRUITER_OPS", { allowed: string[]; denied: string[] }> = {
      MODERATOR: { allowed: ["/api/admin/users", "/api/admin/jobs", "/api/admin/complaints", "/api/admin/stats", "/api/moderation/cases"], denied: ["/api/admin/recruiters", "/api/admin/companies", "/api/admin/settings", "/api/admin/audit"] },
      RECRUITER_OPS: { allowed: ["/api/admin/recruiters", "/api/admin/companies", "/api/admin/jobs", "/api/admin/stats"], denied: ["/api/admin/users", "/api/admin/complaints", "/api/admin/settings", "/api/admin/audit", "/api/moderation/cases", "/api/moderation/appeals"] },
    };
    for (const role of ["MODERATOR", "RECRUITER_OPS"] as const) {
      const op = await operator(role);
      for (const url of expectations[role].allowed) expect((await as(op).get(url)).status, `${role} ${url}`).toBe(200);
      for (const url of expectations[role].denied) expect((await as(op).get(url)).status, `${role} ${url}`).toBe(403);
    }
    const admin = await operator("ADMIN");
    for (const [, url] of adminRoutes(target.id).filter(([m]) => m === "get")) expect((await as(admin).get(url)).status, url).toBe(200);
  });

  test("a MODERATOR cannot approve recruiters; RECRUITER_OPS can", async () => {
    const pending = await makeCompanyRecruiter({ stopAt: "PENDING_REVIEW" });
    const res = await as(await operator("MODERATOR")).post(`/api/admin/recruiters/${pending.recruiterId}/review`).send({ decision: "APPROVE" }).expect(403);
    expect(res.body.code).toBe("FORBIDDEN_AREA");
    expect((await db.selectFrom("recruiters").select("status").where("id", "=", pending.recruiterId).executeTakeFirstOrThrow()).status).toBe("PENDING_REVIEW");
    await as(await operator("RECRUITER_OPS")).post(`/api/admin/recruiters/${pending.recruiterId}/review`).send({ decision: "APPROVE" }).expect(204);
  });

  test("RECRUITER_OPS cannot change roles, settings or erase accounts", async () => {
    const ops = await operator("RECRUITER_OPS");
    const target = await createUser();
    expect((await as(ops).patch(`/api/admin/users/${target.id}`).send({ role: "ADMIN" }).expect(403)).body.code).toBe("FORBIDDEN_AREA");
    expect((await as(ops).patch(`/api/admin/users/${ops.id}`).send({ role: "ADMIN" }).expect(403)).body.code).toBe("FORBIDDEN_AREA");
    expect((await as(ops).patch("/api/admin/settings").send({ networkName: "Ops Network" }).expect(403)).body.code).toBe("FORBIDDEN_AREA");
    expect((await as(ops).post(`/api/admin/users/${target.id}/erase`).send({ reason: "x" }).expect(403)).body.code).toBe("FORBIDDEN_AREA");
    expect((await db.selectFrom("users").select("role").where("id", "=", target.id).executeTakeFirstOrThrow()).role).toBe("USER");
  });

  test("a MODERATOR cannot ban, change roles or touch settings; only an ADMIN can", async () => {
    const mod = await operator("MODERATOR");
    const target = await createUser();
    expect((await as(mod).post(`/api/admin/users/${target.id}/ban`).send({ reason: "x" })).status).toBe(403);
    expect((await as(mod).patch(`/api/admin/users/${target.id}`).send({ role: "MODERATOR" }).expect(403)).body.code).toBe("FORBIDDEN_AREA");
    expect((await as(mod).get("/api/admin/settings").expect(403)).body.code).toBe("FORBIDDEN_AREA");
    await as(await operator("ADMIN")).patch(`/api/admin/users/${target.id}`).send({ role: "MODERATOR" }).expect(200);
  });
});
