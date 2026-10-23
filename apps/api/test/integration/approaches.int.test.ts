/**
 * Approaches: a recruiter's structured outreach, consent-based per-channel contact
 * unlock, the access log the candidate sees, revoking, declining with a cooldown,
 * blocking, withdrawing, quotas and expiry.
 */
import { afterEach, describe, expect, test } from "vitest";
import type { Approach } from "@open-talent/types";
import { db } from "../../src/db/kysely";
import { as, createUser, recordRealtime } from "./harness";
import { acceptedApproach, APPROACH_MESSAGE, approach, makeCompanyRecruiter, makeJob, makeProfile, notificationsOf, resetSettings, setSettings, teammate, uniquePhone, waitFor } from "./talent-fixtures";

afterEach(resetSettings);

const send = (r: Parameters<typeof as>[0], body: Record<string, unknown>) => as(r).post("/api/approaches").send({ roleTitle: "Platform Engineer", message: APPROACH_MESSAGE, ...body });

describe("sending", () => {
  test("a PENDING approach reaches the candidate's list, a notification and their socket room", async () => {
    const r = await makeCompanyRecruiter();
    const cand = await makeProfile();
    const live = recordRealtime();
    const a = await approach(r, cand, { employmentType: "FULL_TIME", salary: { min: 90000, max: 120000, currency: "eur", period: "YEAR" } });
    expect(a).toMatchObject({ status: "PENDING", roleTitle: "Platform Engineer", employmentType: "FULL_TIME", salary: { min: 90000, max: 120000, currency: "EUR", period: "YEAR" }, unlockedChannels: [], threadId: null });
    expect(a.company.id).toBe(r.company.id);
    expect(a.recruiter.id).toBe(r.id);
    const received = (await as(cand).get("/api/approaches/received").expect(200)).body.items as Approach[];
    expect(received.map((x) => x.id)).toEqual([a.id]);
    expect((await as(r).get("/api/approaches/sent").query({ status: "PENDING" }).expect(200)).body.items.map((x: Approach) => x.id)).toEqual([a.id]);
    expect((await as(r).get("/api/approaches/sent").query({ status: "ACCEPTED" }).expect(200)).body.items).toEqual([]);
    expect((await notificationsOf(cand.id)).map((n) => n.type)).toContain("APPROACH_RECEIVED");
    await waitFor(() => live.to(`user:${cand.id}`, "approach:new").length === 1);
    expect(live.emits.filter((e) => e.event === "approach:new").flatMap((e) => e.rooms)).toEqual([`user:${cand.id}`]);
    const counts = await db.selectFrom("recruiters").select("approaches_sent").where("id", "=", r.recruiterId).executeTakeFirstOrThrow();
    expect(counts.approaches_sent).toBe(1);
  });

  test("only ACTIVE recruiters can send; the body cannot name another recruiter", async () => {
    const cand = await makeProfile();
    const plain = await createUser();
    expect((await send(plain, { username: cand.username }).expect(403)).body.code).toBe("RECRUITER_REQUIRED");
    const pending = await makeCompanyRecruiter({ stopAt: "PENDING_REVIEW" });
    expect((await send(pending, { username: cand.username }).expect(403)).body.code).toBe("RECRUITER_REQUIRED");
    const r = await makeCompanyRecruiter();
    const forged = await send(r, { username: cand.username, recruiterId: pending.recruiterId }).expect(400);
    expect(forged.body.code).toBe("VALIDATION_FAILED");
    expect((await send(r, { username: cand.username, message: "too short" }).expect(400)).body.code).toBe("VALIDATION_FAILED");
  });

  test("DRAFT profiles and unknown users read as not open; you cannot approach yourself", async () => {
    const r = await makeCompanyRecruiter();
    const draft = await makeProfile({ status: "DRAFT" });
    expect((await send(r, { username: draft.username }).expect(409)).body.code).toBe("APPROACH_NOT_PUBLISHED");
    expect((await send(r, { username: "nobody-by-this-name" }).expect(404)).body.code).toBe("PROFILE_NOT_FOUND");
    expect((await send(r, { username: r.username }).expect(409)).body.code).toBe("APPROACH_SELF");
    const unlisted = await makeProfile({ status: "UNLISTED" });
    await send(r, { username: unlisted.username }).expect(201);
  });

  test("one pending approach per pair; salary bounds checked; a job must be an open job of your company", async () => {
    const r = await makeCompanyRecruiter();
    const other = await makeCompanyRecruiter();
    const cand = await makeProfile();
    expect((await send(r, { username: cand.username, salary: { min: 10, max: 5, currency: "USD", period: "YEAR" } }).expect(400)).body.code).toBe("SALARY_INVALID");
    const foreign = await makeJob(other);
    expect((await send(r, { username: cand.username, jobId: foreign.id }).expect(400)).body.code).toBe("JOB_NOT_SHAREABLE");
    const draftJob = await makeJob(r, { publish: false });
    expect((await send(r, { username: cand.username, jobId: draftJob.id }).expect(400)).body.code).toBe("JOB_NOT_SHAREABLE");
    const job = await makeJob(r);
    const a = await approach(r, cand, { jobId: job.id });
    expect(a.job).toEqual({ id: job.id, title: job.title });
    expect((await send(r, { username: cand.username }).expect(409)).body.code).toBe("APPROACH_ALREADY_PENDING");
    // A teammate is a different recruiter: their own pending check.
    await approach(await teammate(r), cand);
  });

  test("concurrent sends to the same candidate: exactly one wins", async () => {
    const r = await makeCompanyRecruiter();
    const cand = await makeProfile();
    const res = await Promise.all([send(r, { username: cand.username }), send(r, { username: cand.username }), send(r, { username: cand.username })]);
    expect(res.map((x) => x.status).sort()).toEqual([201, 409, 409]);
  });

  test("the daily quota answers 429 APPROACH_QUOTA", async () => {
    await setSettings({ recruiter: { approachesPerDay: 2 } });
    const r = await makeCompanyRecruiter();
    await approach(r, await makeProfile());
    await approach(r, await makeProfile());
    const over = await send(r, { username: (await makeProfile()).username }).expect(429);
    expect(over.body.code).toBe("APPROACH_QUOTA");
  });

  test("an approach the classifier takes down never reaches the candidate and refunds the quota", async () => {
    await setSettings({ recruiter: { approachesPerDay: 1 }, moderation: { provider: "rules", blockedTerms: ["zorblaxian"] } });
    const r = await makeCompanyRecruiter();
    const cand = await makeProfile();
    const bad = await send(r, { username: cand.username, message: `${APPROACH_MESSAGE} Also zorblaxian offers inside.` }).expect(201);
    await waitFor(async () => (await db.selectFrom("approaches").select("moderation_state").where("id", "=", bad.body.id).executeTakeFirstOrThrow()).moderation_state === "FLAGGED");
    expect((await as(cand).get("/api/approaches/received").expect(200)).body.items).toEqual([]);
    expect((await as(cand).get(`/api/approaches/${bad.body.id}`).expect(404)).body.code).toBe("APPROACH_NOT_FOUND");
    expect((await as(cand).post(`/api/approaches/${bad.body.id}/accept`).send({ channels: ["EMAIL"] }).expect(404)).body.code).toBe("APPROACH_NOT_FOUND");
    // The quota of one is free again.
    await approach(r, await makeProfile());
  });
});

