import { describe, expect, test } from "vitest";
import type { Post } from "@open-talent/types";
import { db } from "../../src/db/kysely";
import { anon, as, createUser, recordRealtime, type TestUser } from "./harness";
import { allPages, block, connect, follow, makeCompanyRecruiter, makeJob, notificationsOf, uniq } from "./talent-fixtures";

async function post(user: TestUser, body: Record<string, unknown> = {}): Promise<Post> {
  const res = await as(user).post("/api/posts").send({ body: `Notes from the week ${uniq("p")}`, ...body });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as Post;
}

const feed = async (u: TestUser, q = "") => (await as(u).get(`/api/posts/feed${q}`).expect(200)).body as { items: Post[]; nextCursor: string | null; suggestedIds: string[] };

describe("creating posts", () => {
  test("a member posts with a mention: counter, mention notification and a feed signal to the network", async () => {
    const [alice, bob, carol] = [await createUser(), await createUser(), await createUser()];
    await connect(alice, carol);
    const rt = recordRealtime();
    const p = await post(alice, { body: `Shipped the queue rewrite, thanks @${bob.username}` });
    expect(p).toMatchObject({ status: "PUBLISHED", kind: "POST", visibility: "PUBLIC", company: null, job: null, sharedPost: null });
    expect(p.mentions.map((m) => m.id)).toEqual([bob.id]);
    expect(p.viewer).toMatchObject({ canEdit: true, canDelete: true, bookmarked: false, reaction: null });
    expect((await db.selectFrom("users").select("post_count").where("id", "=", alice.id).executeTakeFirstOrThrow()).post_count).toBe(1);
    expect((await notificationsOf(bob.id)).find((n) => n.type === "MENTION")?.entity_id).toBe(p.id);
    expect(rt.to(`user:${carol.id}`, "feed:new-posts")).toEqual([{ count: 1, latestId: p.id }]);
    expect(rt.to(`user:${bob.id}`, "feed:new-posts")).toEqual([]);
  });

  test("a CONNECTIONS-only post mentions only readers: a non-connection is not notified", async () => {
    const [alice, friend, stranger] = [await createUser(), await createUser(), await createUser()];
    await connect(alice, friend);
    await post(alice, { body: `Private hello @${friend.username} and @${stranger.username}`, visibility: "CONNECTIONS" });
    expect((await notificationsOf(friend.id)).some((n) => n.type === "MENTION")).toBe(true);
    expect((await notificationsOf(stranger.id)).some((n) => n.type === "MENTION")).toBe(false);
  });

  test("empty posts, unknown fields and a suspended author are rejected", async () => {
    const u = await createUser();
    expect((await as(u).post("/api/posts").send({ body: "   " }).expect(400)).body.code).toBe("EMPTY_POST");
    await as(u).post("/api/posts").send({ body: "hello", authorId: (await createUser()).id }).expect(400);
    await as(u).post("/api/posts").send({ body: "hello", kind: "ANNOUNCEMENT" }).expect(400);
    const s = await createUser({ status: "SUSPENDED" });
    expect((await as(s).post("/api/posts").send({ body: "hi" }).expect(403)).body.code).toBe("ACCOUNT_RESTRICTED");
    await anon().post("/api/posts").send({ body: "hi" }).expect(401);
  });

  test("kinds: a JOB post needs a job, a job needs a JOB or HIRING kind", async () => {
    const u = await createUser();
    expect((await as(u).post("/api/posts").send({ body: "x", kind: "JOB" }).expect(400)).body.code).toBe("JOB_REQUIRED");
    const p = await post(u, { kind: "MILESTONE", body: "Five years at the same desk" });
    expect(p.kind).toBe("MILESTONE");
    const otw = await post(u, { kind: "OPEN_TO_WORK", body: "Looking for platform roles" });
    expect(otw.kind).toBe("OPEN_TO_WORK");
  });
});

