import { afterEach, describe, expect, test } from "vitest";
import { db } from "../../src/db/kysely";
import { rooms } from "../../src/realtime/port";
import { anon, as, createUser, recordRealtime } from "./harness";
import { act, comment, openCaseOf, post, postStatus, profileIdOf, profileStatus, report, reportedPost, userStatus } from "./moderation-fixtures";
import { acceptedApproach, allPages, approach, makeCompanyRecruiter, makeJob, makeProfile, resetSettings, setSettings } from "./talent-fixtures";

const rt = recordRealtime();
const TERM = "zorblax";

/** The rules provider (pinned in settings, whatever MODERATION_PROVIDER the matrix row uses) scores harassment 0.9 for a blocked term: HIDE by default, REVIEW when hide is raised. */
async function blockTerm(mode: "HIDE" | "REVIEW" = "HIDE") {
  await setSettings({ moderation: { provider: "rules", blockedTerms: [TERM], ...(mode === "REVIEW" ? { thresholds: { harassment: { review: 0.5, hide: 0.95 } } } : {}) } });
}

afterEach(resetSettings);

describe("the scan pipeline (rules provider)", () => {
  test("a post with a blocked term is hidden at once: FLAGGED, an AI case, a HIDE with no actor, the author told", async () => {
    await blockTerm();
    const author = await createUser();
    rt.clear();
    const pid = await post(author, `Honestly this is ${TERM} behaviour.`);
    expect(await postStatus(pid)).toEqual({ status: "HIDDEN", moderation_state: "FLAGGED" });
    const kase = (await openCaseOf("POST", pid))!;
    expect(kase).toMatchObject({ source: "AI", status: "OPEN", ai_provider: "rules", ai_categories: ["harassment"], priority: 90 });
    expect(await db.selectFrom("moderation_actions").select(["action", "actor_id"]).where("case_id", "=", kase.id).execute()).toEqual([{ action: "HIDE", actor_id: null }]);
    const note = await db.selectFrom("notifications").select("snippet").where("recipient_id", "=", author.id).where("type", "=", "MODERATION_ACTION").executeTakeFirstOrThrow();
    expect(note.snippet).toContain("You can appeal");
    expect(rt.to(rooms.post(pid), "post:removed")).toHaveLength(1);
    await anon().get(`/api/posts/${pid}`).expect(404);
  });

  test("a score between review and hide queues the post and leaves it visible", async () => {
    await blockTerm("REVIEW");
    const pid = await post(await createUser(), `Mildly ${TERM} but fine.`);
    expect(await postStatus(pid)).toEqual({ status: "PUBLISHED", moderation_state: "REVIEW" });
    expect(await openCaseOf("POST", pid)).toMatchObject({ source: "AI", status: "OPEN" });
    await anon().get(`/api/posts/${pid}`).expect(200);
  });

  test("clean content is CLEAN with no case; with moderation off nothing is scanned", async () => {
    const pid = await post(await createUser(), "A perfectly ordinary update.");
    expect(await postStatus(pid)).toEqual({ status: "PUBLISHED", moderation_state: "CLEAN" });
    expect(await openCaseOf("POST", pid)).toBeUndefined();

    await setSettings({ moderation: { enabled: false, provider: "rules", blockedTerms: [TERM] } });
    const off = await post(await createUser(), `Still ${TERM} but nobody looks.`);
    expect(await postStatus(off)).toEqual({ status: "PUBLISHED", moderation_state: "UNCHECKED" });
  });

  test("comments are scanned the same way", async () => {
    await blockTerm();
    const pid = await post(await createUser());
    const cid = await comment(await createUser(), pid, `What a ${TERM} take.`);
    expect((await db.selectFrom("comments").select(["status", "moderation_state"]).where("id", "=", cid).executeTakeFirstOrThrow())).toEqual({ status: "HIDDEN", moderation_state: "FLAGGED" });
  });

  test("staff content is never hidden automatically: a REVIEW case instead", async () => {
    await blockTerm();
    const pid = await post(await createUser({ role: "MODERATOR" }), `A quoted ${TERM} for the record.`);
    expect((await postStatus(pid)).status).toBe("PUBLISHED");
    expect(await openCaseOf("POST", pid)).toMatchObject({ source: "AI", status: "OPEN" });
  });

  test("a profile is never taken down by the classifier: the edit opens a case, the profile stays published", async () => {
    const talent = await makeProfile();
    await blockTerm();
    await as(talent).patch("/api/profiles/me").send({ headline: `The most ${TERM} engineer around` }).expect(200);
    expect(await profileStatus(talent.id)).toBe("PUBLISHED");
    expect(await openCaseOf("PROFILE", await profileIdOf(talent.id))).toMatchObject({ source: "AI", status: "OPEN", author_id: talent.id });
    await anon().get(`/api/profiles/${talent.username}`).expect(200);
  });

  test("a job with a blocked term is hidden: off the public page and out of the open-job count", async () => {
    const rec = await makeCompanyRecruiter();
    await blockTerm();
    const job = await makeJob(rec, { description: `Join a ${TERM} team and build calm services with us, every day.` });
    expect(await db.selectFrom("jobs").select(["content_status", "moderation_state"]).where("id", "=", job.id).executeTakeFirstOrThrow()).toEqual({ content_status: "HIDDEN", moderation_state: "FLAGGED" });
    await anon().get(`/api/jobs/${job.id}`).expect(404);
    expect((await db.selectFrom("companies").select("open_job_count").where("id", "=", rec.company.id).executeTakeFirstOrThrow()).open_job_count).toBe(0);
    // The team still sees it, and cannot reopen it while it is under review.
    await as(rec).get(`/api/jobs/${job.id}`).expect(200);
  });

  test("an approach with a blocked term is withdrawn and never reaches the candidate", async () => {
    const rec = await makeCompanyRecruiter();
    const talent = await makeProfile();
    await blockTerm();
    const a = await approach(rec, talent, { message: `We think you are ${TERM} and would love to talk about a role with our team.` });
    expect(await db.selectFrom("approaches").select(["status", "moderation_state"]).where("id", "=", a.id).executeTakeFirstOrThrow()).toEqual({ status: "WITHDRAWN", moderation_state: "FLAGGED" });
    const received = await as(talent).get("/api/approaches/received").expect(200);
    expect(received.body.items.map((x: { id: string }) => x.id)).not.toContain(a.id);
    await as(talent).get(`/api/approaches/${a.id}`).expect(404);
  });
});