describe("reading", () => {
  test("an approach is readable by its candidate and its recruiter only", async () => {
    const r = await makeCompanyRecruiter();
    const mate = await teammate(r);
    const cand = await makeProfile();
    const a = await approach(r, cand);
    await as(cand).get(`/api/approaches/${a.id}`).expect(200);
    await as(r).get(`/api/approaches/${a.id}`).expect(200);
    for (const u of [mate, await createUser(), await makeCompanyRecruiter()]) expect((await as(u).get(`/api/approaches/${a.id}`).expect(404)).body.code).toBe("APPROACH_NOT_FOUND");
  });

  test("viewed marks it seen once, by the candidate only", async () => {
    const r = await makeCompanyRecruiter();
    const cand = await makeProfile();
    const a = await approach(r, cand);
    await as(r).post(`/api/approaches/${a.id}/viewed`).send({}).expect(204);
    expect((await as(cand).get(`/api/approaches/${a.id}`).expect(200)).body.viewedAt).toBeNull();
    await as(cand).post(`/api/approaches/${a.id}/viewed`).send({}).expect(204);
    const first = (await as(cand).get(`/api/approaches/${a.id}`).expect(200)).body.viewedAt;
    expect(first).not.toBeNull();
    await as(cand).post(`/api/approaches/${a.id}/viewed`).send({}).expect(204);
    expect((await as(cand).get(`/api/approaches/${a.id}`).expect(200)).body.viewedAt).toBe(first);
  });
});

