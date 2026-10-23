import { describe, expect, test } from "vitest";
import { db } from "../../src/db/kysely";
import { anon, as, createUser, PASSWORD, type TestUser } from "./harness";
import { acceptedApproach, allPages, apply, block, connect, follow, makeCompanyRecruiter, makeJob, makeProfile, notificationsOf, teammate } from "./talent-fixtures";

const counts = async (id: string) => db.selectFrom("users").select(["follower_count", "following_count", "connection_count"]).where("id", "=", id).executeTakeFirstOrThrow();

async function post(user: TestUser, body: string, visibility: "PUBLIC" | "CONNECTIONS" = "PUBLIC") {
  const res = await as(user).post("/api/posts").send({ body, visibility });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as { id: string };
}

/** The export endpoint streams JSON; supertest buffers it as text for attachment responses. */
async function exportOf(user: TestUser): Promise<Record<string, any>> {
  const res = await as(user).get("/api/users/me/export").buffer(true).parse((r, cb) => {
    let data = "";
    r.setEncoding("utf8");
    r.on("data", (c: string) => (data += c));
    r.on("end", () => cb(null, data));
  });
  expect(res.status).toBe(200);
  expect(res.headers["content-type"]).toMatch(/application\/json/);
  expect(res.headers["cache-control"]).toBe("no-store");
  return JSON.parse(res.body as string);
}

describe("your account", () => {
  test("GET /me returns the account with profile status, completeness and no recruiter record", async () => {
    const u = await createUser({ displayName: "Morgan Example" });
    const me = await as(u).get("/api/users/me").expect(200);
    expect(me.body).toMatchObject({ id: u.id, username: u.username, email: u.email, displayName: "Morgan Example", status: "ACTIVE", emailVerified: true, totpEnabled: false, messageRequestPolicy: "RECRUITERS", emailDigest: true, profileStatus: "DRAFT", profileCompleteness: 0, recruiter: null, connectionCount: 0 });
    await anon().get("/api/users/me").expect(401);
  });

  test("a published profile and a recruiter record show up on /me", async () => {
    const t = await makeProfile();
    const me = (await as(t).get("/api/users/me").expect(200)).body;
    expect(me.profileStatus).toBe("PUBLISHED");
    expect(me.profileCompleteness).toBeGreaterThanOrEqual(55);
    const r = await makeCompanyRecruiter();
    const rm = (await as(r).get("/api/users/me").expect(200)).body;
    expect(rm.recruiter).toMatchObject({ id: r.recruiterId, status: "ACTIVE", role: "OWNER", company: { slug: r.company.slug } });
  });

  test("display names are cleaned of emails, phone numbers and links; nothing name-like is a 400", async () => {
    const u = await createUser();
    const res = await as(u).patch("/api/users/me").send({ displayName: "Jordan Sample jordan@example.com +1 (555) 010-2233 https://example.com/me" }).expect(200);
    expect(res.body.displayName).toBe("Jordan Sample");
    const bad = await as(u).patch("/api/users/me").send({ displayName: "+1 555 010 2233" }).expect(400);
    expect(bad.body.code).toBe("DISPLAY_NAME_INVALID");
    expect((await as(u).get("/api/users/me").expect(200)).body.displayName).toBe("Jordan Sample");
  });

  test("message request policy and digest preference persist; omitted fields stay", async () => {
    const u = await createUser();
    const a = await as(u).patch("/api/users/me").send({ messageRequestPolicy: "NOBODY", emailDigest: false }).expect(200);
    expect(a.body).toMatchObject({ messageRequestPolicy: "NOBODY", emailDigest: false });
    const b = await as(u).patch("/api/users/me").send({ messageRequestPolicy: "ANYONE" }).expect(200);
    expect(b.body).toMatchObject({ messageRequestPolicy: "ANYONE", emailDigest: false });
    const row = await db.selectFrom("users").select(["message_request_policy", "email_digest"]).where("id", "=", u.id).executeTakeFirstOrThrow();
    expect(row).toEqual({ message_request_policy: "ANYONE", email_digest: false });
  });

  test("the patch is strict: unknown keys, identity fields and bad enums are rejected", async () => {
    const u = await createUser();
    for (const body of [{ role: "ADMIN" }, { email: "other@example.test" }, { id: "01ARZ3NDEKTSV4RRFFQ69G5FAV" }, { messageRequestPolicy: "COMMUNITIES" }, { dmPrivacy: "NOBODY" }]) {
      const res = await as(u).patch("/api/users/me").send(body).expect(400);
      expect(res.body.code).toBe("VALIDATION_FAILED");
    }
    const row = await db.selectFrom("users").select(["role", "email"]).where("id", "=", u.id).executeTakeFirstOrThrow();
    expect(row).toEqual({ role: "USER", email: u.email });
  });

  test("an upload id that is not yours (or does not exist) cannot become your avatar", async () => {
    const u = await createUser();
    await as(u).patch("/api/users/me").send({ avatarUploadId: "01ARZ3NDEKTSV4RRFFQ69G5FAV" }).expect(400);
  });

  test("suspended accounts can read but not edit", async () => {
    const u = await createUser({ status: "SUSPENDED" });
    await as(u).get("/api/users/me").expect(200);
    const res = await as(u).patch("/api/users/me").send({ displayName: "Changed Name" }).expect(403);
    expect(res.body.code).toBe("ACCOUNT_RESTRICTED");
  });
});

