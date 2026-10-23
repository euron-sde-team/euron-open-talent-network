import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { io as connectClient, type Socket } from "socket.io-client";
import { db } from "../../src/db/kysely";
import { listenWithGateway } from "../../src/realtime/gateway";
import { app, as, createUser, PASSWORD, type TestUser } from "./harness";
import { apply, approach, block, connect as connectPeople, follow, makeCompanyRecruiter, makeJob, makeProfile, operator, waitFor } from "./talent-fixtures";

type Server = Awaited<ReturnType<typeof listenWithGateway>>;
let main: Server;
let second: Server;
const sockets: Socket[] = [];

beforeAll(async () => {
  main = await listenWithGateway(app, { revalidateMs: 300 });
  // A second API task sharing Redis; it does not install itself as the emit transport, so
  // anything it delivers must have crossed the Redis adapter.
  second = await listenWithGateway(app, { installTransport: false });
});

afterAll(async () => {
  for (const s of sockets) s.disconnect();
  await second.close();
  await main.close();
});

function connect(user: TestUser | { token: string } | null, url = main.url): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = connectClient(url, { path: "/socket.io", transports: ["websocket"], reconnection: false, forceNew: true, auth: user ? { token: user.token } : {} });
    sockets.push(s);
    s.once("connect", () => resolve(s));
    s.once("connect_error", (err) => reject(err));
  });
}

/** Collect every event of one name a socket receives. */
function collect<T = any>(s: Socket, event: string): T[] {
  const got: T[] = [];
  s.on(event, (p: T) => got.push(p));
  return got;
}