describe("accepting and the contact unlock", () => {
  test("accepting shares exactly the chosen channels, opens a thread both can write in, and notifies the recruiter", async () => {
    const r = await makeCompanyRecruiter();
    const cand = await makeProfile({ contact: { whatsapp: uniquePhone() } });
    const a = await approach(r, cand);
    const live = recordRealtime();
    const accepted = (await as(cand).post(`/api/approaches/${a.id}/accept`).send({ channels: ["PHONE", "WHATSAPP", "PHONE"] }).expect(200)).body as Approach;
    expect(accepted).toMatchObject({ status: "ACCEPTED", unlockRevoked: false });
    expect([...accepted.unlockedChannels].sort()).toEqual(["PHONE", "WHATSAPP"]);
    expect(accepted.threadId).toEqual(expect.any(String));
    expect((await notificationsOf(r.id)).map((n) => n.type)).toContain("APPROACH_ACCEPTED");
    expect(live.to(`user:${r.id}`, "approach:updated").map((p) => p.approach.status)).toContain("ACCEPTED");
    expect(live.to(`user:${cand.id}`, "approach:updated").length).toBeGreaterThan(0);

    for (const u of [r, cand]) {
      const t = (await as(u).get(`/api/dms/threads/${accepted.threadId}`).expect(200)).body;
      expect(t).toMatchObject({ context: "APPROACH", viewerState: "ACTIVE", canSend: true });
    }
    await as(r).post(`/api/dms/threads/${accepted.threadId}/messages`).send({ body: "Thanks for saying yes" }).expect(201);
    await as(cand).post(`/api/dms/threads/${accepted.threadId}/messages`).send({ body: "Happy to talk" }).expect(201);

    const reveal = (await as(r).get(`/api/approaches/${a.id}/contact`).set("User-Agent", "FictionalBrowser/1.0").expect(200)).body;
    expect(reveal).toEqual({ approachId: a.id, email: null, phone: cand.contact.phone, whatsapp: cand.contact.whatsapp, whatsappLink: `https://wa.me/${cand.contact.whatsapp!.replace(/\D/g, "")}` });
    const log = await db.selectFrom("contact_access_log").select(["channel", "recruiter_id", "user_agent", "ip_hash"]).where("candidate_id", "=", cand.id).execute();
    expect(log.map((l) => l.channel).sort()).toEqual(["PHONE", "WHATSAPP"]);
    expect(log.every((l) => l.recruiter_id === r.recruiterId && l.user_agent === "FictionalBrowser/1.0")).toBe(true);
    // The candidate sees every reveal, with the recruiter and their company.
    const mine = (await as(cand).get("/api/profiles/me/contact-log").expect(200)).body;
    expect(mine).toHaveLength(2);
    expect(mine[0]).toMatchObject({ recruiter: { id: r.id }, company: { slug: r.company.slug } });
  });

  test("EMAIL only: the reveal never carries the phone the candidate kept private", async () => {
    const { recruiter, candidate, approach: a } = await acceptedApproach(["EMAIL"]);
    const reveal = (await as(recruiter).get(`/api/approaches/${a.id}/contact`).expect(200)).body;
    expect(reveal).toMatchObject({ email: candidate.contact.email, phone: null, whatsapp: null, whatsappLink: null });
    expect(JSON.stringify(reveal)).not.toContain(candidate.contact.phone!);
    expect(JSON.stringify(a)).not.toContain(candidate.contact.email!);
  });

  test("a channel the candidate has not filled in cannot be shared; channels are required", async () => {
    const r = await makeCompanyRecruiter();
    const cand = await makeProfile({ contact: { whatsapp: null } });
    const a = await approach(r, cand);
    const res = await as(cand).post(`/api/approaches/${a.id}/accept`).send({ channels: ["EMAIL", "WHATSAPP"] }).expect(400);
    expect(res.body).toMatchObject({ code: "CHANNEL_NOT_SET", details: { missing: ["WHATSAPP"] } });
    await as(cand).post(`/api/approaches/${a.id}/accept`).send({ channels: [] }).expect(400);
    expect((await as(cand).get(`/api/approaches/${a.id}`).expect(200)).body.status).toBe("PENDING");
  });

  test("only the candidate accepts; only the approach's own recruiter reveals", async () => {
    const r = await makeCompanyRecruiter();
    const mate = await teammate(r);
    const cand = await makeProfile();
    const a = await approach(r, cand);
    expect((await as(r).post(`/api/approaches/${a.id}/accept`).send({ channels: ["EMAIL"] }).expect(404)).body.code).toBe("APPROACH_NOT_FOUND");
    expect((await as(r).get(`/api/approaches/${a.id}/contact`).expect(403)).body.code).toBe("CONTACT_NOT_SHARED");
    await as(cand).post(`/api/approaches/${a.id}/accept`).send({ channels: ["EMAIL"] }).expect(200);
    expect((await as(mate).get(`/api/approaches/${a.id}/contact`).expect(403)).body.code).toBe("CONTACT_NOT_SHARED");
    expect((await as(cand).get(`/api/approaches/${a.id}/contact`).expect(403)).body.code).toBe("RECRUITER_REQUIRED");
  });

  test("accept and withdraw racing: exactly one wins", async () => {
    const r = await makeCompanyRecruiter();
    const cand = await makeProfile();
    const a = await approach(r, cand);
    const [acc, wd] = await Promise.all([as(cand).post(`/api/approaches/${a.id}/accept`).send({ channels: ["EMAIL"] }), as(r).post(`/api/approaches/${a.id}/withdraw`).send({})]);
    expect([acc.status, wd.status].sort()).toEqual([200, 409]);
    const final = (await db.selectFrom("approaches").select("status").where("id", "=", a.id).executeTakeFirstOrThrow()).status;
    expect(final).toBe(acc.status === 200 ? "ACCEPTED" : "WITHDRAWN");
    const unlocks = await db.selectFrom("contact_unlocks").select("id").where("approach_id", "=", a.id).execute();
    expect(unlocks).toHaveLength(acc.status === 200 ? 1 : 0);
  });

  test("an approach past its expiry cannot be accepted", async () => {
    const r = await makeCompanyRecruiter();
    const cand = await makeProfile();
    const a = await approach(r, cand);
    await db.updateTable("approaches").set({ expires_at: new Date(Date.now() - 60_000) }).where("id", "=", a.id).execute();
    expect((await as(cand).post(`/api/approaches/${a.id}/accept`).send({ channels: ["EMAIL"] }).expect(409)).body.code).toBe("APPROACH_EXPIRED");
  });
});

