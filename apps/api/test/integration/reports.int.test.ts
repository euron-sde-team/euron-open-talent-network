import { describe, expect, test } from "vitest";
import { db } from "../../src/db/kysely";
import { rooms } from "../../src/realtime/port";
import { as, createUser, recordRealtime } from "./harness";
import { comment, daysAgo, dmMessage, established, openCaseOf, post, postStatus, profileIdOf, profileStatus, report, userStatus } from "./moderation-fixtures";
import { approach, block, makeCompanyRecruiter, makeJob, makeProfile } from "./talent-fixtures";

const rt = recordRealtime();
const MISSING = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

describe("filing reports", () => {
  test("a report opens a REPORT case; the same reporter twice is 409 ALREADY_REPORTED", async () => {
    const author = await createUser();
    const reporter = await established();
    const pid = await post(author);
    const res = await as(reporter).post("/api/reports").send({ targetType: "POST", targetId: pid, reason: "SPAM", details: "selling things" }).expect(201);
    expect(res.body.id).toEqual(expect.any(String));
    expect(await openCaseOf("POST", pid)).toMatchObject({ source: "REPORT", report_count: 1, priority: 10, author_id: author.id, status: "OPEN" });
    const dup = await as(reporter).post("/api/reports").send({ targetType: "POST", targetId: pid, reason: "HATE" }).expect(409);
    expect(dup.body.code).toBe("ALREADY_REPORTED");
  });

  test("reports from different people join one case and each one raises its priority", async () => {
    const author = await createUser();
    const pid = await post(author);
    await report(await createUser(), "POST", pid, "SPAM");
    await report(await createUser(), "POST", pid, "HARASSMENT");
    const cases = await db.selectFrom("moderation_cases").selectAll().where("target_id", "=", pid).execute();
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({ report_count: 2, priority: 20 });
    const mod = await createUser({ role: "MODERATOR" });
    const detail = await as(mod).get(`/api/moderation/cases/${cases[0]!.id}`).expect(200);
    expect(detail.body.reasons).toEqual(expect.arrayContaining([{ reason: "SPAM", count: 1 }, { reason: "HARASSMENT", count: 1 }]));
  });

  test("every talent target type can be reported by someone who can see it", async () => {
    const author = await createUser();
    const reader = await createUser();
    const pid = await post(author);
    await report(reader, "POST", pid);
    await report(reader, "COMMENT", await comment(author, pid));
    const { messageId } = await dmMessage(author, reader, "a message that the recipient finds rude");
    await report(reader, "DM_MESSAGE", messageId, "HARASSMENT");
    await report(reader, "USER", author.id, "IMPERSONATION");

    const talent = await makeProfile();
    await report(reader, "PROFILE", await profileIdOf(talent.id), "FAKE_PROFILE");

    const rec = await makeCompanyRecruiter();
    await report(reader, "COMPANY", rec.company.id, "SCAM");
    const job = await makeJob(rec);
    await report(reader, "JOB", job.id, "SCAM");
    const a = await approach(rec, talent);
    await report(talent, "APPROACH", a.id, "SPAM");

    for (const [type, id] of [
      ["COMPANY", rec.company.id],
      ["JOB", job.id],
      ["APPROACH", a.id],
    ] as const) {
      expect(await openCaseOf(type, id)).toMatchObject({ source: "REPORT", author_id: rec.id });
    }
    expect(await openCaseOf("PROFILE", await profileIdOf(talent.id))).toMatchObject({ author_id: talent.id });
  });

  test("you cannot report yourself or your own content", async () => {
    const u = await createUser();
    const pid = await post(u);
    expect((await as(u).post("/api/reports").send({ targetType: "POST", targetId: pid, reason: "SPAM" }).expect(400)).body.code).toBe("CANNOT_REPORT_SELF");
    expect((await as(u).post("/api/reports").send({ targetType: "USER", targetId: u.id, reason: "SPAM" }).expect(400)).body.code).toBe("CANNOT_REPORT_SELF");
    const talent = await makeProfile();
    expect((await as(talent).post("/api/reports").send({ targetType: "PROFILE", targetId: await profileIdOf(talent.id), reason: "SPAM" }).expect(400)).body.code).toBe("CANNOT_REPORT_SELF");
  });

  test("what you cannot see is a 404: connections-only posts, blocks, other people's DMs and approaches, drafts, missing ids", async () => {
    const owner = await createUser();
    const outsider = await createUser();
    const hidden = await post(owner, "Only for my connections.", { visibility: "CONNECTIONS" });
    expect((await as(outsider).post("/api/reports").send({ targetType: "POST", targetId: hidden, reason: "SPAM" }).expect(404)).body.code).toBe("TARGET_NOT_FOUND");

    const visible = await post(owner);
    await block(owner, outsider);
    await as(outsider).post("/api/reports").send({ targetType: "POST", targetId: visible, reason: "SPAM" }).expect(404);
    await as(outsider).post("/api/reports").send({ targetType: "USER", targetId: owner.id, reason: "SPAM" }).expect(404);

    const third = await createUser();
    const { messageId } = await dmMessage(owner, await createUser(), "private words between two people");
    await as(third).post("/api/reports").send({ targetType: "DM_MESSAGE", targetId: messageId, reason: "HARASSMENT" }).expect(404);

    const rec = await makeCompanyRecruiter();
    const talent = await makeProfile();
    const a = await approach(rec, talent);
    await as(third).post("/api/reports").send({ targetType: "APPROACH", targetId: a.id, reason: "SPAM" }).expect(404);
    const draftJob = await makeJob(rec, { publish: false });
    await as(third).post("/api/reports").send({ targetType: "JOB", targetId: draftJob.id, reason: "SPAM" }).expect(404);

    const draft = await makeProfile({ status: "DRAFT" });
    await as(third).post("/api/reports").send({ targetType: "PROFILE", targetId: await profileIdOf(draft.id), reason: "SPAM" }).expect(404);
    await as(third).post("/api/reports").send({ targetType: "POST", targetId: MISSING, reason: "SPAM" }).expect(404);
  });

  test("bad input is a 400; signed out is a 401; suspended accounts cannot report", async () => {
    const u = await createUser();
    await as(u).post("/api/reports").send({ targetType: "POST", targetId: "nope", reason: "SPAM" }).expect(400);
    await as(u).post("/api/reports").send({ targetType: "COMMUNITY", targetId: MISSING, reason: "SPAM" }).expect(400);
    await as(u).post("/api/reports").send({ targetType: "POST", targetId: MISSING, reason: "BORED" }).expect(400);
    await as(null).post("/api/reports").send({}).expect(401);
    const pid = await post(await createUser());
    const res = await as(await createUser({ status: "SUSPENDED" })).post("/api/reports").send({ targetType: "POST", targetId: pid, reason: "SPAM" }).expect(403);
    expect(res.body.code).toBe("ACCOUNT_RESTRICTED");
  });
});