describe("follows", () => {
  test("follow, notify once, counters, lists with viewerFollows, unfollow", async () => {
    const [a, b, c] = [await createUser(), await createUser(), await createUser()];
    await follow(a, b);
    await follow(a, b); // idempotent
    expect((await notificationsOf(b.id)).filter((n) => n.type === "FOLLOW")).toHaveLength(1);
    expect((await counts(a.id)).following_count).toBe(1);
    expect((await counts(b.id)).follower_count).toBe(1);

    await follow(c, a);
    const followers = (await as(c).get(`/api/users/${b.username}/followers`).expect(200)).body;
    expect(followers.items).toEqual([expect.objectContaining({ id: a.id, viewerFollows: true })]);
    const following = (await anon().get(`/api/users/${a.username}/following`).expect(200)).body;
    expect(following.items.map((x: { id: string }) => x.id)).toEqual([b.id]);
    expect(following.items[0].viewerFollows).toBe(false);

    await as(a).delete(`/api/users/${b.id}/follow`).expect(204);
    expect((await counts(b.id)).follower_count).toBe(0);
    expect((await anon().get(`/api/users/${b.username}/followers`).expect(200)).body.items).toEqual([]);
  });

  test("you cannot follow yourself, an unknown account, or across a block", async () => {
    const [a, b] = [await createUser(), await createUser()];
    expect((await as(a).post(`/api/users/${a.id}/follow`).expect(400)).body.code).toBe("SELF_ACTION");
    await as(a).post("/api/users/01ARZ3NDEKTSV4RRFFQ69G5FAV/follow").expect(404);
    await block(b, a);
    await as(a).post(`/api/users/${b.id}/follow`).expect(404);
    await as(a).get(`/api/users/${b.username}/followers`).expect(404);
  });

  test("follower lists page through every entry", async () => {
    const target = await createUser();
    const fans: TestUser[] = [];
    for (let i = 0; i < 5; i++) {
      const f = await createUser();
      await follow(f, target);
      fans.push(f);
    }
    const all = await allPages((cursor) => anon().get(`/api/users/${target.username}/followers?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`).then((r) => r.body));
    expect(all.map((x) => x.id).sort()).toEqual(fans.map((f) => f.id).sort());
  });
});

