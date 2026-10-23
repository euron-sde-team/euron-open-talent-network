import { afterEach, describe, expect, test } from "vitest";
import type { Message, Thread } from "@open-talent/types";
import { db } from "../../src/db/kysely";
import { as, createUser, recordRealtime, type TestUser } from "./harness";
import { TINY_PNG, upload } from "./media-helpers";
import { acceptedApproach, apply, block, connect, makeCompanyRecruiter, makeJob, makeProfile, notificationsOf, resetSettings, setSettings } from "./talent-fixtures";

const rt = recordRealtime();

async function open(a: TestUser, b: TestUser): Promise<Thread> {
  const res = await as(a).post("/api/dms/threads").send({ userId: b.id });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as Thread;
}
const send = (u: TestUser, threadId: string, body: string | Record<string, unknown>) =>
  as(u)
    .post(`/api/dms/threads/${threadId}/messages`)
    .send(typeof body === "string" ? { body } : body);
const stateOf = (t: Thread, u: TestUser) => t.participants.find((p) => p.user.id === u.id)?.state;
const folder = async (u: TestUser, f: "inbox" | "requests" | "archived") => ((await as(u).get(`/api/dms/threads?folder=${f}`).expect(200)).body.items as Thread[]).map((t) => t.id);
const eligibility = async (a: TestUser, b: TestUser) => (await as(a).get(`/api/dms/eligibility/${b.id}`).expect(200)).body;

async function friends() {
  const [a, b] = [await createUser(), await createUser()];
  await connect(a, b);
  return { a, b, t: await open(a, b) };
}

afterEach(resetSettings);