describe("company pages and job cards", () => {
  test("a page admin posts as the company; a plain member of the team or an outsider cannot", async () => {
    const owner = await makeCompanyRecruiter();
    const member = await makeCompanyRecruiter({ companySlug: owner.company.slug, domain: owner.company.domain });
    expect(member.account.role).toBe("RECRUITER");
    const p = await post(owner, { companyId: owner.company.id, body: "We moved into a new office" });
    expect(p.company).toMatchObject({ id: owner.company.id, slug: owner.company.slug });
    expect((await as(member).post("/api/posts").send({ body: "x", companyId: owner.company.id }).expect(403)).body.code).toBe("NOT_COMPANY_ADMIN");
    const outsider = await createUser();
    expect((await as(outsider).post("/api/posts").send({ body: "x", companyId: owner.company.id }).expect(403)).body.code).toBe("NOT_COMPANY_ADMIN");

    // The company page lists it; a teammate (page admin or not) is not the author but an admin may delete it.
    const list = await anon().get(`/api/companies/${owner.company.slug}/posts`).expect(200);
    expect(list.body.items.map((x: Post) => x.id)).toContain(p.id);
    await as(member).delete(`/api/posts/${p.id}`).expect(403);
  });

  test("a recruiter attaches an open job of their own company; others' or closed jobs are refused", async () => {
    const r = await makeCompanyRecruiter();
    const other = await makeCompanyRecruiter();
    const job = await makeJob(r);
    const foreign = await makeJob(other);
    const p = await post(r, { jobId: job.id, body: "We are hiring" });
    expect(p.kind).toBe("JOB");
    expect(p.job).toMatchObject({ id: job.id, status: "OPEN" });
    const hiring = await post(r, { jobId: job.id, kind: "HIRING", body: "Join us" });
    expect(hiring.kind).toBe("HIRING");
    expect((await as(r).post("/api/posts").send({ jobId: job.id, kind: "MILESTONE", body: "x" }).expect(400)).body.code).toBe("JOB_KIND_MISMATCH");
    expect((await as(r).post("/api/posts").send({ jobId: foreign.id }).expect(400)).body.code).toBe("JOB_NOT_SHAREABLE");
    await as(r).post(`/api/jobs/${job.id}/status`).send({ status: "CLOSED" }).expect(200);
    expect((await as(r).post("/api/posts").send({ jobId: job.id }).expect(400)).body.code).toBe("JOB_NOT_SHAREABLE");
    const candidate = await createUser();
    expect((await as(candidate).post("/api/posts").send({ jobId: foreign.id }).expect(400)).body.code).toBe("JOB_NOT_SHAREABLE");
  });
});

describe("reposts", () => {
  test("a repost points at the original, counts it and notifies its author; CONNECTIONS posts cannot be reposted", async () => {
    const [alice, bob] = [await createUser(), await createUser()];
    const original = await post(alice, { body: "Original thought" });
    const repost = await post(bob, { sharedPostId: original.id, body: "" });
    expect(repost.sharedPost?.id).toBe(original.id);
    // Reposting a repost shares the original.
    const again = await post(await createUser(), { sharedPostId: repost.id, body: "" });
    expect(again.sharedPost?.id).toBe(original.id);
    expect((await anon().get(`/api/posts/${original.id}`).expect(200)).body.repostCount).toBe(2);
    expect((await notificationsOf(alice.id)).filter((n) => n.type === "REPOST")).toHaveLength(2);

    await connect(alice, bob);
    const priv = await post(alice, { visibility: "CONNECTIONS" });
    expect((await as(bob).post("/api/posts").send({ sharedPostId: priv.id }).expect(400)).body.code).toBe("SHARE_NOT_ALLOWED");
  });
});