describe("report auto-hide", () => {
  test("three established reporters hide the post pending review; reporters never reach the author", async () => {
    const author = await createUser();
    const pid = await post(author);
    const before = (await db.selectFrom("users").select("post_count").where("id", "=", author.id).executeTakeFirstOrThrow()).post_count;
    for (let i = 0; i < 2; i++) await report(await established(), "POST", pid, "HATE");
    expect((await postStatus(pid)).status).toBe("PUBLISHED");
    rt.clear();
    await report(await established(), "POST", pid, "HATE");
    expect((await postStatus(pid)).status).toBe("HIDDEN");
    expect((await db.selectFrom("users").select("post_count").where("id", "=", author.id).executeTakeFirstOrThrow()).post_count).toBe(before - 1);
    expect(rt.to(rooms.post(pid), "post:removed")).toHaveLength(1);
    expect(rt.emits.some((e) => e.event === "moderation:queue" && e.rooms.includes(rooms.staff))).toBe(true);

    const kase = (await openCaseOf("POST", pid))!;
    expect(kase).toMatchObject({ status: "OPEN", report_count: 3, priority: 30 });
    expect(await db.selectFrom("moderation_actions").selectAll().where("case_id", "=", kase.id).executeTakeFirstOrThrow()).toMatchObject({ action: "HIDE", actor_id: null });
    const notes = await db.selectFrom("notifications").select(["type", "actor_id"]).where("recipient_id", "=", author.id).where("type", "=", "MODERATION_ACTION").execute();
    expect(notes).toEqual([{ type: "MODERATION_ACTION", actor_id: null }]);

    const mine = await as(author).get("/api/moderation/me").expect(200);
    expect(mine.body.items[0]).toMatchObject({ id: kase.id, reportCount: 3, targetStatus: "HIDDEN", aiScores: null, resolvedBy: null });
    const text = JSON.stringify(mine.body);
    const reporters = await db.selectFrom("reports").select("reporter_id").where("case_id", "=", kase.id).execute();
    expect(reporters).toHaveLength(3);
    for (const r of reporters) expect(text).not.toContain(r.reporter_id);
    // Staff do not see reporters either: only reasons and counts.
    const staffView = JSON.stringify((await as(await createUser({ role: "MODERATOR" })).get(`/api/moderation/cases/${kase.id}`).expect(200)).body);
    for (const r of reporters) expect(staffView).not.toContain(r.reporter_id);
  });

  test("brand-new accounts and suspended reporters do not count toward the threshold", async () => {
    const pid = await post(await createUser());
    for (let i = 0; i < 4; i++) await report(await createUser(), "POST", pid);
    expect((await postStatus(pid)).status).toBe("PUBLISHED");

    const pid2 = await post(await createUser());
    const reporters = [await established(), await established()];
    for (const r of reporters) await report(r, "POST", pid2);
    await db.updateTable("users").set({ status: "SUSPENDED" }).where("id", "=", reporters[0]!.id).execute();
    await report(await established(), "POST", pid2);
    expect((await postStatus(pid2)).status).toBe("PUBLISHED");
  });

  test("comments and jobs hide too; profiles, accounts and company pages never do", async () => {
    const author = await createUser();
    const pid = await post(author);
    const cid = await comment(author, pid);
    for (let i = 0; i < 3; i++) await report(await established(), "COMMENT", cid);
    expect((await db.selectFrom("comments").select("status").where("id", "=", cid).executeTakeFirstOrThrow()).status).toBe("HIDDEN");

    const rec = await makeCompanyRecruiter();
    const job = await makeJob(rec);
    for (let i = 0; i < 3; i++) await report(await established(), "JOB", job.id, "SCAM");
    expect((await db.selectFrom("jobs").select("content_status").where("id", "=", job.id).executeTakeFirstOrThrow()).content_status).toBe("HIDDEN");
    for (let i = 0; i < 3; i++) await report(await established(), "COMPANY", rec.company.id, "SCAM");
    expect((await db.selectFrom("companies").select("status").where("id", "=", rec.company.id).executeTakeFirstOrThrow()).status).not.toBe("SUSPENDED");

    const talent = await makeProfile();
    const profileId = await profileIdOf(talent.id);
    for (let i = 0; i < 3; i++) await report(await established(), "PROFILE", profileId, "FAKE_PROFILE");
    expect(await profileStatus(talent.id)).toBe("PUBLISHED");
    for (let i = 0; i < 3; i++) await report(await established(), "USER", talent.id, "IMPERSONATION");
    expect(await userStatus(talent.id)).toBe("ACTIVE");
    expect(await openCaseOf("USER", talent.id)).toMatchObject({ author_id: talent.id, report_count: 3 });
  });

  test("staff content is never auto-hidden (it still gets a case)", async () => {
    const mod = await createUser({ role: "MODERATOR" });
    const pid = await post(mod);
    for (let i = 0; i < 3; i++) await report(await established(), "POST", pid);
    expect((await postStatus(pid)).status).toBe("PUBLISHED");
    expect(await openCaseOf("POST", pid)).toMatchObject({ report_count: 3, status: "OPEN" });
  });

  test("after a moderator restores, only reports on the new case count", async () => {
    const author = await createUser();
    const pid = await post(author);
    for (let i = 0; i < 3; i++) await report(await established(), "POST", pid);
    const kase = (await openCaseOf("POST", pid))!;
    await as(await createUser({ role: "MODERATOR" })).post(`/api/moderation/cases/${kase.id}/actions`).send({ action: "RESTORE" }).expect(200);
    expect((await postStatus(pid)).status).toBe("PUBLISHED");
    await report(await established(), "POST", pid);
    expect((await postStatus(pid)).status).toBe("PUBLISHED");
    const reopened = (await openCaseOf("POST", pid))!;
    expect(reopened.id).not.toBe(kase.id);
    expect(reopened.report_count).toBe(1);
  });

  test("the priority is capped", async () => {
    const pid = await post(await createUser());
    await report(await createUser(), "POST", pid);
    const kase = (await openCaseOf("POST", pid))!;
    await db.updateTable("moderation_cases").set({ priority: 995 }).where("id", "=", kase.id).execute();
    await report(await createUser({ createdAt: daysAgo(0) }), "POST", pid);
    expect((await openCaseOf("POST", pid))!.priority).toBe(1000);
  });
});