describe("who may start a conversation", () => {
  test("connections message directly: one thread per pair, from either side", async () => {
    const { a, b, t } = await friends();
    expect(t.context).toBe("CONNECTION");
    expect([stateOf(t, a), stateOf(t, b)]).toEqual(["ACTIVE", "ACTIVE"]);
    expect(await eligibility(a, b)).toEqual({ canMessage: true, canRequest: false, reason: null });
    expect((await open(a, b)).id).toBe(t.id);
    expect((await open(b, a)).id).toBe(t.id);
  });

  test("strangers: the default RECRUITERS policy refuses a member with NOT_CONNECTED", async () => {
    const [a, b] = [await createUser(), await createUser()];
    const res = await as(a).post("/api/dms/threads").send({ userId: b.id }).expect(403);
    expect(res.body).toMatchObject({ code: "DM_NOT_ALLOWED", details: { reason: "NOT_CONNECTED" } });
    expect(await eligibility(a, b)).toEqual({ canMessage: false, canRequest: false, reason: "NOT_CONNECTED" });
  });

  test("an ACTIVE recruiter may send a request under RECRUITERS; ANYONE admits members; NOBODY admits no one", async () => {
    const recruiter = await makeCompanyRecruiter();
    const [member, def, anyone, nobody] = [await createUser(), await createUser(), await createUser({ requestPolicy: "ANYONE" }), await createUser({ requestPolicy: "NOBODY" })];
    expect(await eligibility(recruiter, def)).toEqual({ canMessage: false, canRequest: true, reason: "NOT_CONNECTED" });
    const t = await open(recruiter, def);
    expect(t.context).toBe("REQUEST");
    expect([stateOf(t, recruiter), stateOf(t, def)]).toEqual(["ACTIVE", "REQUESTED"]);

    expect(await eligibility(member, anyone)).toEqual({ canMessage: false, canRequest: true, reason: "NOT_CONNECTED" });
    expect(stateOf(await open(member, anyone), anyone)).toBe("REQUESTED");

    for (const sender of [member, recruiter]) {
      expect((await as(sender).post("/api/dms/threads").send({ userId: nobody.id }).expect(403)).body.details.reason).toBe("RECIPIENT_CLOSED_REQUESTS");
    }
  });

  test("a recruiter awaiting review is not an ACTIVE recruiter", async () => {
    const pending = await makeCompanyRecruiter({ stopAt: "PENDING_REVIEW" });
    const target = await createUser();
    expect((await eligibility(pending, target)).reason).toBe("NOT_CONNECTED");
    await as(pending).post("/api/dms/threads").send({ userId: target.id }).expect(403);
  });

  test("an accepted approach opens an APPROACH thread both sides can write in", async () => {
    const { recruiter, candidate, approach } = await acceptedApproach(["EMAIL"]);
    expect(approach.threadId).toBeTruthy();
    expect(await eligibility(candidate, recruiter)).toEqual({ canMessage: true, canRequest: false, reason: null });
    const t = await open(candidate, recruiter);
    expect(t).toMatchObject({ id: approach.threadId, context: "APPROACH", contextId: approach.id });
    await send(recruiter, t.id, "Thanks for accepting").expect(201);
    await send(candidate, t.id, "Happy to talk").expect(201);
  });

  test("an application links the candidate with every active recruiter of the company", async () => {
    const poster = await makeCompanyRecruiter();
    const mate = await makeCompanyRecruiter({ companySlug: poster.company.slug, domain: poster.company.domain });
    const cand = await makeProfile();
    const job = await makeJob(poster);
    const app = await apply(cand, job.id);
    expect((await eligibility(mate, cand)).canMessage).toBe(true);
    expect((await eligibility(cand, poster)).canMessage).toBe(true);
    const { threadId } = (await as(poster).post(`/api/applications/${app.id}/thread`).expect(200)).body;
    const t = (await as(cand).get(`/api/dms/threads/${threadId}`).expect(200)).body as Thread;
    expect(t).toMatchObject({ context: "APPLICATION", contextId: app.id, viewerState: "ACTIVE" });
    // The candidate may open the same conversation from their side.
    expect((await as(cand).post(`/api/applications/${app.id}/thread`).expect(200)).body.threadId).toBe(threadId);
    // An outsider cannot open it.
    await as(await createUser()).post(`/api/applications/${app.id}/thread`).expect(403);
    // Withdrawing ends the link.
    await as(cand).post(`/api/applications/${app.id}/withdraw`).expect(200);
    expect((await eligibility(mate, cand)).canMessage).toBe(false);
  });

  test("staff may message anyone, as SUPPORT, but never across a block", async () => {
    const [mod, closed, blocker] = [await createUser({ role: "MODERATOR" }), await createUser({ requestPolicy: "NOBODY" }), await createUser()];
    const t = await open(mod, closed);
    expect(t.context).toBe("SUPPORT");
    expect([stateOf(t, mod), stateOf(t, closed)]).toEqual(["ACTIVE", "ACTIVE"]);
    await block(blocker, mod);
    expect((await as(mod).post("/api/dms/threads").send({ userId: blocker.id }).expect(403)).body.details.reason).toBe("BLOCKED");
  });

  test("yourself, unknown people and restricted accounts", async () => {
    const a = await createUser();
    expect((await as(a).post("/api/dms/threads").send({ userId: a.id }).expect(403)).body.details.reason).toBe("SELF");
    expect((await as(a).get(`/api/dms/eligibility/${a.id}`).expect(200)).body.reason).toBe("SELF");
    const suspended = await createUser({ status: "SUSPENDED" });
    expect((await eligibility(a, suspended)).reason).toBe("RECIPIENT_UNAVAILABLE");
    // A suspended sender: the eligibility says why; writes are refused outright.
    expect((await eligibility(suspended, a)).reason).toBe("SENDER_RESTRICTED");
    expect((await as(suspended).post("/api/dms/threads").send({ userId: a.id }).expect(403)).body.code).toBe("ACCOUNT_RESTRICTED");
    await as(a).post("/api/dms/threads").send({ userId: "not-an-id" }).expect(400);
  });
});