describe("reading posts", () => {
  test("CONNECTIONS-only posts are 404 to strangers and signed-out readers, readable by connections and staff", async () => {
    const [alice, friend, stranger] = [await createUser(), await createUser(), await createUser()];
    await connect(alice, friend);
    const p = await post(alice, { visibility: "CONNECTIONS" });
    await as(friend).get(`/api/posts/${p.id}`).expect(200);
    await as(stranger).get(`/api/posts/${p.id}`).expect(404);
    await anon().get(`/api/posts/${p.id}`).expect(404);
    await as(await createUser({ role: "MODERATOR" })).get(`/api/posts/${p.id}`).expect(200);
    // The author's activity list hides it from strangers too.
    const activity = (u: TestUser | null) => as(u).get(`/api/users/${alice.username}/posts`).expect(200);
    expect((await activity(stranger)).body.items.map((x: Post) => x.id)).not.toContain(p.id);
    expect((await activity(friend)).body.items.map((x: Post) => x.id)).toContain(p.id);
  });

  test("a block either way makes a post 404", async () => {
    const [alice, bob] = [await createUser(), await createUser()];
    const p = await post(alice);
    await block(alice, bob);
    await as(bob).get(`/api/posts/${p.id}`).expect(404);
    await as(bob).put(`/api/posts/${p.id}/reaction`).send({ type: "LIKE" }).expect(404);
    const p2 = await post(bob);
    await as(alice).get(`/api/posts/${p2.id}`).expect(404);
  });
});

describe("editing and deleting", () => {
  test("only the author edits; author deletes; staff removal leaves a moderation record", async () => {
    const [alice, bob] = [await createUser(), await createUser()];
    const p = await post(alice, { body: "first draft" });
    expect((await as(bob).patch(`/api/posts/${p.id}`).send({ body: "hijack" }).expect(403)).body.code).toBe("NOT_AUTHOR");
    const edited = await as(alice).patch(`/api/posts/${p.id}`).send({ body: "second draft", visibility: "CONNECTIONS" }).expect(200);
    expect(edited.body).toMatchObject({ body: "second draft", visibility: "CONNECTIONS" });
    expect(edited.body.editedAt).not.toBeNull();
    await as(alice).patch(`/api/posts/${p.id}`).send({ kind: "JOB" }).expect(400);
    expect((await as(alice).patch(`/api/posts/${p.id}`).send({ body: " " }).expect(400)).body.code).toBe("EMPTY_POST");

    await as(bob).delete(`/api/posts/${p.id}`).expect(404); // CONNECTIONS-only now: bob cannot even see it
    const rt = recordRealtime();
    await as(alice).delete(`/api/posts/${p.id}`).expect(204);
    expect(rt.to(`post:${p.id}`, "post:removed")).toHaveLength(1);
    expect((await db.selectFrom("posts").select("status").where("id", "=", p.id).executeTakeFirstOrThrow()).status).toBe("DELETED");
    expect((await db.selectFrom("users").select("post_count").where("id", "=", alice.id).executeTakeFirstOrThrow()).post_count).toBe(0);

    const q = await post(alice);
    const mod = await createUser({ role: "MODERATOR" });
    await as(mod).delete(`/api/posts/${q.id}`).expect(204);
    expect((await db.selectFrom("posts").select("status").where("id", "=", q.id).executeTakeFirstOrThrow()).status).toBe("REMOVED");
    const action = await db.selectFrom("moderation_actions").select(["action", "actor_id"]).where("target_id", "=", q.id).executeTakeFirst();
    expect(action?.actor_id).toBe(mod.id);
    await anon().get(`/api/posts/${q.id}`).expect(404);
  });

  test("a company page admin deletes a page post written by a teammate admin", async () => {
    const owner = await makeCompanyRecruiter();
    const p = await post(owner, { companyId: owner.company.id });
    const other = await makeCompanyRecruiter({ companySlug: owner.company.slug, domain: owner.company.domain });
    await as(owner).patch(`/api/companies/team/${other.recruiterId}`).send({ role: "ADMIN" }).expect(200);
    await as(other).delete(`/api/posts/${p.id}`).expect(204);
    expect((await db.selectFrom("posts").select("status").where("id", "=", p.id).executeTakeFirstOrThrow()).status).toBe("DELETED");
  });
});