describe("blocks", () => {
  test("blocking ends follows and the connection, lists the person, and unblocking does not restore them", async () => {
    const [a, b] = [await createUser(), await createUser()];
    await connect(a, b);
    await follow(a, b);
    await follow(b, a);
    await block(a, b);
    expect(await counts(a.id)).toEqual({ follower_count: 0, following_count: 0, connection_count: 0 });
    expect((await counts(b.id)).connection_count).toBe(0);
    const list = (await as(a).get("/api/users/me/blocks").expect(200)).body;
    expect(list.map((u: { id: string }) => u.id)).toEqual([b.id]);
    // The blocked side does not see the list entry.
    expect((await as(b).get("/api/users/me/blocks").expect(200)).body).toEqual([]);
    await as(a).delete(`/api/users/${b.id}/block`).expect(204);
    expect((await as(a).get("/api/users/me/blocks").expect(200)).body).toEqual([]);
    expect((await counts(a.id)).following_count).toBe(0);
    expect((await as(a).post(`/api/users/${a.id}/block`).expect(400)).body.code).toBe("SELF_ACTION");
  });

  test("a block makes the person's activity a 404 in both directions", async () => {
    const [a, b] = [await createUser(), await createUser()];
    await post(a, "A public update about distributed tracing.");
    await block(b, a);
    await as(a).get(`/api/users/${b.username}/posts`).expect(404);
    await as(b).get(`/api/users/${a.username}/posts`).expect(404);
    expect((await anon().get(`/api/users/${a.username}/posts`).expect(200)).body.items).toHaveLength(1);
  });

  test("blocking audits the action with the actor", async () => {
    const [a, b] = [await createUser(), await createUser()];
    await block(a, b);
    const row = await db.selectFrom("audit_log").select(["actor_id", "entity_id"]).where("action", "=", "user.block").where("actor_id", "=", a.id).executeTakeFirstOrThrow();
    expect(row).toEqual({ actor_id: a.id, entity_id: b.id });
  });
});

describe("sessions", () => {
  test("sessions are listed and revocable, only by their owner", async () => {
    const u = await createUser();
    await anon().post("/api/auth/login").set("User-Agent", "TestAgent/1").send({ login: u.email, password: PASSWORD }).expect(200);
    const list = await as(u).get("/api/users/me/sessions").set("User-Agent", "TestAgent/1").expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ userAgent: "TestAgent/1", current: true });
    expect(JSON.stringify(list.body)).not.toMatch(/token/i);
    const other = await createUser();
    await as(other).delete(`/api/users/me/sessions/${list.body[0].id}`).expect(404);
    await as(u).delete(`/api/users/me/sessions/${list.body[0].id}`).expect(204);
    expect((await as(u).get("/api/users/me/sessions").expect(200)).body).toHaveLength(0);
    await as(u).delete(`/api/users/me/sessions/${list.body[0].id}`).expect(404);
  });
});

describe("a person's activity", () => {
  test("CONNECTIONS-only posts need a connection; banned and unknown users are 404", async () => {
    const [author, friend, stranger] = [await createUser(), await createUser(), await createUser()];
    const pub = await post(author, "Shipped the new pipeline board today.");
    const priv = await post(author, "Only my network should read this note.", "CONNECTIONS");
    await connect(author, friend);
    const ids = async (viewer: TestUser | null) => ((await as(viewer).get(`/api/users/${author.username}/posts`).expect(200)).body.items as { id: string }[]).map((p) => p.id);
    expect(await ids(null)).toEqual([pub.id]);
    expect(await ids(stranger)).toEqual([pub.id]);
    expect((await ids(friend)).sort()).toEqual([pub.id, priv.id].sort());
    expect((await ids(author)).sort()).toEqual([pub.id, priv.id].sort());
    await anon().get("/api/users/nobody-here-at-all/posts").expect(404);
    await anon().get("/api/users/not_a_valid_handle/posts").expect(404);
    const banned = await createUser({ status: "BANNED" });
    await anon().get(`/api/users/${banned.username}/posts`).expect(404);
  });
});

