/** /api/network: connection requests, invitations, removal, suggestions and mutual connections. */
import { describe, expect, test } from "vitest";
import type { NetworkEntry } from "@open-talent/types";
import { db } from "../../src/db/kysely";
import { anon, as, createUser, recordRealtime, type TestUser } from "./harness";
import { allPages, block, connect, makeProfile, notificationsOf } from "./talent-fixtures";

const ask = (a: TestUser, b: TestUser, note?: string) => as(a).post("/api/network/connections").send({ userId: b.id, ...(note ? { note } : {}) });
const counts = async (...users: TestUser[]) => (await db.selectFrom("users").select(["id", "connection_count"]).where("id", "in", users.map((u) => u.id)).execute()).reduce<Record<string, number>>((m, r) => ({ ...m, [r.id]: r.connection_count }), {});
const invitations = async (u: TestUser, direction: "received" | "sent") => (await as(u).get("/api/network/invitations").query({ direction }).expect(200)).body.items as NetworkEntry[];
const myConnections = async (u: TestUser) => allPages<NetworkEntry>(async (cursor) => (await as(u).get("/api/network/connections").query(cursor ? { cursor, limit: 2 } : { limit: 2 }).expect(200)).body);

describe("requests", () => {
  test("request, then accept: both are connected, counted and notified, live", async () => {
    const [a, b] = [await createUser(), await createUser()];
    const rt = recordRealtime();
    const res = (await ask(a, b, "We met at the meetup").expect(200)).body;
    expect(res.state).toBe("PENDING_OUTGOING");
    expect(rt.to(`user:${b.id}`, "connection:request")).toMatchObject([{ connectionId: res.connectionId, note: "We met at the meetup", from: { id: a.id } }]);

    const received = await invitations(b, "received");
    expect(received).toMatchObject([{ user: { id: a.id }, connection: "PENDING_INCOMING", connectionId: res.connectionId, note: "We met at the meetup" }]);
    expect(await invitations(a, "sent")).toMatchObject([{ user: { id: b.id }, connection: "PENDING_OUTGOING" }]);
    expect((await notificationsOf(b.id)).map((n) => n.type)).toContain("CONNECTION_REQUEST");

    // Only the addressee can accept.
    await as(a).post(`/api/network/invitations/${res.connectionId}/accept`).expect(404);
    await as(b).post(`/api/network/invitations/${res.connectionId}/accept`).expect(204);
    await as(b).post(`/api/network/invitations/${res.connectionId}/accept`).expect(404);
    expect(await counts(a, b)).toEqual({ [a.id]: 1, [b.id]: 1 });
    expect((await notificationsOf(a.id)).map((n) => n.type)).toContain("CONNECTION_ACCEPTED");
    expect(rt.to(`user:${a.id}`, "connection:accepted")).toMatchObject([{ connectionId: res.connectionId, user: { id: b.id } }]);
    expect((await myConnections(a)).map((e) => e.user.id)).toEqual([b.id]);
    // Asking again once connected says so.
    expect((await ask(a, b).expect(200)).body).toEqual({ state: "CONNECTED", connectionId: res.connectionId });
    expect(await invitations(b, "received")).toEqual([]);
  });

  test("asking someone who already asked you accepts their request (one row per pair)", async () => {
    const [a, b] = [await createUser(), await createUser()];
    const first = (await ask(a, b).expect(200)).body;
    const second = (await ask(b, a).expect(200)).body;
    expect(second).toEqual({ state: "CONNECTED", connectionId: first.connectionId });
    expect(await counts(a, b)).toEqual({ [a.id]: 1, [b.id]: 1 });
    expect(await db.selectFrom("connections").select("id").where("pair_key", "in", [`${a.id}:${b.id}`, `${b.id}:${a.id}`]).execute()).toHaveLength(1);
  });

  test("a repeated request is idempotent", async () => {
    const [a, b] = [await createUser(), await createUser()];
    const one = (await ask(a, b).expect(200)).body;
    const two = (await ask(a, b).expect(200)).body;
    expect(two).toEqual(one);
  });

  test("ignore is quiet: the sender still sees it pending and cannot re-send yet", async () => {
    const [a, b] = [await makeProfile(), await makeProfile()];
    const res = (await ask(a, b).expect(200)).body;
    await as(b).post(`/api/network/invitations/${res.connectionId}/ignore`).expect(204);
    expect(await invitations(b, "received")).toEqual([]);
    expect((await ask(a, b).expect(200)).body).toEqual({ state: "PENDING_OUTGOING", connectionId: res.connectionId });
    expect((await notificationsOf(a.id)).filter((n) => n.type === "CONNECTION_ACCEPTED")).toEqual([]);
    // The ignored side reads the relation as no connection; the sender as still pending.
    const fromA = (await as(a).get(`/api/profiles/${b.username}`).expect(200)).body;
    const fromB = (await as(b).get(`/api/profiles/${a.username}`).expect(200)).body;
    expect(fromA.viewer.connection).toBe("PENDING_OUTGOING");
    expect(fromB.viewer.connection).toBe("NONE");
    // The ignorer can still connect with them later on their own initiative.
    expect((await ask(b, a).expect(200)).body.state).toBe("PENDING_OUTGOING");
  });

  test("withdraw your own request; nobody else can", async () => {
    const [a, b, c] = [await createUser(), await createUser(), await createUser()];
    const res = (await ask(a, b).expect(200)).body;
    await as(c).delete(`/api/network/invitations/${res.connectionId}`).expect(404);
    await as(b).delete(`/api/network/invitations/${res.connectionId}`).expect(404);
    await as(a).delete(`/api/network/invitations/${res.connectionId}`).expect(204);
    expect(await invitations(b, "received")).toEqual([]);
    expect((await ask(a, b).expect(200)).body.state).toBe("PENDING_OUTGOING");
  });

  test("you cannot connect with yourself, a missing account, a suspended one, or across a block", async () => {
    const a = await createUser();
    expect((await ask(a, a).expect(400)).body.code).toBe("SELF_ACTION");
    await as(a).post("/api/network/connections").send({ userId: "01ARZ3NDEKTSV4RRFFQ69G5FAV" }).expect(404);
    await ask(a, await createUser({ status: "SUSPENDED" })).expect(404);
    const blocker = await createUser();
    await block(blocker, a);
    await ask(a, blocker).expect(404);
    await ask(blocker, a).expect(404);
    // Strict body: identity comes from the session.
    await as(a).post("/api/network/connections").send({ userId: blocker.id, requesterId: blocker.id }).expect(400);
    await anon().post("/api/network/connections").send({ userId: a.id }).expect(401);
  });

  test("a suspended member cannot send requests", async () => {
    const s = await createUser({ status: "SUSPENDED" });
    expect((await ask(s, await createUser()).expect(403)).body.code).toBe("ACCOUNT_RESTRICTED");
  });
});

