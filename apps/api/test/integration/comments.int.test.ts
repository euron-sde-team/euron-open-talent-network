import { describe, expect, test } from "vitest";
import type { Comment, Post } from "@open-talent/types";
import { db } from "../../src/db/kysely";
import { anon, as, createUser, recordRealtime, type TestUser } from "./harness";
import { block, connect, notificationsOf, uniq } from "./talent-fixtures";

async function post(user: TestUser, extra: Record<string, unknown> = {}): Promise<Post> {
  const res = await as(user).post("/api/posts").send({ body: `A post ${uniq("p")}`, ...extra });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as Post;
}

async function comment(user: TestUser, postId: string, body: Record<string, unknown> = {}): Promise<Comment> {
  const res = await as(user).post(`/api/posts/${postId}/comments`).send({ body: `A comment ${uniq("c")}`, ...body });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as Comment;
}

const counts = async (postId: string) => (await anon().get(`/api/posts/${postId}`).expect(200)).body.commentCount as number;

describe("commenting", () => {
  test("a comment counts on the post, notifies the author, and goes to the post room", async () => {
    const [alice, bob] = [await createUser(), await createUser()];
    const p = await post(alice);
    const rt = recordRealtime();
    const c = await comment(bob, p.id, { body: "Nice work" });
    expect(c).toMatchObject({ postId: p.id, parentId: null, body: "Nice work", status: "PUBLISHED", replyCount: 0 });
    expect(c.viewer).toMatchObject({ canEdit: true, canDelete: true });
    expect(await counts(p.id)).toBe(1);
    expect((await notificationsOf(alice.id)).filter((n) => n.type === "POST_COMMENT")).toHaveLength(1);
    expect(rt.to(`post:${p.id}`, "post:comment").map((e) => e.comment.id)).toEqual([c.id]);
    expect(rt.to(`post:${p.id}`, "post:updated").at(-1)).toMatchObject({ commentCount: 1 });
  });

  test("commenting on your own post notifies nobody; empty comments and unknown fields are rejected", async () => {
    const alice = await createUser();
    const p = await post(alice);
    await comment(alice, p.id);
    expect((await notificationsOf(alice.id)).filter((n) => n.type === "POST_COMMENT")).toHaveLength(0);
    expect((await as(alice).post(`/api/posts/${p.id}/comments`).send({ body: "  " }).expect(400)).body.code).toBe("EMPTY_COMMENT");
    await as(alice).post(`/api/posts/${p.id}/comments`).send({ body: "x", authorId: "01HZZZZZZZZZZZZZZZZZZZZZZZ" }).expect(400);
    await anon().post(`/api/posts/${p.id}/comments`).send({ body: "x" }).expect(401);
  });

  test("mentions in a comment notify the person once; a CONNECTIONS post only reaches connections", async () => {
    const [alice, friend, stranger] = [await createUser(), await createUser(), await createUser()];
    await connect(alice, friend);
    const p = await post(alice, { visibility: "CONNECTIONS" });
    await comment(friend, p.id, { body: `Have a look @${alice.username} @${stranger.username}` });
    expect((await notificationsOf(stranger.id)).some((n) => n.type === "MENTION")).toBe(false);
    // The author got the POST_COMMENT, not a second MENTION.
    const mine = await notificationsOf(alice.id);
    expect(mine.filter((n) => n.type === "POST_COMMENT")).toHaveLength(1);
    expect(mine.filter((n) => n.type === "MENTION")).toHaveLength(0);
  });

  test("strangers cannot comment on a CONNECTIONS-only post; a block cuts commenting both ways", async () => {
    const [alice, bob, carol] = [await createUser(), await createUser(), await createUser()];
    const priv = await post(alice, { visibility: "CONNECTIONS" });
    await as(bob).post(`/api/posts/${priv.id}/comments`).send({ body: "hi" }).expect(404);
    const pub = await post(alice);
    const theirs = await comment(carol, pub.id);
    await block(alice, bob);
    await as(bob).post(`/api/posts/${pub.id}/comments`).send({ body: "hi" }).expect(404);
    // Carol blocks Dave: Dave cannot reply to Carol on someone else's post.
    const dave = await createUser();
    await block(carol, dave);
    await as(dave).post(`/api/posts/${pub.id}/comments`).send({ body: "reply", parentId: theirs.id }).expect(404);
    const s = await createUser({ status: "SUSPENDED" });
    expect((await as(s).post(`/api/posts/${pub.id}/comments`).send({ body: "hi" }).expect(403)).body.code).toBe("ACCOUNT_RESTRICTED");
  });
});