describe("reactions", () => {
  test("react, change type, remove: counts, one notification, realtime counts, reaction list", async () => {
    const [alice, bob, carol] = [await createUser(), await createUser(), await createUser()];
    const p = await post(alice);
    const rt = recordRealtime();
    expect((await as(bob).put(`/api/posts/${p.id}/reaction`).send({ type: "LIKE" }).expect(200)).body).toEqual({ reactionCount: 1, reactionCounts: { LIKE: 1 }, viewerReaction: "LIKE" });
    expect((await as(bob).put(`/api/posts/${p.id}/reaction`).send({ type: "CELEBRATE" }).expect(200)).body).toEqual({ reactionCount: 1, reactionCounts: { CELEBRATE: 1 }, viewerReaction: "CELEBRATE" });
    await as(carol).put(`/api/posts/${p.id}/reaction`).send({ type: "INSIGHTFUL" }).expect(200);
    expect(rt.to(`post:${p.id}`, "post:updated").at(-1)).toMatchObject({ postId: p.id, reactionCount: 2, reactionCounts: { CELEBRATE: 1, INSIGHTFUL: 1 } });
    expect((await notificationsOf(alice.id)).filter((n) => n.type === "POST_REACTION")).toHaveLength(2);
    await as(bob).put(`/api/posts/${p.id}/reaction`).send({ type: "WOW" }).expect(400);

    const all = await anon().get(`/api/posts/${p.id}/reactions`).expect(200);
    expect(all.body.items.map((x: { user: { id: string } }) => x.user.id).sort()).toEqual([bob.id, carol.id].sort());
    const only = await anon().get(`/api/posts/${p.id}/reactions?type=INSIGHTFUL`).expect(200);
    expect(only.body.items).toEqual([expect.objectContaining({ type: "INSIGHTFUL", user: expect.objectContaining({ id: carol.id }) })]);

    expect((await as(bob).delete(`/api/posts/${p.id}/reaction`).expect(200)).body).toEqual({ reactionCount: 1, reactionCounts: { INSIGHTFUL: 1 }, viewerReaction: null });
    expect((await as(bob).get(`/api/posts/${p.id}`).expect(200)).body.viewer.reaction).toBeNull();
    expect((await as(carol).get(`/api/posts/${p.id}`).expect(200)).body.viewer.reaction).toBe("INSIGHTFUL");
  });

  test("concurrent reactions by the same person count once", async () => {
    const [alice, bob] = [await createUser(), await createUser()];
    const p = await post(alice);
    await Promise.all(Array.from({ length: 5 }, () => as(bob).put(`/api/posts/${p.id}/reaction`).send({ type: "LIKE" })));
    expect((await anon().get(`/api/posts/${p.id}`).expect(200)).body.reactionCount).toBe(1);
  });

  test("reacting to your own post notifies nobody", async () => {
    const alice = await createUser();
    const p = await post(alice);
    await as(alice).put(`/api/posts/${p.id}/reaction`).send({ type: "SUPPORT" }).expect(200);
    expect((await notificationsOf(alice.id)).filter((n) => n.type === "POST_REACTION")).toHaveLength(0);
  });
});

describe("bookmarks and hiding", () => {
  test("bookmark, list, unbookmark; a post you can no longer see drops out of the list", async () => {
    const [alice, bob] = [await createUser(), await createUser()];
    const p1 = await post(alice);
    const p2 = await post(alice);
    await as(bob).post(`/api/posts/${p1.id}/bookmark`).expect(204);
    await as(bob).post(`/api/posts/${p2.id}/bookmark`).expect(204);
    await as(bob).post(`/api/posts/${p2.id}/bookmark`).expect(204);
    expect((await as(bob).get(`/api/posts/${p1.id}`).expect(200)).body.viewer.bookmarked).toBe(true);
    const list = await as(bob).get("/api/users/me/bookmarks").expect(200);
    expect(list.body.items.map((x: Post) => x.id)).toEqual([p2.id, p1.id]);
    await as(bob).delete(`/api/posts/${p2.id}/bookmark`).expect(204);
    await as(alice).delete(`/api/posts/${p1.id}`).expect(204);
    expect((await as(bob).get("/api/users/me/bookmarks").expect(200)).body.items).toEqual([]);
    await as(bob).post(`/api/posts/${p1.id}/bookmark`).expect(404);
  });

  test("hiding takes a post out of your own home feed only", async () => {
    const [alice, bob, carol] = [await createUser(), await createUser(), await createUser()];
    await connect(alice, bob);
    await connect(alice, carol);
    const p = await post(alice);
    expect((await feed(bob)).items.map((x) => x.id)).toContain(p.id);
    await as(bob).post(`/api/posts/${p.id}/hide`).expect(204);
    expect((await feed(bob)).items.map((x) => x.id)).not.toContain(p.id);
    expect((await feed(carol)).items.map((x) => x.id)).toContain(p.id);
  });
});