describe("message requests", () => {
  test("the request shows in Requests after the first message, notifies once, and is capped until accepted", async () => {
    const recruiter = await makeCompanyRecruiter();
    const cand = await createUser();
    const t = await open(recruiter, cand);
    expect(await folder(cand, "requests")).not.toContain(t.id);
    expect(await folder(recruiter, "inbox")).toContain(t.id);
    rt.clear();
    for (let i = 1; i <= 3; i++) await send(recruiter, t.id, `intro ${i}`).expect(201);
    expect(await folder(cand, "requests")).toContain(t.id);
    expect(await folder(cand, "inbox")).not.toContain(t.id);
    expect((await notificationsOf(cand.id)).filter((n) => n.type === "DM_REQUEST")).toHaveLength(1);
    expect(rt.to(`user:${cand.id}`, "dm:request")).toHaveLength(1);
    expect(rt.to(`user:${cand.id}`, "dm:message")).toHaveLength(3);
    expect((await as(cand).get("/api/dms/unread").expect(200)).body).toEqual({ inbox: 0, requests: 1 });

    const capped = await send(recruiter, t.id, "one more").expect(403);
    expect(capped.body.code).toBe("DM_REQUEST_PENDING");
    // Deleting a message does not give the slot back.
    const msgs = (await as(recruiter).get(`/api/dms/threads/${t.id}/messages`).expect(200)).body.items as Message[];
    await as(recruiter).delete(`/api/dms/messages/${msgs[0]!.id}`).expect(204);
    await send(recruiter, t.id, "sneaky").expect(403);

    const accepted = await as(cand).post(`/api/dms/threads/${t.id}/accept`).expect(200);
    expect(accepted.body.viewerState).toBe("ACTIVE");
    await send(recruiter, t.id, "thanks").expect(201);
    expect(await folder(cand, "inbox")).toContain(t.id);
    await as(cand).post(`/api/dms/threads/${t.id}/accept`).expect(400);
  });

  test("the request cap follows the platform setting", async () => {
    await setSettings({ messaging: { requestMessageCap: 1 } });
    const recruiter = await makeCompanyRecruiter();
    const cand = await createUser();
    const t = await open(recruiter, cand);
    await send(recruiter, t.id, "hello").expect(201);
    expect((await send(recruiter, t.id, "again").expect(403)).body.code).toBe("DM_REQUEST_PENDING");
  });

  test("replying to a request accepts it", async () => {
    const recruiter = await makeCompanyRecruiter();
    const cand = await createUser();
    const t = await open(recruiter, cand);
    await send(recruiter, t.id, "hello").expect(201);
    await send(cand, t.id, "hi back").expect(201);
    expect((await as(cand).get(`/api/dms/threads/${t.id}`).expect(200)).body.viewerState).toBe("ACTIVE");
    for (let i = 0; i < 4; i++) await send(recruiter, t.id, `m${i}`).expect(201);
  });

  test("a declined request reads as closed to the sender and disappears for the recipient", async () => {
    const recruiter = await makeCompanyRecruiter();
    const cand = await createUser();
    const t = await open(recruiter, cand);
    await send(recruiter, t.id, "hello").expect(201);
    await as(cand).post(`/api/dms/threads/${t.id}/decline`).expect(204);
    const res = await send(recruiter, t.id, "follow up").expect(403);
    expect(res.body).toMatchObject({ code: "DM_NOT_ALLOWED", details: { reason: "RECIPIENT_CLOSED_REQUESTS" } });
    expect(await folder(cand, "requests")).not.toContain(t.id);
    await as(cand).get(`/api/dms/threads/${t.id}`).expect(404);
    await as(cand).post(`/api/dms/threads/${t.id}/decline`).expect(404);
  });
});