describe("replies", () => {
  test("one level of nesting: a reply to a reply attaches to the top comment and notifies the person replied to", async () => {
    const [alice, bob, carol] = [await createUser(), await createUser(), await createUser()];
    const p = await post(alice);
    const top = await comment(bob, p.id);
    const r1 = await comment(carol, p.id, { parentId: top.id });
    expect(r1.parentId).toBe(top.id);
    const r2 = await comment(alice, p.id, { parentId: r1.id });
    expect(r2.parentId).toBe(top.id);
    expect((await notificationsOf(bob.id)).filter((n) => n.type === "COMMENT_REPLY")).toHaveLength(1);
    expect((await notificationsOf(carol.id)).filter((n) => n.type === "COMMENT_REPLY")).toHaveLength(1);

    const topLevel = await anon().get(`/api/posts/${p.id}/comments`).expect(200);
    expect(topLevel.body.items.map((c: Comment) => c.id)).toEqual([top.id]);
    expect(topLevel.body.items[0].replyCount).toBe(2);
    const replies = await anon().get(`/api/comments/${top.id}/replies`).expect(200);
    expect(replies.body.items.map((c: Comment) => c.id)).toEqual([r1.id, r2.id]);
    expect(await counts(p.id)).toBe(3);
  });

  test("a parent from another post is not found", async () => {
    const alice = await createUser();
    const p1 = await post(alice);
    const p2 = await post(alice);
    const c = await comment(alice, p1.id);
    await as(alice).post(`/api/posts/${p2.id}/comments`).send({ body: "x", parentId: c.id }).expect(404);
  });

  test("comments page in order with a cursor", async () => {
    const alice = await createUser();
    const p = await post(alice);
    const made: Comment[] = [];
    for (let i = 0; i < 5; i++) made.push(await comment(alice, p.id, { body: `c${i}` }));
    const first = await anon().get(`/api/posts/${p.id}/comments?limit=2`).expect(200);
    expect(first.body.items.map((c: Comment) => c.body)).toEqual(["c0", "c1"]);
    const second = await anon().get(`/api/posts/${p.id}/comments?limit=2&cursor=${encodeURIComponent(first.body.nextCursor)}`).expect(200);
    expect(second.body.items.map((c: Comment) => c.body)).toEqual(["c2", "c3"]);
  });
});

describe("editing and deleting", () => {
  test("only the author edits; an edit adding a mention notifies only the new name", async () => {
    const [alice, bob, carol] = [await createUser(), await createUser(), await createUser()];
    const p = await post(alice);
    const c = await comment(bob, p.id, { body: `hello @${carol.username}` });
    expect((await as(alice).patch(`/api/comments/${c.id}`).send({ body: "hijack" }).expect(403)).body.code).toBe("NOT_AUTHOR");
    const dave = await createUser();
    const edited = await as(bob).patch(`/api/comments/${c.id}`).send({ body: `hello @${carol.username} and @${dave.username}` }).expect(200);
    expect(edited.body.editedAt).not.toBeNull();
    expect((await notificationsOf(carol.id)).filter((n) => n.type === "MENTION")).toHaveLength(1);
    expect((await notificationsOf(dave.id)).filter((n) => n.type === "MENTION")).toHaveLength(1);
    expect((await as(bob).patch(`/api/comments/${c.id}`).send({ body: "" }).expect(400)).body.code).toBe("EMPTY_COMMENT");
  });

  test("author, post owner and staff may delete; counters go back; others may not", async () => {
    const [alice, bob, carol] = [await createUser(), await createUser(), await createUser()];
    const p = await post(alice);
    const top = await comment(bob, p.id);
    const reply = await comment(carol, p.id, { parentId: top.id });
    const other = await comment(carol, p.id);
    expect(await counts(p.id)).toBe(3);

    expect((await as(bob).delete(`/api/comments/${other.id}`).expect(403)).body.code).toBe("NOT_AUTHOR");
    await as(carol).delete(`/api/comments/${reply.id}`).expect(204);
    expect((await anon().get(`/api/posts/${p.id}/comments`).expect(200)).body.items[0].replyCount).toBe(0);
    await as(alice).delete(`/api/comments/${top.id}`).expect(204);
    expect((await db.selectFrom("comments").select("status").where("id", "=", top.id).executeTakeFirstOrThrow()).status).toBe("DELETED");

    const mod = await createUser({ role: "MODERATOR" });
    await as(mod).delete(`/api/comments/${other.id}`).expect(204);
    expect((await db.selectFrom("comments").select("status").where("id", "=", other.id).executeTakeFirstOrThrow()).status).toBe("REMOVED");
    expect((await db.selectFrom("moderation_actions").select("actor_id").where("target_id", "=", other.id).executeTakeFirst())?.actor_id).toBe(mod.id);
    expect(await counts(p.id)).toBe(0);
    await as(carol).patch(`/api/comments/${other.id}`).send({ body: "back" }).expect(404);
  });
});

describe("comment reactions", () => {
  test("react, replace, remove with counts; the author is notified once", async () => {
    const [alice, bob] = [await createUser(), await createUser()];
    const p = await post(alice);
    const c = await comment(alice, p.id);
    expect((await as(bob).put(`/api/comments/${c.id}/reaction`).send({ type: "LIKE" }).expect(200)).body).toEqual({ reactionCount: 1, reactionCounts: { LIKE: 1 }, viewerReaction: "LIKE" });
    expect((await as(bob).put(`/api/comments/${c.id}/reaction`).send({ type: "FUNNY" }).expect(200)).body).toEqual({ reactionCount: 1, reactionCounts: { FUNNY: 1 }, viewerReaction: "FUNNY" });
    expect((await notificationsOf(alice.id)).filter((n) => n.type === "COMMENT_REACTION")).toHaveLength(1);
    const listed = await as(bob).get(`/api/posts/${p.id}/comments`).expect(200);
    expect(listed.body.items[0]).toMatchObject({ reactionCount: 1, viewer: { reaction: "FUNNY" } });
    expect((await as(bob).delete(`/api/comments/${c.id}/reaction`).expect(200)).body).toEqual({ reactionCount: 0, reactionCounts: {}, viewerReaction: null });
    await block(alice, bob);
    await as(bob).put(`/api/comments/${c.id}/reaction`).send({ type: "LIKE" }).expect(404);
  });
});