describe("revoking", () => {
  test("revoke ends the reveal, keeps the conversation, notifies the recruiter; a second revoke has nothing to take back", async () => {
    const { recruiter, candidate, approach: a } = await acceptedApproach(["EMAIL"]);
    await as(recruiter).get(`/api/approaches/${a.id}/contact`).expect(200);
    const revoked = (await as(candidate).post(`/api/approaches/${a.id}/revoke`).send({}).expect(200)).body as Approach;
    expect(revoked).toMatchObject({ status: "ACCEPTED", unlockRevoked: true });
    expect((await as(recruiter).get(`/api/approaches/${a.id}/contact`).expect(403)).body.code).toBe("CONTACT_NOT_SHARED");
    expect((await as(candidate).post(`/api/approaches/${a.id}/revoke`).send({}).expect(409)).body.code).toBe("NOTHING_SHARED");
    expect((await notificationsOf(recruiter.id)).map((n) => n.type)).toContain("CONTACT_REVOKED");
    // The access log still lists the reveal that happened before.
    expect((await as(candidate).get("/api/profiles/me/contact-log").expect(200)).body).toHaveLength(1);
    await as(recruiter).post(`/api/dms/threads/${a.threadId}/messages`).send({ body: "Understood, we can keep talking here" }).expect(201);
  });

  test("nothing to revoke on a pending approach", async () => {
    const r = await makeCompanyRecruiter();
    const cand = await makeProfile();
    const a = await approach(r, cand);
    expect((await as(cand).post(`/api/approaches/${a.id}/revoke`).send({}).expect(409)).body.code).toBe("NOTHING_SHARED");
  });
});