describe("the case queue", () => {
  test("staff only; open cases sort by priority, then oldest first", async () => {
    await as(await createUser()).get("/api/moderation/cases").expect(403);
    const mod = await createUser({ role: "MODERATOR" });
    const low = await reportedPost();
    const high = await reportedPost();
    await report(await createUser(), "POST", high.postId, "SPAM");
    await report(await createUser(), "POST", high.postId, "SPAM");
    const older = await reportedPost();
    const items = await allPages((c) => as(mod).get(`/api/moderation/cases?limit=50${c ? `&cursor=${c}` : ""}`).then((r) => r.body));
    const ids = items.map((i: { id: string }) => i.id);
    expect(ids.indexOf(high.caseId)).toBeLessThan(ids.indexOf(low.caseId));
    expect(ids.indexOf(low.caseId)).toBeLessThan(ids.indexOf(older.caseId));
    for (let i = 1; i < items.length; i++) expect(items[i - 1].priority).toBeGreaterThanOrEqual(items[i].priority);

    const filtered = await as(mod).get("/api/moderation/cases?source=REPORT&targetType=POST&limit=50").expect(200);
    expect(filtered.body.items.every((c: { source: string; targetType: string }) => c.source === "REPORT" && c.targetType === "POST")).toBe(true);
    await as(mod).get("/api/moderation/cases?cursor=garbage").expect(400);
  });

  test("case detail: full view for staff, author view for the author, 404 for everyone else", async () => {
    await blockTerm("REVIEW");
    const author = await createUser();
    const pid = await post(author, `A slightly ${TERM} remark.`);
    const kase = (await openCaseOf("POST", pid))!;
    const mod = await createUser({ role: "MODERATOR" });
    const full = await as(mod).get(`/api/moderation/cases/${kase.id}`).expect(200);
    expect(full.body).toMatchObject({ id: kase.id, targetType: "POST", targetId: pid, source: "AI", aiScores: { harassment: 0.9 }, aiCategories: ["harassment"], targetStatus: "PUBLISHED", author: { id: author.id } });
    expect(full.body.snapshot.body).toContain(TERM);
    await as(mod).post(`/api/moderation/cases/${kase.id}/assign`).send({ userId: mod.id }).expect(200);
    expect((await as(mod).get(`/api/moderation/cases/${kase.id}`).expect(200)).body.assignedTo).toMatchObject({ id: mod.id });
    // The author never learns which moderator holds their case.
    const own = await as(author).get(`/api/moderation/cases/${kase.id}`).expect(200);
    expect(own.body).toMatchObject({ id: kase.id, aiScores: null, aiCategories: ["harassment"], resolvedBy: null, assignedTo: null });
    expect(JSON.stringify(own.body)).not.toContain(mod.id);
    await as(await createUser()).get(`/api/moderation/cases/${kase.id}`).expect(404);
  });

  test("assign to staff or nobody; never to a member", async () => {
    const { caseId } = await reportedPost();
    const mod = await createUser({ role: "MODERATOR" });
    const other = await createUser({ role: "ADMIN" });
    expect((await as(mod).get(`/api/moderation/cases/${caseId}`).expect(200)).body.assignedTo).toBeNull();
    const res = await as(mod).post(`/api/moderation/cases/${caseId}/assign`).send({ userId: other.id }).expect(200);
    expect(res.body.id).toBe(caseId);
    expect(res.body.assignedTo).toMatchObject({ id: other.id, username: other.username, displayName: other.displayName });
    expect((await db.selectFrom("moderation_cases").select("assigned_to").where("id", "=", caseId).executeTakeFirstOrThrow()).assigned_to).toBe(other.id);
    // The detail and the queue rows say who holds it.
    expect((await as(mod).get(`/api/moderation/cases/${caseId}`).expect(200)).body.assignedTo.id).toBe(other.id);
    const queue = await allPages((c) => as(mod).get(`/api/moderation/cases?limit=50${c ? `&cursor=${c}` : ""}`).then((r) => r.body));
    expect(queue.find((c: { id: string }) => c.id === caseId).assignedTo.id).toBe(other.id);
    expect((await as(mod).post(`/api/moderation/cases/${caseId}/assign`).send({ userId: (await createUser()).id }).expect(400)).body.code).toBe("ASSIGNEE_NOT_STAFF");
    expect((await as(mod).post(`/api/moderation/cases/${caseId}/assign`).send({ userId: mod.id }).expect(200)).body.assignedTo.id).toBe(mod.id);
    expect((await as(mod).post(`/api/moderation/cases/${caseId}/assign`).send({ userId: null }).expect(200)).body.assignedTo).toBeNull();
    await as(await createUser()).post(`/api/moderation/cases/${caseId}/assign`).send({ userId: null }).expect(403);
  });

  test("stats count the queue", async () => {
    await reportedPost();
    const res = await as(await createUser({ role: "MODERATOR" })).get("/api/moderation/stats").expect(200);
    expect(res.body).toEqual({ openCases: expect.any(Number), openAppeals: expect.any(Number), actionsToday: expect.any(Number), autoHiddenToday: expect.any(Number) });
    expect(res.body.openCases).toBeGreaterThan(0);
    await as(await createUser()).get("/api/moderation/stats").expect(403);
  });
});