describe("in a conversation", () => {
  test("messages page newest first; edits and deletes are the sender's; a delete leaves a tombstone", async () => {
    const { a, b, t } = await friends();
    for (let i = 0; i < 5; i++) await send(i % 2 ? b : a, t.id, `m${i}`).expect(201);
    const p1 = await as(a).get(`/api/dms/threads/${t.id}/messages?limit=2`).expect(200);
    expect(p1.body.items.map((m: Message) => m.body)).toEqual(["m4", "m3"]);
    const p2 = await as(a).get(`/api/dms/threads/${t.id}/messages?limit=2&cursor=${encodeURIComponent(p1.body.nextCursor)}`).expect(200);
    expect(p2.body.items.map((m: Message) => m.body)).toEqual(["m2", "m1"]);

    const mine = p1.body.items[0] as Message; // m4, sent by a
    await as(b).patch(`/api/dms/messages/${mine.id}`).send({ body: "hijack" }).expect(403);
    const edited = await as(a).patch(`/api/dms/messages/${mine.id}`).send({ body: "m4 edited" }).expect(200);
    expect(edited.body).toMatchObject({ body: "m4 edited" });
    expect(edited.body.editedAt).not.toBeNull();
    expect(rt.to(`user:${b.id}`, "dm:message:updated").some((e) => e.message.id === mine.id)).toBe(true);

    await as(b).delete(`/api/dms/messages/${mine.id}`).expect(403);
    await as(a).delete(`/api/dms/messages/${mine.id}`).expect(204);
    const after = (await as(b).get(`/api/dms/threads/${t.id}/messages?limit=1`).expect(200)).body.items[0] as Message;
    expect(after).toMatchObject({ id: mine.id, status: "DELETED", body: "", media: [] });
    expect((await as(a).patch(`/api/dms/messages/${mine.id}`).send({ body: "back" }).expect(400)).body.code).toBe("MESSAGE_DELETED");
    expect(rt.to(`user:${b.id}`, "dm:message:deleted").some((e) => e.messageId === mine.id)).toBe(true);
  });

  test("empty messages, foreign replies and outsiders are refused", async () => {
    const { a, b, t } = await friends();
    expect((await send(a, t.id, "   ").expect(400)).body.code).toBe("MESSAGE_EMPTY");
    const other = await friends();
    const foreign = (await send(other.a, other.t.id, "elsewhere").expect(201)).body as Message;
    expect((await send(a, t.id, { body: "re", replyToId: foreign.id }).expect(400)).body.code).toBe("REPLY_INVALID");
    const m = (await send(b, t.id, "question").expect(201)).body as Message;
    const reply = (await send(a, t.id, { body: "answer", replyToId: m.id }).expect(201)).body as Message;
    expect(reply.replyTo).toMatchObject({ id: m.id, body: "question" });
    const outsider = await createUser();
    await as(outsider).get(`/api/dms/threads/${t.id}`).expect(404);
    await as(outsider).get(`/api/dms/threads/${t.id}/messages`).expect(404);
    await send(outsider, t.id, "let me in").expect(404);
    await as(outsider).put(`/api/dms/messages/${m.id}/reactions/${encodeURIComponent("👍")}`).expect(404);
  });

  test("reactions are idempotent per emoji and removable", async () => {
    const { a, b, t } = await friends();
    const m = (await send(a, t.id, "ship it").expect(201)).body as Message;
    const emoji = encodeURIComponent("🎉");
    await as(b).put(`/api/dms/messages/${m.id}/reactions/${emoji}`).expect(200);
    const twice = await as(b).put(`/api/dms/messages/${m.id}/reactions/${emoji}`).expect(200);
    expect(twice.body.reactions).toEqual([{ emoji: "🎉", count: 1, reactedByViewer: true }]);
    const seenByA = await as(a).put(`/api/dms/messages/${m.id}/reactions/${emoji}`).expect(200);
    expect(seenByA.body.reactions).toEqual([{ emoji: "🎉", count: 2, reactedByViewer: true }]);
    const removed = await as(b).delete(`/api/dms/messages/${m.id}/reactions/${emoji}`).expect(200);
    expect(removed.body.reactions).toEqual([{ emoji: "🎉", count: 1, reactedByViewer: false }]);
  });

  test("unread counts, mark read, mute and the unread badge", async () => {
    const { a, b, t } = await friends();
    await send(a, t.id, "one").expect(201);
    await send(a, t.id, "two").expect(201);
    expect((await as(b).get("/api/dms/unread").expect(200)).body).toEqual({ inbox: 2, requests: 0 });
    expect(((await as(b).get("/api/dms/threads?folder=inbox").expect(200)).body.items as Thread[]).find((x) => x.id === t.id)?.unreadCount).toBe(2);
    expect((await as(a).get("/api/dms/unread").expect(200)).body.inbox).toBe(0);
    await as(b).post(`/api/dms/threads/${t.id}/read`).expect(204);
    expect((await as(b).get("/api/dms/unread").expect(200)).body).toEqual({ inbox: 0, requests: 0 });
    expect(rt.to(`user:${a.id}`, "dm:read").some((e) => e.threadId === t.id && e.userId === b.id)).toBe(true);

    const muted = await as(b).patch(`/api/dms/threads/${t.id}`).send({ mutedUntil: new Date(Date.now() + 3600_000).toISOString() }).expect(200);
    expect(muted.body.mutedUntil).not.toBeNull();
    await send(a, t.id, "three").expect(201);
    expect((await as(b).get("/api/dms/unread").expect(200)).body.inbox).toBe(0);
    await as(b).patch(`/api/dms/threads/${t.id}`).send({ mutedUntil: null }).expect(200);
    expect((await as(b).get("/api/dms/unread").expect(200)).body.inbox).toBe(1);
    await as(b).patch(`/api/dms/threads/${t.id}`).send({ pinned: true }).expect(400);
  });

  test("archive moves a thread out of the inbox; a new message brings it back", async () => {
    const { a, b, t } = await friends();
    await send(a, t.id, "hello").expect(201);
    const archived = await as(b).patch(`/api/dms/threads/${t.id}`).send({ archived: true }).expect(200);
    expect(archived.body.archived).toBe(true);
    expect(await folder(b, "inbox")).not.toContain(t.id);
    expect(await folder(b, "archived")).toContain(t.id);
    expect(await folder(a, "inbox")).toContain(t.id);
    await send(a, t.id, "still there?").expect(201);
    expect(await folder(b, "inbox")).toContain(t.id);
    expect(await folder(b, "archived")).not.toContain(t.id);
  });

  test("search within a thread and the media drawer", async () => {
    const { a, b, t } = await friends();
    await send(a, t.id, "the quarterly roadmap is ready").expect(201);
    await send(b, t.id, "lunch tomorrow").expect(201);
    const found = await as(b).get(`/api/dms/threads/${t.id}/search?q=roadmap`).expect(200);
    expect(found.body.map((m: Message) => m.body)).toEqual(["the quarterly roadmap is ready"]);
    await as(b).get(`/api/dms/threads/${t.id}/search?q=`).expect(400);

    const { uploadId } = await upload(a, "DM", "chart.png", "image/png", TINY_PNG);
    const withMedia = (await send(a, t.id, { mediaIds: [uploadId] }).expect(201)).body as Message;
    expect(withMedia.media.map((m) => m.id)).toEqual([uploadId]);
    const drawer = await as(b).get(`/api/dms/threads/${t.id}/media`).expect(200);
    expect(drawer.body.items.map((m: { id: string }) => m.id)).toEqual([uploadId]);
    // The same upload cannot be sent twice, and nobody can send someone else's upload.
    expect((await send(a, t.id, { mediaIds: [uploadId] }).expect(400)).body.code).toBe("MEDIA_IN_USE");
    const theirs = await upload(b, "DM", "b.png", "image/png", TINY_PNG);
    expect((await send(a, t.id, { mediaIds: [theirs.uploadId] }).expect(400)).body.code).toBe("MEDIA_INVALID");
  });

  test("the contacts rail lists connections who are active and not blocked", async () => {
    const me = await createUser();
    const [f1, f2, f3] = [await createUser(), await createUser(), await createUser()];
    for (const f of [f1, f2, f3]) await connect(me, f);
    await block(me, f2);
    await db.updateTable("users").set({ status: "SUSPENDED" }).where("id", "=", f3.id).execute();
    const rail = await as(me).get("/api/dms/contacts").expect(200);
    expect(rail.body.map((c: { user: { id: string } }) => c.user.id)).toEqual([f1.id]);
    expect(rail.body[0]).toMatchObject({ online: false });
  });
});