describe("removal and blocks", () => {
  test("remove a connection (either side), counts go back down, the other is not notified", async () => {
    const [a, b] = [await createUser(), await createUser()];
    await connect(a, b);
    const before = (await notificationsOf(a.id)).length;
    await as(b).delete(`/api/network/connections/${a.id}`).expect(204);
    await as(b).delete(`/api/network/connections/${a.id}`).expect(404);
    expect(await counts(a, b)).toEqual({ [a.id]: 0, [b.id]: 0 });
    expect(await myConnections(a)).toEqual([]);
    expect((await notificationsOf(a.id)).length).toBe(before);
  });

  test("a block ends the connection and its counts", async () => {
    const [a, b] = [await createUser(), await createUser()];
    await connect(a, b);
    await block(a, b);
    expect(await counts(a, b)).toEqual({ [a.id]: 0, [b.id]: 0 });
    expect(await myConnections(b)).toEqual([]);
    // Unblocking does not restore it.
    await as(a).delete(`/api/users/${b.id}/block`).expect(204);
    expect(await myConnections(a)).toEqual([]);
  });

  test("a pending request disappears with a block", async () => {
    const [a, b] = [await createUser(), await createUser()];
    await ask(a, b).expect(200);
    await block(b, a);
    expect(await invitations(b, "received")).toEqual([]);
    expect(await invitations(a, "sent")).toEqual([]);
  });
});