describe("case actions", () => {
  test("HIDE, then the case is resolved and a second action is 409 CASE_RESOLVED", async () => {
    const mod = await createUser({ role: "MODERATOR" });
    const { author, postId, caseId } = await reportedPost();
    const out = await act(mod, caseId, { action: "HIDE", reason: "Insulting" });
    expect(out).toMatchObject({ status: "RESOLVED", resolution: "HIDE", resolvedBy: { id: mod.id } });
    expect((await postStatus(postId)).status).toBe("HIDDEN");
    const note = await db.selectFrom("notifications").select(["snippet", "actor_id"]).where("recipient_id", "=", author.id).where("type", "=", "MODERATION_ACTION").executeTakeFirstOrThrow();
    expect(note).toEqual({ snippet: "Your post was hidden by a moderator: Insulting", actor_id: null });
    expect((await act(mod, caseId, { action: "RESTORE" }, 409)).code).toBe("CASE_RESOLVED");
    const audit = await db.selectFrom("audit_log").select(["actor_id", "action"]).where("entity_id", "=", postId).where("action", "=", "moderation.hide").executeTakeFirstOrThrow();
    expect(audit.actor_id).toBe(mod.id);
  });

  test("REMOVE and RESTORE move the content; impossible transitions are 409", async () => {
    const mod = await createUser({ role: "MODERATOR" });
    const a = await reportedPost();
    await act(mod, a.caseId, { action: "REMOVE" });
    expect((await postStatus(a.postId)).status).toBe("REMOVED");
    const reopened = await report(await createUser(), "POST", a.postId, "SPAM", 404);
    expect(reopened.code).toBe("TARGET_NOT_FOUND");

    const b = await reportedPost();
    await db.updateTable("posts").set({ status: "DELETED" }).where("id", "=", b.postId).execute();
    expect((await act(mod, b.caseId, { action: "RESTORE" }, 409)).code).toBe("INVALID_TRANSITION");

    const c = await reportedPost();
    await act(mod, c.caseId, { action: "DISMISS" });
    expect((await postStatus(c.postId)).status).toBe("PUBLISHED");
  });

  test("WARN and SUSPEND act on the author's account; SUSPEND needs days and disconnects them", async () => {
    const mod = await createUser({ role: "MODERATOR" });
    const w = await reportedPost();
    await act(mod, w.caseId, { action: "WARN", reason: "Keep it civil" });
    expect(await userStatus(w.author.id)).toBe("ACTIVE");
    expect((await db.selectFrom("notifications").select("snippet").where("recipient_id", "=", w.author.id).where("type", "=", "MODERATION_ACTION").executeTakeFirstOrThrow()).snippet).toContain("warning");

    const s = await reportedPost();
    expect((await act(mod, s.caseId, { action: "SUSPEND" }, 400)).code).toBe("SUSPEND_DAYS_REQUIRED");
    rt.clear();
    await act(mod, s.caseId, { action: "SUSPEND", suspendDays: 3, reason: "Repeated insults" });
    expect(await userStatus(s.author.id)).toBe("SUSPENDED");
    expect(rt.disconnects).toEqual([{ userIds: [s.author.id], reason: "SUSPENDED" }]);
    // A suspended member can read but not post.
    expect((await as(s.author).post("/api/posts").send({ body: "Back again" }).expect(403)).body.code).toBe("ACCOUNT_RESTRICTED");
  });

  test("BAN is for admins only; it revokes sessions", async () => {
    const mod = await createUser({ role: "MODERATOR" });
    const admin = await createUser({ role: "ADMIN" });
    const { author, caseId } = await reportedPost();
    expect((await act(mod, caseId, { action: "BAN" }, 403)).code).toBe("STAFF_ONLY");
    await act(admin, caseId, { action: "BAN", reason: "Spam ring" });
    expect(await userStatus(author.id)).toBe("BANNED");
    await as(author).get("/api/users/me").expect(401);
  });

  test("moderators cannot act on their own content or on other moderators; members cannot act at all", async () => {
    const mod = await createUser({ role: "MODERATOR" });
    const own = await post(mod);
    await report(await createUser(), "POST", own);
    const ownCase = (await openCaseOf("POST", own))!;
    expect((await act(mod, ownCase.id, { action: "RESTORE" }, 403)).code).toBe("SELF_MODERATION");

    expect((await act(await createUser({ role: "MODERATOR" }), ownCase.id, { action: "SUSPEND", suspendDays: 1 }, 403)).code).toBe("TARGET_PROTECTED");
    expect((await act(await createUser(), ownCase.id, { action: "DISMISS" }, 404)).code).toBe("CASE_NOT_FOUND");
    expect((await act(await createUser({ role: "RECRUITER_OPS" }), ownCase.id, { action: "DISMISS" }, 404)).code).toBe("CASE_NOT_FOUND");
    expect((await act(await createUser({ role: "MODERATOR", status: "SUSPENDED" }), ownCase.id, { action: "DISMISS" }, 403)).code).toBe("ACCOUNT_RESTRICTED");
  });

  test("hiding a profile suspends it and ends every contact unlock", async () => {
    const { candidate, approach: a } = await acceptedApproach(["EMAIL"]);
    const profileId = await profileIdOf(candidate.id);
    await report(await createUser(), "PROFILE", profileId, "FAKE_PROFILE");
    const kase = (await openCaseOf("PROFILE", profileId))!;
    const mod = await createUser({ role: "MODERATOR" });
    await act(mod, kase.id, { action: "HIDE" });
    expect(await profileStatus(candidate.id)).toBe("SUSPENDED");
    expect((await db.selectFrom("contact_unlocks").select("revoked_at").where("approach_id", "=", a.id).executeTakeFirstOrThrow()).revoked_at).not.toBeNull();
    await anon().get(`/api/profiles/${candidate.username}`).expect(404);

    // The owner sees the case in the author view (and can appeal it: appeals.int.test.ts restores to UNLISTED).
    const mine = await as(candidate).get("/api/moderation/me").expect(200);
    expect(mine.body.items.find((c: { id: string }) => c.id === kase.id)).toMatchObject({ targetStatus: "SUSPENDED", resolution: "HIDE", resolvedBy: null });
  });

  test("history lists every action on a target, staff only", async () => {
    const mod = await createUser({ role: "MODERATOR" });
    const { postId, caseId } = await reportedPost();
    await act(mod, caseId, { action: "HIDE", reason: "First look" });
    const res = await as(mod).get(`/api/moderation/history?targetType=POST&targetId=${postId}`).expect(200);
    expect(res.body).toEqual([expect.objectContaining({ action: "HIDE", targetType: "POST", targetId: postId, reason: "First look", actor: expect.objectContaining({ id: mod.id }), caseId })]);
    await as(await createUser()).get(`/api/moderation/history?targetType=POST&targetId=${postId}`).expect(403);
  });

  test("/moderation/me lists cases about your content and account, in the author view", async () => {
    const author = await createUser();
    const pid = await post(author);
    await report(await createUser(), "POST", pid);
    await report(await createUser(), "USER", author.id, "SPAM");
    const res = await as(author).get("/api/moderation/me").expect(200);
    expect(res.body.items.map((c: { targetType: string }) => c.targetType).sort()).toEqual(["POST", "USER"]);
    for (const c of res.body.items) expect(c.aiScores).toBeNull();
    expect((await as(await createUser()).get("/api/moderation/me").expect(200)).body.items).toEqual([]);
  });
});
