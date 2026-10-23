import { afterEach, describe, expect, test } from "vitest";
import { db } from "../../src/db/kysely";
import { as, createUser, type TestUser } from "./harness";
import { act, openCaseOf, post, postStatus, profileIdOf, profileStatus, report, reportedPost, userStatus } from "./moderation-fixtures";
import { makeProfile, resetSettings, setSettings } from "./talent-fixtures";

const STATEMENT = "This was a quote from an article, not my own opinion.";

async function decided(by: TestUser, action: "REMOVE" | "HIDE" | "DISMISS" | "SUSPEND" | "BAN" = "REMOVE") {
  const r = await reportedPost();
  await act(by, r.caseId, { action, ...(action === "SUSPEND" ? { suspendDays: 2 } : {}) });
  return r;
}

const appeal = (user: TestUser, caseId: string, statement = STATEMENT) => as(user).post(`/api/moderation/cases/${caseId}/appeal`).send({ statement });

afterEach(resetSettings);

describe("appeals", () => {
  test("once per case, decided by someone else, and overturning restores the post", async () => {
    const mod1 = await createUser({ role: "MODERATOR" });
    const mod2 = await createUser({ role: "MODERATOR" });
    const { author, postId, caseId } = await decided(mod1);
    const before = (await db.selectFrom("users").select("post_count").where("id", "=", author.id).executeTakeFirstOrThrow()).post_count;

    const a = await appeal(author, caseId).expect(201);
    expect(a.body).toMatchObject({ caseId, status: "PENDING", appellant: { id: author.id }, statement: STATEMENT });
    expect((await appeal(author, caseId, "Please look at this one again.").expect(409)).body.code).toBe("ALREADY_APPEALED");

    const pending = await as(mod2).get("/api/moderation/appeals?status=PENDING&limit=50").expect(200);
    expect(pending.body.items.map((x: { id: string }) => x.id)).toContain(a.body.id);
    await as(author).get("/api/moderation/appeals").expect(403);

    expect((await as(mod1).post(`/api/moderation/appeals/${a.body.id}/decide`).send({ status: "OVERTURNED" }).expect(403)).body.code).toBe("APPEAL_CONFLICT");
    const done = await as(mod2).post(`/api/moderation/appeals/${a.body.id}/decide`).send({ status: "OVERTURNED", note: "Context makes it fine." }).expect(200);
    expect(done.body).toMatchObject({ status: "OVERTURNED", decisionNote: "Context makes it fine.", decidedAt: expect.any(String) });
    expect(await postStatus(postId)).toEqual({ status: "PUBLISHED", moderation_state: "CLEAN" });
    expect((await db.selectFrom("users").select("post_count").where("id", "=", author.id).executeTakeFirstOrThrow()).post_count).toBe(before + 1);
    expect(await db.selectFrom("notifications").select("type").where("recipient_id", "=", author.id).where("type", "=", "APPEAL_DECIDED").execute()).toHaveLength(1);
    const restore = await db.selectFrom("moderation_actions").select(["action", "actor_id"]).where("case_id", "=", caseId).where("action", "=", "RESTORE").executeTakeFirstOrThrow();
    expect(restore.actor_id).toBe(mod2.id);

    expect((await as(mod2).post(`/api/moderation/appeals/${a.body.id}/decide`).send({ status: "UPHELD" }).expect(409)).body.code).toBe("APPEAL_DECIDED");
    const mine = await as(author).get("/api/moderation/me").expect(200);
    expect(mine.body.items.find((c: { id: string }) => c.id === caseId).appeal).toMatchObject({ status: "OVERTURNED" });
  });

  test("UPHELD leaves the decision in place", async () => {
    const { author, postId, caseId } = await decided(await createUser({ role: "MODERATOR" }), "HIDE");
    const a = await appeal(author, caseId).expect(201);
    await as(await createUser({ role: "ADMIN" })).post(`/api/moderation/appeals/${a.body.id}/decide`).send({ status: "UPHELD" }).expect(200);
    expect((await postStatus(postId)).status).toBe("HIDDEN");
  });

  test("an admin may decide an appeal on their own call only with a written note", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const { author, caseId } = await decided(admin);
    const a = await appeal(author, caseId).expect(201);
    expect((await as(admin).post(`/api/moderation/appeals/${a.body.id}/decide`).send({ status: "UPHELD" }).expect(403)).body.code).toBe("APPEAL_CONFLICT");
    await as(admin).post(`/api/moderation/appeals/${a.body.id}/decide`).send({ status: "UPHELD", note: "Only admin on duty; reviewed twice." }).expect(200);
  });

  test("only the author, only appealable resolutions, only within 30 days", async () => {
    const mod = await createUser({ role: "MODERATOR" });
    const dismissed = await decided(mod, "DISMISS");
    expect((await appeal(dismissed.author, dismissed.caseId).expect(400)).body.code).toBe("NOT_APPEALABLE");

    const removed = await decided(mod);
    await appeal(await createUser(), removed.caseId).expect(404);
    await appeal(removed.author, removed.caseId, "short").expect(400);
    await db.updateTable("moderation_cases").set({ resolved_at: new Date(Date.now() - 31 * 86400_000) }).where("id", "=", removed.caseId).execute();
    expect((await appeal(removed.author, removed.caseId).expect(400)).body.code).toBe("APPEAL_WINDOW_CLOSED");

    // An OPEN case nobody acted on yet is not appealable.
    const open = await reportedPost();
    expect((await appeal(open.author, open.caseId).expect(400)).body.code).toBe("NOT_APPEALABLE");
  });

  test("an automatically hidden post can be appealed at once; overturning settles the open case", async () => {
    await setSettings({ moderation: { provider: "rules", blockedTerms: ["glorpwick"] } });
    const author = await createUser();
    const pid = await post(author, "A glorpwick is a word from a game, nothing more.");
    expect((await postStatus(pid)).status).toBe("HIDDEN");
    const kase = (await openCaseOf("POST", pid))!;
    expect(kase.status).toBe("OPEN");
    const a = await appeal(author, kase.id).expect(201);
    await as(await createUser({ role: "MODERATOR" })).post(`/api/moderation/appeals/${a.body.id}/decide`).send({ status: "OVERTURNED" }).expect(200);
    expect((await postStatus(pid)).status).toBe("PUBLISHED");
    expect(await db.selectFrom("moderation_cases").select(["status", "resolution"]).where("id", "=", kase.id).executeTakeFirstOrThrow()).toEqual({ status: "RESOLVED", resolution: "RESTORE" });
  });

  test("a suspended author can appeal, and overturning lifts the suspension", async () => {
    const { author, caseId } = await decided(await createUser({ role: "MODERATOR" }), "SUSPEND");
    expect(await userStatus(author.id)).toBe("SUSPENDED");
    const a = await appeal(author, caseId, "I was hacked that evening, sorry.").expect(201);
    await as(await createUser({ role: "MODERATOR" })).post(`/api/moderation/appeals/${a.body.id}/decide`).send({ status: "OVERTURNED" }).expect(200);
    expect(await db.selectFrom("users").select(["status", "suspended_until"]).where("id", "=", author.id).executeTakeFirstOrThrow()).toEqual({ status: "ACTIVE", suspended_until: null });
  });

  test("a later decision about the account stands even when the appeal is overturned", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const { author, caseId } = await decided(await createUser({ role: "MODERATOR" }), "SUSPEND");
    const a = await appeal(author, caseId).expect(201);
    await as(admin).post(`/api/admin/users/${author.id}/ban`).send({ reason: "Separate spam ring" }).expect(200);
    await as(await createUser({ role: "MODERATOR" })).post(`/api/moderation/appeals/${a.body.id}/decide`).send({ status: "OVERTURNED" }).expect(200);
    expect(await userStatus(author.id)).toBe("BANNED");
    const note = await db.selectFrom("notifications").select("snippet").where("recipient_id", "=", author.id).where("type", "=", "APPEAL_DECIDED").executeTakeFirstOrThrow();
    expect(note.snippet).toContain("later decision");
  });

  test("overturning a hidden profile returns it as UNLISTED, for its owner to republish", async () => {
    const talent = await makeProfile();
    const profileId = await profileIdOf(talent.id);
    await report(await createUser(), "PROFILE", profileId, "FAKE_PROFILE");
    const kase = (await openCaseOf("PROFILE", profileId))!;
    await act(await createUser({ role: "MODERATOR" }), kase.id, { action: "HIDE" });
    expect(await profileStatus(talent.id)).toBe("SUSPENDED");
    const a = await appeal(talent, kase.id).expect(201);
    await as(await createUser({ role: "MODERATOR" })).post(`/api/moderation/appeals/${a.body.id}/decide`).send({ status: "OVERTURNED" }).expect(200);
    expect(await profileStatus(talent.id)).toBe("UNLISTED");
  });

  test("members and recruiter ops cannot list or decide appeals", async () => {
    const { author, caseId } = await decided(await createUser({ role: "MODERATOR" }));
    const a = await appeal(author, caseId).expect(201);
    for (const u of [await createUser(), await createUser({ role: "RECRUITER_OPS" })]) {
      await as(u).get("/api/moderation/appeals").expect(403);
      await as(u).post(`/api/moderation/appeals/${a.body.id}/decide`).send({ status: "OVERTURNED" }).expect(403);
    }
    await as(author).post(`/api/moderation/appeals/${a.body.id}/decide`).send({ status: "OVERTURNED" }).expect(403);
  });
});