describe("declining, blocking and withdrawing", () => {
  test("decline with a reason, then the cooldown applies with its end date", async () => {
    const r = await makeCompanyRecruiter();
    const cand = await makeProfile();
    const a = await approach(r, cand);
    const declined = (await as(cand).post(`/api/approaches/${a.id}/decline`).send({ reason: "Not looking right now" }).expect(200)).body;
    expect(declined).toMatchObject({ status: "DECLINED", declineReason: "Not looking right now" });
    expect((await notificationsOf(r.id)).map((n) => n.type)).toContain("APPROACH_DECLINED");
    expect((await as(cand).post(`/api/approaches/${a.id}/decline`).send({}).expect(409)).body.code).toBe("APPROACH_NOT_PENDING");
    const again = await send(r, { username: cand.username }).expect(409);
    expect(again.body.code).toBe("APPROACH_COOLDOWN");
    const until = new Date(again.body.details.cooldownUntil).getTime();
    expect(Math.abs(until - (new Date(declined.respondedAt).getTime() + 30 * 86400_000))).toBeLessThan(2000);
    // After the cooldown, a new approach is allowed.
    await db.updateTable("approaches").set({ responded_at: new Date(Date.now() - 31 * 86400_000) }).where("id", "=", a.id).execute();
    await approach(r, cand);
  });

  test("a zero-day cooldown lets the recruiter try again at once", async () => {
    await setSettings({ recruiter: { declineCooldownDays: 0 } });
    const r = await makeCompanyRecruiter();
    const cand = await makeProfile();
    const a = await approach(r, cand);
    await as(cand).post(`/api/approaches/${a.id}/decline`).send({}).expect(200);
    await approach(r, cand);
  });

  test("blocking from an approach blocks the recruiter; later sends read as not published, never as blocked", async () => {
    const r = await makeCompanyRecruiter();
    const cand = await makeProfile();
    const a = await approach(r, cand);
    await as(cand).post(`/api/approaches/${a.id}/block`).send({}).expect(204);
    expect((await db.selectFrom("approaches").select("status").where("id", "=", a.id).executeTakeFirstOrThrow()).status).toBe("BLOCKED");
    expect((await db.selectFrom("blocks").select("blocked_id").where("blocker_id", "=", cand.id).execute()).map((b) => b.blocked_id)).toEqual([r.id]);
    const res = await send(r, { username: cand.username }).expect(409);
    expect(res.body.code).toBe("APPROACH_NOT_PUBLISHED");
    expect(JSON.stringify(res.body)).not.toMatch(/block/i);
  });

  test("blocking an accepted approach ends the reveal", async () => {
    const { recruiter, candidate, approach: a } = await acceptedApproach(["EMAIL"]);
    await as(candidate).post(`/api/approaches/${a.id}/block`).send({}).expect(204);
    expect((await as(recruiter).get(`/api/approaches/${a.id}/contact`).expect(403)).body.code).toBe("CONTACT_NOT_SHARED");
  });

  test("the recruiter withdraws a pending approach; not someone else's, not twice", async () => {
    const r = await makeCompanyRecruiter();
    const other = await makeCompanyRecruiter();
    const cand = await makeProfile();
    const a = await approach(r, cand);
    expect((await as(other).post(`/api/approaches/${a.id}/withdraw`).send({}).expect(404)).body.code).toBe("APPROACH_NOT_FOUND");
    expect((await as(r).post(`/api/approaches/${a.id}/withdraw`).send({}).expect(200)).body.status).toBe("WITHDRAWN");
    expect((await as(r).post(`/api/approaches/${a.id}/withdraw`).send({}).expect(409)).body.code).toBe("APPROACH_NOT_PENDING");
    expect((await as(cand).post(`/api/approaches/${a.id}/accept`).send({ channels: ["EMAIL"] }).expect(409)).body.code).toBe("APPROACH_NOT_PENDING");
    // Withdrawing frees the pair for a new approach.
    await approach(r, cand);
  });
});