describe("export", () => {
  test("downloads your own data and nobody else's, and audits it", async () => {
    const { recruiter, candidate } = await acceptedApproach(["EMAIL"]);
    const job = await makeJob(recruiter);
    await apply(candidate, job.id, { coverNote: "I would love to help." });
    await post(candidate, "An update for the export.");
    await as(recruiter).get(`/api/approaches/${(await db.selectFrom("approaches").select("id").where("candidate_id", "=", candidate.id).executeTakeFirstOrThrow()).id}/contact`).expect(200);
    const other = await makeProfile();
    await connect(candidate, other);

    const data = await exportOf(candidate);
    expect(data.account).toMatchObject({ id: candidate.id, email: candidate.email });
    expect(data.profile).toMatchObject({ user_id: candidate.id, contact_email: candidate.contact.email, status: "PUBLISHED" });
    expect(data.profile).not.toHaveProperty("search");
    expect(data.profile).not.toHaveProperty("search_text");
    expect(data.recruiter).toBeNull();
    for (const key of ["experience", "education", "projects", "skills", "links", "posts", "connections", "approachesReceived", "applications", "contactAccessLog", "notifications"]) expect(data[key], key).toEqual(expect.any(Array));
    expect(data.skills.map((s: { name: string }) => s.name)).toEqual(expect.arrayContaining(["TypeScript"]));
    expect(data.approachesReceived).toHaveLength(1);
    expect(data.applications).toEqual([expect.objectContaining({ job_id: job.id, cover_note: "I would love to help." })]);
    expect(data.contactAccessLog).toEqual([expect.objectContaining({ channel: "EMAIL" })]);
    expect(data.connections).toEqual([expect.objectContaining({ username: other.username, status: "ACCEPTED" })]);
    const text = JSON.stringify(data);
    expect(text).not.toContain(other.contact.email!);
    expect(text).not.toMatch(/password_hash|totp_secret/);

    const rdata = await exportOf(recruiter);
    expect(rdata.recruiter).toMatchObject({ id: recruiter.recruiterId, work_email: recruiter.workEmail });
    expect(rdata.approachesSent).toHaveLength(1);
    expect(rdata.profile.contact_email).not.toBe(candidate.contact.email);

    const audit = await db.selectFrom("audit_log").select("actor_id").where("action", "=", "user.export").where("entity_id", "=", candidate.id).execute();
    expect(audit).toEqual([{ actor_id: candidate.id }]);
    await anon().get("/api/users/me/export").expect(401);
  });
});