describe("lists", () => {
  test("connections of a person: public by username, minus people the viewer blocked", async () => {
    const hub = await createUser();
    const [x, y, z] = [await createUser(), await createUser(), await createUser()];
    for (const u of [x, y, z]) await connect(hub, u);
    const anonList = (await anon().get(`/api/network/of/${hub.username}`).expect(200)).body.items as NetworkEntry[];
    expect(anonList.map((e) => e.user.id).sort()).toEqual([x.id, y.id, z.id].sort());
    expect(anonList.every((e) => e.connection === "NONE")).toBe(true);
    const viewer = await createUser();
    await block(viewer, y);
    const seen = (await as(viewer).get(`/api/network/of/${hub.username}`).expect(200)).body.items as NetworkEntry[];
    expect(seen.map((e) => e.user.id).sort()).toEqual([x.id, z.id].sort());
    // From x's side: z is a mutual-of-hub, x is "connected" to hub only.
    const fromX = (await as(x).get(`/api/network/of/${hub.username}`).expect(200)).body.items as NetworkEntry[];
    expect(fromX.find((e) => e.user.id === x.id)?.connection).toBe("SELF");
    await anon().get("/api/network/of/no_such_user!").expect(404);
    // Blocked people cannot list each other.
    await as(y).get(`/api/network/of/${viewer.username}`).expect(404);
  });

  test("pagination walks every connection exactly once", async () => {
    const hub = await createUser();
    const people: TestUser[] = [];
    for (let i = 0; i < 5; i++) {
      const u = await createUser();
      await connect(hub, u);
      people.push(u);
    }
    const all = await myConnections(hub);
    expect(all.map((e) => e.user.id).sort()).toEqual(people.map((p) => p.id).sort());
    expect(new Set(all.map((e) => e.user.id)).size).toBe(5);
  });

  test("mutual connections and the mutual count", async () => {
    const [me, them, m1, m2, onlyMine] = [await createUser(), await makeProfile(), await createUser(), await createUser(), await createUser()];
    for (const m of [m1, m2]) {
      await connect(me, m);
      await connect(them, m);
    }
    await connect(me, onlyMine);
    const mutual = (await as(me).get(`/api/network/mutual/${them.id}`).expect(200)).body as NetworkEntry[];
    expect(mutual.map((e) => e.user.id).sort()).toEqual([m1.id, m2.id].sort());
    const profile = (await as(me).get(`/api/profiles/${them.username}`).expect(200)).body;
    expect(profile.viewer.mutualCount).toBe(2);
  });

  test("suggestions: second-degree first, never yourself, connections, pending or blocked people", async () => {
    const [me, friend, fof, fof2, pending, blocked] = [await createUser(), await createUser(), await createUser(), await createUser(), await createUser(), await createUser()];
    await connect(me, friend);
    for (const u of [fof, fof2, pending, blocked]) await connect(friend, u);
    // fof2 shares two mutual friends with me, fof one.
    const friend2 = await createUser();
    await connect(me, friend2);
    await connect(friend2, fof2);
    await ask(me, pending).expect(200);
    await block(blocked, me);
    const s = (await as(me).get("/api/network/suggestions").expect(200)).body as NetworkEntry[];
    const ids = s.map((e) => e.user.id);
    expect(ids.slice(0, 2)).toEqual([fof2.id, fof.id]);
    expect(s[0]!.mutualCount).toBe(2);
    for (const never of [me.id, friend.id, friend2.id, pending.id, blocked.id]) expect(ids).not.toContain(never);
  });
});