function ack<T = any>(s: Socket, event: string, payload: unknown): Promise<T> {
  return new Promise((resolve) => s.emit(event, payload, resolve));
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = (check: () => unknown, ms = 3000) => waitFor(async () => !!(await check()), ms);

async function friends() {
  const [a, b] = [await createUser(), await createUser()];
  await connectPeople(a, b);
  const t = (await as(a).post("/api/dms/threads").send({ userId: b.id }).expect(200)).body;
  return { a, b, t };
}

/** Rooms a user's sockets are in right now, across both tasks. */
async function roomsOf(user: TestUser): Promise<Set<string>> {
  const found = await main.gateway.io.in(`user:${user.id}`).fetchSockets();
  return new Set(found.flatMap((s) => [...s.rooms]));
}

describe("authentication", () => {
  test("a missing or bad token is rejected with the failure code", async () => {
    await expect(connect(null)).rejects.toThrow("MISSING");
    await expect(connect({ token: "garbage" })).rejects.toThrow("INVALID");
    const banned = await createUser({ status: "BANNED" });
    await expect(connect(banned)).rejects.toThrow("BANNED");
  });

  test("answers /socket.io with and without the trailing slash (the web dev proxy drops it)", async () => {
    for (const path of ["/socket.io/", "/socket.io"]) {
      const res = await fetch(`${main.url}${path}?EIO=4&transport=polling`);
      expect(res.status, path).toBe(200);
      expect(await res.text()).toMatch(/^0\{"sid":/);
    }
  });
});

describe("DM delivery", () => {
  test("dm:message reaches the recipient's sockets and the sender's other tabs, nobody else", async () => {
    const { a, b, t } = await friends();
    const outsider = await createUser();
    const [aTab, bTab1, bTab2, out] = [await connect(a), await connect(b), await connect(b), await connect(outsider)];
    const got = { a: collect(aTab, "dm:message"), b1: collect(bTab1, "dm:message"), b2: collect(bTab2, "dm:message"), out: collect(out, "dm:message") };
    const msg = (await as(a).post(`/api/dms/threads/${t.id}/messages`).send({ body: "ping" }).expect(201)).body;
    await until(() => got.b1.length && got.b2.length && got.a.length);
    expect(got.b1[0]).toMatchObject({ threadId: t.id, message: { id: msg.id, body: "ping" } });
    await pause(100);
    expect(got.out).toHaveLength(0);
  });

  test("a message request arrives as dm:request plus dm:message for the recipient only", async () => {
    const recruiter = await makeCompanyRecruiter();
    const cand = await createUser();
    const sc = await connect(cand);
    const [requests, messages] = [collect(sc, "dm:request"), collect(sc, "dm:message")];
    const t = (await as(recruiter).post("/api/dms/threads").send({ userId: cand.id }).expect(200)).body;
    await as(recruiter).post(`/api/dms/threads/${t.id}/messages`).send({ body: "Hello from a recruiter" }).expect(201);
    await until(() => requests.length && messages.length);
    expect(requests[0].thread).toMatchObject({ id: t.id, viewerState: "REQUESTED" });
  });

  test("nothing crosses a block: no delivery, no typing, and presence is not disclosed", async () => {
    const { a, b, t } = await friends();
    const [sa, sb] = [await connect(a), await connect(b)];
    const msgs = collect(sb, "dm:message");
    const typing = collect(sb, "dm:typing");
    await block(b, a);
    await as(a).post(`/api/dms/threads/${t.id}/messages`).send({ body: "hello?" }).expect(403);
    sa.emit("dm:typing", { threadId: t.id, typing: true });
    await pause(150);
    expect(msgs).toHaveLength(0);
    expect(typing).toHaveLength(0);
    expect(await ack(sb, "presence:query", { userIds: [a.id] })).toEqual({ ok: true, data: {} });
  });

  test("delivered through a second API task over the Redis adapter", async () => {
    const { a, b, t } = await friends();
    const onSecond = await connect(b, second.url);
    const got = collect(onSecond, "dm:message");
    await as(a).post(`/api/dms/threads/${t.id}/messages`).send({ body: "cross-task" }).expect(201);
    await until(() => got.length);
    expect(got[0].message.body).toBe("cross-task");
  });

  test("thread:subscribe is for participants only; dm:typing reaches the other side, throttled", async () => {
    const { a, b, t } = await friends();
    const [sa, sb, so] = [await connect(a), await connect(b), await connect(await createUser())];
    expect(await ack(sa, "thread:subscribe", { threadId: t.id })).toEqual({ ok: true });
    expect(await ack(so, "thread:subscribe", { threadId: t.id })).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await ack(so, "thread:subscribe", { threadId: "nope" })).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    const got = collect(sb, "dm:typing");
    const self = collect(sa, "dm:typing");
    sa.emit("dm:typing", { threadId: t.id, typing: true });
    sa.emit("dm:typing", { threadId: t.id, typing: true });
    sa.emit("dm:typing", { threadId: t.id, typing: false });
    await until(() => got.length >= 2);
    await pause(100);
    expect(got).toEqual([
      { threadId: t.id, userId: a.id, typing: true },
      { threadId: t.id, userId: a.id, typing: false },
    ]);
    expect(self).toHaveLength(0);
  });
});

describe("network events", () => {
  test("connection:request goes to the addressee, connection:accepted back to the requester", async () => {
    const [a, b, c] = [await createUser({ displayName: "Avery Asker" }), await createUser(), await createUser()];
    const [sa, sb, sc] = [await connect(a), await connect(b), await connect(c)];
    const [req, accepted, leakedReq, leakedAcc] = [collect(sb, "connection:request"), collect(sa, "connection:accepted"), collect(sc, "connection:request"), collect(sc, "connection:accepted")];
    const res = await as(a).post("/api/network/connections").send({ userId: b.id, note: "We met at the meetup" }).expect(200);
    await until(() => req.length);
    expect(req[0]).toMatchObject({ connectionId: res.body.connectionId, from: { id: a.id, displayName: "Avery Asker" }, note: "We met at the meetup" });
    await as(b).post(`/api/network/invitations/${res.body.connectionId}/accept`).expect(204);
    await until(() => accepted.length);
    expect(accepted[0]).toMatchObject({ connectionId: res.body.connectionId, user: { id: b.id } });
    await pause(50);
    expect([leakedReq, leakedAcc]).toEqual([[], []]);
  });
});

describe("approach events", () => {
  test("approach:new reaches the candidate; approach:updated reaches both sides on accept", async () => {
    const recruiter = await makeCompanyRecruiter();
    const cand = await makeProfile();
    const outsider = await createUser();
    const [sr, sc, so] = [await connect(recruiter), await connect(cand), await connect(outsider)];
    const fresh = collect(sc, "approach:new");
    const [updC, updR, leak] = [collect(sc, "approach:updated"), collect(sr, "approach:updated"), collect(so, "approach:new")];
    const a = await approach(recruiter, cand);
    await until(() => fresh.length);
    expect(fresh[0].approach).toMatchObject({ id: a.id, status: "PENDING" });
    await as(cand).post(`/api/approaches/${a.id}/accept`).send({ channels: ["EMAIL"] }).expect(200);
    await until(() => updC.length && updR.length);
    expect(updR[0].approach).toMatchObject({ id: a.id, status: "ACCEPTED" });
    // The pushed approach never carries contact details.
    expect(JSON.stringify(updR[0])).not.toContain(cand.contact.email!);
    expect(leak).toHaveLength(0);
  });
});

describe("hiring pipeline events", () => {
  test("job:subscribe is for the company team only; pipeline:card reaches subscribers, application:stage the candidate", async () => {
    const poster = await makeCompanyRecruiter();
    const mate = await makeCompanyRecruiter({ companySlug: poster.company.slug, domain: poster.company.domain });
    const rival = await makeCompanyRecruiter();
    const cand = await makeProfile();
    const job = await makeJob(poster);
    const [sp, sm, sr, sc] = [await connect(poster), await connect(mate), await connect(rival), await connect(cand)];
    expect(await ack(sp, "job:subscribe", { jobId: job.id })).toEqual({ ok: true });
    expect(await ack(sm, "job:subscribe", { jobId: job.id })).toEqual({ ok: true });
    expect(await ack(sr, "job:subscribe", { jobId: job.id })).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await ack(sc, "job:subscribe", { jobId: job.id })).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await ack(sc, "job:subscribe", { jobId: "x" })).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });

    const [cardsP, cardsM, cardsR, cardsC] = [collect(sp, "pipeline:card"), collect(sm, "pipeline:card"), collect(sr, "pipeline:card"), collect(sc, "pipeline:card")];
    const stages = collect(sc, "application:stage");
    const leakedStages = collect(sm, "application:stage");
    const app = await apply(cand, job.id);
    await until(() => cardsP.length && cardsM.length);
    expect(cardsP[0]).toMatchObject({ jobId: job.id, application: { id: app.id, stage: "APPLIED" }, movedBy: null });

    await as(mate).post(`/api/applications/${app.id}/move`).send({ to: "SCREENING", note: "Strong systems background" }).expect(200);
    await until(() => stages.length && cardsP.length >= 2);
    expect(stages[0]).toMatchObject({ applicationId: app.id, jobId: job.id, stage: "SCREENING" });
    expect(cardsP.at(-1)).toMatchObject({ application: { id: app.id, stage: "SCREENING" }, movedBy: { id: mate.id } });
    // The candidate never receives the team's cards or notes.
    expect(JSON.stringify(stages)).not.toContain("Strong systems background");
    await pause(100);
    expect(cardsR).toHaveLength(0);
    expect(cardsC).toHaveLength(0);
    expect(leakedStages).toHaveLength(0);
  });

  test("a teammate removed from the company is taken out of the job room at once and cannot rejoin", async () => {
    const owner = await makeCompanyRecruiter();
    const mate = await makeCompanyRecruiter({ companySlug: owner.company.slug, domain: owner.company.domain });
    const job = await makeJob(owner);
    const s = await connect(mate);
    expect(await ack(s, "job:subscribe", { jobId: job.id })).toEqual({ ok: true });
    expect((await roomsOf(mate)).has(`job:${job.id}`)).toBe(true);
    const cards = collect(s, "pipeline:card");
    await as(owner).delete(`/api/companies/team/${mate.recruiterId}`).expect(204);
    await until(async () => !(await roomsOf(mate)).has(`job:${job.id}`));
    await apply(await makeProfile(), job.id);
    await pause(150);
    expect(cards).toHaveLength(0);
    expect(await ack(s, "job:subscribe", { jobId: job.id })).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });

  test("an operator suspending a recruiter, or the recruiter leaving, also ends the job room", async () => {
    for (const how of ["suspend", "leave"] as const) {
      const owner = await makeCompanyRecruiter();
      const mate = await makeCompanyRecruiter({ companySlug: owner.company.slug, domain: owner.company.domain });
      const job = await makeJob(owner);
      const s = await connect(mate);
      expect(await ack(s, "job:subscribe", { jobId: job.id })).toEqual({ ok: true });
      if (how === "suspend") await as(await operator("RECRUITER_OPS")).post(`/api/admin/recruiters/${mate.recruiterId}/suspend`).send({ reason: "Spam outreach" }).expect(204);
      else await as(mate).delete("/api/recruiter/me").expect(204);
      await until(async () => !(await roomsOf(mate)).has(`job:${job.id}`));
    }
  });
});

