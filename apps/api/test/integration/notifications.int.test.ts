import { describe, expect, test } from "vitest";
import type { Notification } from "@open-talent/types";
import { as, createUser, recordRealtime, type TestUser } from "./harness";
import { allPages, block, connect, follow, makeCompanyRecruiter, makeProfile } from "./talent-fixtures";

const list = async (u: TestUser, query = "") => (await as(u).get(`/api/notifications${query}`).expect(200)).body as { items: Notification[]; nextCursor: string | null };
const counts = async (u: TestUser) => (await as(u).get("/api/notifications/counts").expect(200)).body;

describe("the inbox", () => {
  test("lists newest first with the actor and a link, and the unread filter and badge agree", async () => {
    const [me, a, b] = [await createUser(), await createUser({ displayName: "Avery Follower" }), await createUser()];
    await follow(a, me);
    await follow(b, me);
    const page = await list(me);
    expect(page.items.map((n) => n.actor?.id)).toEqual([b.id, a.id]);
    expect(page.items[1]).toMatchObject({ type: "FOLLOW", readAt: null, href: `/in/${a.username}`, actor: { displayName: "Avery Follower" } });
    expect((await as(me).get("/api/notifications/unread-count").expect(200)).body).toEqual({ unread: 2 });

    await as(me).post(`/api/notifications/${page.items[0]!.id}/read`).expect(204);
    expect((await as(me).get("/api/notifications/unread-count").expect(200)).body).toEqual({ unread: 1 });
    const unread = await list(me, "?unread=true");
    expect(unread.items.map((n) => n.id)).toEqual([page.items[1]!.id]);
    expect((await list(me)).items[0]!.readAt).not.toBeNull();
  });

  test("read-all clears the badge; marking someone else's notification is a 404", async () => {
    const [me, other, a] = [await createUser(), await createUser(), await createUser()];
    await follow(a, me);
    await follow(a, other);
    const theirs = (await list(other)).items[0]!;
    await as(me).post(`/api/notifications/${theirs.id}/read`).expect(404);
    expect((await list(other)).items[0]!.readAt).toBeNull();
    await as(me).post("/api/notifications/01ARZ3NDEKTSV4RRFFQ69G5FAV/read").expect(404);
    await as(me).post("/api/notifications/read-all").expect(204);
    expect((await as(me).get("/api/notifications/unread-count").expect(200)).body).toEqual({ unread: 0 });
    expect((await as(other).get("/api/notifications/unread-count").expect(200)).body).toEqual({ unread: 1 });
  });

  test("pages through every notification without duplicates", async () => {
    const me = await createUser();
    const fans: string[] = [];
    for (let i = 0; i < 5; i++) {
      const f = await createUser();
      await follow(f, me);
      fans.push(f.id);
    }
    const all = await allPages<Notification>((cursor) => list(me, `?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`));
    expect(all.map((n) => n.actor?.id).sort()).toEqual(fans.sort());
    expect(new Set(all.map((n) => n.id)).size).toBe(5);
  });

  test("never across a block, never to yourself, and repeats within the hour collapse", async () => {
    const [me, a, b] = [await createUser(), await createUser(), await createUser()];
    await follow(a, me);
    await as(a).delete(`/api/users/${me.id}/follow`).expect(204);
    await follow(a, me);
    expect((await list(me)).items).toHaveLength(1);
    await block(me, b);
    await as(b).post(`/api/users/${me.id}/follow`).expect(404);
    expect((await list(me)).items).toHaveLength(1);
  });

  test("signed-out callers get 401", async () => {
    await as(null).get("/api/notifications").expect(401);
    await as(null).get("/api/notifications/counts").expect(401);
  });
});

describe("header badges", () => {
  test("/counts reports notifications, unread threads, message requests and connection invitations", async () => {
    const me = await makeProfile();
    expect(await counts(me)).toEqual({ notifications: 0, messages: 0, messageRequests: 0, connectionRequests: 0 });

    // A pending connection invitation (and its notification).
    const asker = await createUser();
    await as(asker).post("/api/network/connections").send({ userId: me.id }).expect(200);
    expect(await counts(me)).toMatchObject({ connectionRequests: 1, notifications: 1 });

    // A message request from an active recruiter (the default policy admits recruiters).
    const rec = await makeCompanyRecruiter();
    const req = await as(rec).post("/api/dms/threads").send({ userId: me.id }).expect(200);
    await as(rec).post(`/api/dms/threads/${req.body.id}/messages`).send({ body: "Hello, could we talk about a platform role?" }).expect(201);
    expect((await counts(me)).messageRequests).toBe(1);

    // An unread message from a connection.
    const friend = await createUser();
    await connect(friend, me);
    const t = await as(friend).post("/api/dms/threads").send({ userId: me.id }).expect(200);
    await as(friend).post(`/api/dms/threads/${t.body.id}/messages`).send({ body: "Congrats on the new profile" }).expect(201);
    const c = await counts(me);
    expect(c).toMatchObject({ messages: 1, messageRequests: 1, connectionRequests: 1 });
    expect(c.notifications).toBeGreaterThanOrEqual(1);

    await as(me).post(`/api/dms/threads/${t.body.id}/read`).expect(204);
    await as(me).post("/api/notifications/read-all").expect(204);
    expect(await counts(me)).toMatchObject({ notifications: 0, messages: 0 });
  });

  test("every change pushes counts:update to the recipient's own room only", async () => {
    const rt = recordRealtime();
    const [me, a] = [await createUser(), await createUser()];
    await follow(a, me);
    const pushed = rt.to(`user:${me.id}`, "counts:update");
    expect(pushed.at(-1)).toMatchObject({ notifications: 1 });
    expect(rt.to(`user:${me.id}`, "notification:new")).toEqual([expect.objectContaining({ type: "FOLLOW" })]);
    expect(rt.to(`user:${a.id}`, "notification:new")).toEqual([]);
    rt.clear();
    await as(me).post("/api/notifications/read-all").expect(204);
    expect(rt.to(`user:${me.id}`, "counts:update").at(-1)).toMatchObject({ notifications: 0 });
  });
});