describe("blocks and account status", () => {
  test("a block in either direction stops sending in an existing thread and opening a new one", async () => {
    const { a, b, t } = await friends();
    await send(a, t.id, "hi").expect(201);
    await block(b, a);
    for (const [from, to] of [
      [a, b],
      [b, a],
    ] as const) {
      expect((await send(from, t.id, "still?").expect(403)).body).toMatchObject({ code: "DM_NOT_ALLOWED", details: { reason: "BLOCKED" } });
      expect((await as(from).post("/api/dms/threads").send({ userId: to.id }).expect(403)).body.details.reason).toBe("BLOCKED");
      expect((await eligibility(from, to)).reason).toBe("BLOCKED");
    }
    expect((await as(a).get(`/api/dms/threads/${t.id}`).expect(200)).body.canSend).toBe(false);
    // Unblocking does not restore the connection a block ended.
    await as(b).delete(`/api/users/${a.id}/block`).expect(204);
    expect((await eligibility(a, b)).reason).toBe("NOT_CONNECTED");
  });

  test("a recipient suspended mid-conversation can no longer be written to", async () => {
    const { a, b, t } = await friends();
    await db.updateTable("users").set({ status: "SUSPENDED" }).where("id", "=", b.id).execute();
    expect((await send(a, t.id, "hello?").expect(403)).body.details.reason).toBe("RECIPIENT_UNAVAILABLE");
  });
});