describe("presence", () => {
  test("online and offline flips reach connections; presence:query answers; last_seen_at is recorded", async () => {
    const [a, watcher] = [await createUser(), await createUser()];
    await connectPeople(watcher, a);
    const sw = await connect(watcher);
    const updates = collect(sw, "presence:update");
    const sa = await connect(a);
    await until(() => updates.some((u) => u.userId === a.id && u.online));
    expect(await ack(sw, "presence:query", { userIds: [a.id] })).toEqual({ ok: true, data: { [a.id]: true } });
    const sa2 = await connect(a);
    sa2.disconnect();
    await pause(150);
    expect(updates.filter((u) => u.userId === a.id)).toHaveLength(1);
    sa.disconnect();
    await until(() => updates.some((u) => u.userId === a.id && !u.online));
    expect(updates.at(-1)).toMatchObject({ userId: a.id, online: false, lastSeenAt: expect.any(String) });
    expect((await db.selectFrom("users").select("last_seen_at").where("id", "=", a.id).executeTakeFirstOrThrow()).last_seen_at).toBeInstanceOf(Date);
  });

  test("presence:query answers only for people the viewer could know about; the contacts rail shows who is online", async () => {
    const [viewer, connection, followed, stranger] = [await createUser(), await createUser(), await createUser(), await createUser()];
    await connectPeople(viewer, connection);
    await follow(viewer, followed);
    for (const u of [connection, followed, stranger]) await connect(u);
    const sv = await connect(viewer);
    await until(async () => (await ack(sv, "presence:query", { userIds: [connection.id] })).data?.[connection.id] === true);
    const res = await ack(sv, "presence:query", { userIds: [connection.id, followed.id, stranger.id] });
    expect(res).toEqual({ ok: true, data: { [connection.id]: true, [followed.id]: true } });
    const rail = await as(viewer).get("/api/dms/contacts").expect(200);
    expect(rail.body.find((c: { user: { id: string } }) => c.user.id === connection.id)).toMatchObject({ online: true });
  });
});