describe("home feed", () => {
  test("network posts: connections, follows, followed companies and your own company; not strangers", async () => {
    const me = await createUser();
    const [friend, followed, stranger] = [await createUser(), await createUser(), await createUser()];
    await connect(me, friend);
    await follow(me, followed);
    const pageCo = await makeCompanyRecruiter();
    await as(me).put(`/api/companies/${pageCo.company.slug}/follow`).expect(200);
    const fromFriend = await post(friend, { visibility: "CONNECTIONS" });
    const fromFollowed = await post(followed);
    const fromCompany = await post(pageCo, { companyId: pageCo.company.id });
    const fromStranger = await post(stranger, { visibility: "CONNECTIONS" });
    const mine = await post(me);

    const f = await feed(me);
    const ids = f.items.map((x) => x.id);
    for (const id of [fromFriend.id, fromFollowed.id, fromCompany.id, mine.id]) expect(ids).toContain(id);
    expect(ids).not.toContain(fromStranger.id);
    for (const id of [fromFriend.id, fromFollowed.id, fromCompany.id, mine.id]) expect(f.suggestedIds).not.toContain(id);

    // A recruiter sees posts made as their own company page without following it.
    const teammate = await makeCompanyRecruiter({ companySlug: pageCo.company.slug, domain: pageCo.company.domain });
    expect((await feed(teammate)).items.filter((x) => !(f.suggestedIds as string[]).includes(x.id)).map((x) => x.id)).toContain(fromCompany.id);
  });

  test("a thin network is topped up with suggested PUBLIC posts, flagged in suggestedIds", async () => {
    const author = await createUser();
    const p = await post(author, { body: "A public idea worth sharing" });
    await as(await createUser()).put(`/api/posts/${p.id}/reaction`).send({ type: "LIKE" }).expect(200);
    const newcomer = await createUser();
    const f = await feed(newcomer, "?limit=50");
    expect(f.suggestedIds.length).toBeGreaterThan(0);
    for (const id of f.suggestedIds) expect(f.items.map((x) => x.id)).toContain(id);
    for (const item of f.items.filter((x) => f.suggestedIds.includes(x.id))) expect(item.visibility).toBe("PUBLIC");
    expect(new Set(f.items.map((x) => x.id)).size).toBe(f.items.length);
  });

  test("latest pages with a cursor and no duplicates; top ranks by engagement", async () => {
    const me = await createUser();
    const friend = await createUser();
    await connect(me, friend);
    const made: Post[] = [];
    for (let i = 0; i < 7; i++) made.push(await post(friend, { body: `entry ${i}` }));
    const all = await allPages<Post>(async (cursor) => feed(me, `?limit=3${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`));
    const network = all.filter((x) => made.some((m) => m.id === x.id)).map((x) => x.id);
    expect(network).toEqual(made.map((m) => m.id).reverse());
    expect(new Set(all.map((x) => x.id)).size).toBe(all.length);

    // Top: a post with comments and reactions comes first among the friend's posts.
    const star = made[2]!;
    await as(me).put(`/api/posts/${star.id}/reaction`).send({ type: "LIKE" }).expect(200);
    await as(me).post(`/api/posts/${star.id}/comments`).send({ body: "Great write up" }).expect(201);
    const top = (await feed(me, "?sort=top&limit=50")).items.filter((x) => made.some((m) => m.id === x.id));
    expect(top[0]!.id).toBe(star.id);
    await as(me).get("/api/posts/feed?sort=best").expect(400);
  });

  test("the feed needs a session", async () => {
    await anon().get("/api/posts/feed").expect(401);
  });
});