describe("account deletion", () => {
  test("needs the right password", async () => {
    const u = await createUser();
    await as(u).delete("/api/users/me").send({ password: "not-the-password" }).expect(400);
    await as(u).delete("/api/users/me").send({}).expect(400);
    await as(u).get("/api/users/me").expect(200);
  });

  test("anonymises the account, wipes the profile and contact details, and ends consent", async () => {
    const { recruiter, candidate, approach } = await acceptedApproach(["EMAIL", "PHONE"]);
    const job = await makeJob(recruiter);
    const app = await apply(candidate, job.id);
    const friend = await makeProfile();
    await connect(candidate, friend);
    await follow(friend, candidate);

    await as(candidate).delete("/api/users/me").send({ password: PASSWORD }).expect(204);

    const u = await db.selectFrom("users").selectAll().where("id", "=", candidate.id).executeTakeFirstOrThrow();
    expect(u).toMatchObject({ status: "DEACTIVATED", display_name: "Deleted user", avatar_upload_id: null, totp_enabled: false, email_digest: false });
    expect(String(u.email)).toMatch(/^deleted\+.*@invalid\.example$/);
    expect(String(u.username)).toMatch(/^deleted-/);
    const p = await db.selectFrom("talent_profiles").selectAll().where("user_id", "=", candidate.id).executeTakeFirstOrThrow();
    expect(p).toMatchObject({ status: "DRAFT", headline: null, about: null, contact_email: null, contact_phone: null, whatsapp_phone: null, completeness: 0, published_at: null });
    expect(await db.selectFrom("profile_skills").select("id").where("profile_id", "=", p.id).execute()).toEqual([]);
    expect(await db.selectFrom("profile_experiences").select("id").where("profile_id", "=", p.id).execute()).toEqual([]);
    const unlock = await db.selectFrom("contact_unlocks").select(["revoked_at"]).where("approach_id", "=", approach.id).executeTakeFirstOrThrow();
    expect(unlock.revoked_at).not.toBeNull();
    expect((await db.selectFrom("applications").select("stage").where("id", "=", app.id).executeTakeFirstOrThrow()).stage).toBe("WITHDRAWN");
    expect(await db.selectFrom("connections").select("id").where((eb) => eb.or([eb("requester_id", "=", candidate.id), eb("addressee_id", "=", candidate.id)])).execute()).toEqual([]);
    expect(await counts(friend.id)).toMatchObject({ connection_count: 0, following_count: 0 });

    // The old token stops working, the old handle and the reveal are gone.
    await as(candidate).get("/api/users/me").expect(401);
    await anon().post("/api/auth/login").send({ login: candidate.email, password: PASSWORD }).expect(401);
    await anon().get(`/api/profiles/${candidate.username}`).expect(404);
    expect((await as(recruiter).get(`/api/approaches/${approach.id}/contact`).expect(403)).body.code).toBe("CONTACT_NOT_SHARED");
    const audit = await db.selectFrom("audit_log").select("actor_id").where("action", "=", "user.deleted").where("entity_id", "=", candidate.id).execute();
    expect(audit).toEqual([{ actor_id: candidate.id }]);
  });

  test("the only owner of a company with teammates must transfer first", async () => {
    const owner = await makeCompanyRecruiter();
    const mate = await teammate(owner);
    const res = await as(owner).delete("/api/users/me").send({ password: PASSWORD }).expect(409);
    expect(res.body.code).toBe("OWNER_MUST_TRANSFER");
    expect(res.body.details.company.slug).toBe(owner.company.slug);
    await as(owner).get("/api/users/me").expect(200);
    // A teammate (not an owner) can leave freely.
    await as(mate).delete("/api/users/me").send({ password: PASSWORD }).expect(204);
    // A sole owner with no teammates left can delete too; the recruiter row is retired.
    await as(owner).delete("/api/users/me").send({ password: PASSWORD }).expect(204);
    const r = await db.selectFrom("recruiters").select(["status", "work_email"]).where("id", "=", owner.recruiterId).executeTakeFirstOrThrow();
    expect(r.status).toBe("SUSPENDED");
    expect(String(r.work_email)).toMatch(/@invalid\.example$/);
  });

  test("the last active admin cannot delete their account", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const others = await db.selectFrom("users").select("id").where("role", "=", "ADMIN").where("status", "=", "ACTIVE").where("id", "<>", admin.id).execute();
    // Demote the other admins created by earlier tests, then restore them.
    await db.updateTable("users").set({ role: "USER" }).where("id", "in", others.length ? others.map((o) => o.id) : [""]).execute();
    try {
      const res = await as(admin).delete("/api/users/me").send({ password: PASSWORD }).expect(409);
      expect(res.body.code).toBe("LAST_ADMIN");
    } finally {
      if (others.length) await db.updateTable("users").set({ role: "ADMIN" }).where("id", "in", others.map((o) => o.id)).execute();
    }
    // With another admin around, it works.
    await createUser({ role: "ADMIN" });
    await as(admin).delete("/api/users/me").send({ password: PASSWORD }).expect(204);
    expect((await db.selectFrom("users").select("role").where("id", "=", admin.id).executeTakeFirstOrThrow()).role).toBe("USER");
  });
});