describe("revocation", () => {
  test("a ban sends session:revoked and disconnects every socket of the user", async () => {
    const admin = await operator("ADMIN");
    const target = await createUser();
    const [s1, s2] = [await connect(target), await connect(target)];
    const revoked = collect(s1, "session:revoked");
    const closed = new Promise<void>((r) => s2.once("disconnect", () => r()));
    await as(admin).post(`/api/admin/users/${target.id}/ban`).send({ reason: "Spam ring" }).expect(200);
    await closed;
    await until(() => !s1.connected);
    expect(revoked).toEqual([{ reason: "BANNED" }]);
    await expect(connect(target)).rejects.toThrow();
  });

  test("periodic re-validation drops a socket whose token version was bumped", async () => {
    const u = await createUser();
    const s = await connect(u);
    const revoked = collect(s, "session:revoked");
    await db
      .updateTable("users")
      .set((eb) => ({ token_version: eb("token_version", "+", 1) }))
      .where("id", "=", u.id)
      .execute();
    await until(() => !s.connected, 3000);
    expect(revoked[0]).toEqual({ reason: "SIGNED_OUT" });
  });

  test("sign out everywhere and a password change end every socket with SIGNED_OUT", async () => {
    for (const how of ["logout-all", "change-password"] as const) {
      const u = await createUser();
      const s = await connect(u);
      const revoked = collect(s, "session:revoked");
      if (how === "logout-all") await as(u).post("/api/auth/logout-all").expect(204);
      else await as(u).post("/api/auth/change-password").send({ currentPassword: PASSWORD, newPassword: "an-even-better-passphrase" }).expect(204);
      await until(() => !s.connected);
      expect(revoked).toEqual([{ reason: "SIGNED_OUT" }]);
    }
  });

  test("a block closes the 1:1 thread room for both sides", async () => {
    const { a: x, b: y, t } = await friends();
    const [sx, sy] = [await connect(x), await connect(y)];
    await ack(sx, "thread:subscribe", { threadId: t.id });
    await ack(sy, "thread:subscribe", { threadId: t.id });
    await as(y).post(`/api/users/${x.id}/block`).expect(204);
    await until(async () => !(await roomsOf(x)).has(`thread:${t.id}`) && !(await roomsOf(y)).has(`thread:${t.id}`));
  });
});

describe("socket abuse limits", () => {
  test("more than 30 subscribe or presence requests in 10 seconds answer RATE_LIMITED", async () => {
    const s = await connect(await createUser());
    const answers = [];
    for (let i = 0; i < 31; i++) answers.push(await ack(s, "job:subscribe", { jobId: "not-an-id" }));
    expect(answers[29]).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    expect(answers[30]).toMatchObject({ ok: false, code: "RATE_LIMITED" });
    expect(await ack(s, "presence:query", { userIds: [] })).toMatchObject({ ok: false, code: "RATE_LIMITED" });
  });

  test("the 21st live socket of one user is refused with TOO_MANY_CONNECTIONS", async () => {
    const u = await createUser();
    const opened: Socket[] = [];
    for (let i = 0; i < 20; i++) opened.push(await connect(u));
    const { liveSocketCount } = await import("../../src/realtime/presence");
    await until(async () => (await liveSocketCount(u.id)) === 20);
    await expect(connect(u)).rejects.toThrow("TOO_MANY_CONNECTIONS");
    opened[0]!.disconnect();
    await until(async () => (await liveSocketCount(u.id)) === 19);
    await connect(u);
  });
});
