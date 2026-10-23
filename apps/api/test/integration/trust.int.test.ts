/**
 * Trust: engagements confirmed by both sides, double-blind ratings (hidden until both
 * rate or the window closes, one edit before reveal, none after), the displayed
 * average, and complaints that must name a real dealing.
 */
import { afterEach, describe, expect, test } from "vitest";
import type { Engagement } from "@open-talent/types";
import { db } from "../../src/db/kysely";
import { displayRating } from "../../src/domain/profile";
import { runHousekeeping } from "../../src/services/housekeeping.service";
import { anon, as, createUser, type TestUser } from "./harness";
import { acceptedApproach, apply, approach, makeCompanyRecruiter, makeJob, makeProfile, notificationsOf, operator, resetSettings, setSettings } from "./talent-fixtures";

afterEach(resetSettings);

const propose = (u: TestUser, body: Record<string, unknown>) => as(u).post("/api/trust/engagements").send({ title: "Platform contract", ...body });
const step = (u: TestUser, id: string, what: "confirm" | "cancel" | "complete" | "dispute") => as(u).post(`/api/trust/engagements/${id}/${what}`).send({});
const rate = (u: TestUser, id: string, body: Record<string, unknown>) => as(u).post(`/api/trust/engagements/${id}/rating`).send(body);

/** An accepted approach turned into an ACTIVE engagement. */
async function activeEngagement() {
  const { recruiter, candidate, approach: a } = await acceptedApproach(["EMAIL"]);
  const e = (await propose(recruiter, { approachId: a.id }).expect(201)).body as Engagement;
  await step(candidate, e.id, "confirm").expect(200);
  return { recruiter, candidate, approach: a, engagement: e };
}

async function completedEngagement() {
  const w = await activeEngagement();
  await step(w.recruiter, w.engagement.id, "complete").expect(200);
  await step(w.candidate, w.engagement.id, "complete").expect(200);
  return w;
}

describe("engagements", () => {
  test("proposed from an accepted approach, ACTIVE only once both sides confirm", async () => {
    const { recruiter, candidate, approach: a } = await acceptedApproach(["EMAIL"]);
    const e = (await propose(candidate, { approachId: a.id }).expect(201)).body as Engagement;
    expect(e).toMatchObject({ status: "PROPOSED", candidateConfirmed: true, recruiterConfirmed: false, approachId: a.id, applicationId: null, company: { id: recruiter.company.id } });
    expect((await notificationsOf(recruiter.id)).map((n) => n.type)).toContain("ENGAGEMENT_PROPOSED");
    // Confirming your own side again does not start it.
    expect((await step(candidate, e.id, "confirm").expect(200)).body.status).toBe("PROPOSED");
    const started = (await step(recruiter, e.id, "confirm").expect(200)).body as Engagement;
    expect(started).toMatchObject({ status: "ACTIVE", candidateConfirmed: true, recruiterConfirmed: true });
    expect((await notificationsOf(candidate.id)).map((n) => n.type)).toContain("ENGAGEMENT_UPDATED");
    expect((await step(recruiter, e.id, "confirm").expect(409)).body.code).toBe("ENGAGEMENT_STATE");
    for (const u of [recruiter, candidate]) expect((await as(u).get("/api/trust/engagements").expect(200)).body.map((x: Engagement) => x.id)).toEqual([e.id]);
    expect((await as(await createUser()).get("/api/trust/engagements").expect(200)).body).toEqual([]);
    expect((await step(await createUser(), e.id, "confirm").expect(404)).body.code).toBe("ENGAGEMENT_NOT_FOUND");
  });

  test("one source, an accepted approach, no duplicates, parties only", async () => {
    const r = await makeCompanyRecruiter();
    const cand = await makeProfile();
    const pending = await approach(r, cand);
    expect((await propose(r, { approachId: pending.id }).expect(409)).body.code).toBe("APPROACH_NOT_ACCEPTED");
    expect((await propose(r, {}).expect(400)).body.code).toBe("SOURCE_REQUIRED");
    const { recruiter, approach: a } = await acceptedApproach(["EMAIL"]);
    expect((await propose(recruiter, { approachId: a.id, applicationId: a.id }).expect(400)).body.code).toBe("SOURCE_REQUIRED");
    expect((await propose(await createUser(), { approachId: a.id }).expect(404)).body.code).toBe("APPROACH_NOT_FOUND");
    await propose(recruiter, { approachId: a.id }).expect(201);
    expect((await propose(recruiter, { approachId: a.id }).expect(409)).body.code).toBe("ENGAGEMENT_EXISTS");
    expect((await propose(recruiter, { approachId: a.id, recruiterId: recruiter.recruiterId }).expect(400)).body.code).toBe("VALIDATION_FAILED");
  });

  test("from a hired application: the hiring team proposes, after HIRED only", async () => {
    const team = await makeCompanyRecruiter();
    const job = await makeJob(team);
    const cand = await makeProfile();
    const app = await apply(cand, job.id);
    expect((await propose(team, { applicationId: app.id }).expect(409)).body.code).toBe("NOT_HIRED");
    await as(team).post(`/api/applications/${app.id}/move`).send({ to: "HIRED" }).expect(200);
    expect((await propose(cand, { applicationId: app.id }).expect(403)).body.code).toBe("NOT_HIRING_TEAM");
    expect((await propose(await makeCompanyRecruiter(), { applicationId: app.id }).expect(403)).body.code).toBe("NOT_HIRING_TEAM");
    const e = (await propose(team, { applicationId: app.id }).expect(201)).body as Engagement;
    expect(e).toMatchObject({ status: "PROPOSED", recruiterConfirmed: true, candidateConfirmed: false, applicationId: app.id });
    expect((await step(cand, e.id, "confirm").expect(200)).body.status).toBe("ACTIVE");
  });

  test("cancel while proposed only", async () => {
    const { recruiter, candidate, approach: a } = await acceptedApproach(["EMAIL"]);
    const e = (await propose(recruiter, { approachId: a.id }).expect(201)).body as Engagement;
    expect((await step(candidate, e.id, "cancel").expect(200)).body.status).toBe("CANCELLED");
    expect((await step(recruiter, e.id, "cancel").expect(409)).body.code).toBe("ENGAGEMENT_STATE");
    const w = await activeEngagement();
    expect((await step(w.recruiter, w.engagement.id, "cancel").expect(409)).body.code).toBe("ENGAGEMENT_STATE");
  });

  test("completion: one side asks, the other confirms; asking twice changes nothing", async () => {
    const { recruiter, candidate, engagement: e } = await activeEngagement();
    const asked = (await step(recruiter, e.id, "complete").expect(200)).body as Engagement;
    expect(asked).toMatchObject({ status: "ACTIVE", completionRequestedBy: recruiter.id });
    expect((await step(recruiter, e.id, "complete").expect(200)).body).toMatchObject({ status: "ACTIVE", completionRequestedBy: recruiter.id });
    expect((await step(recruiter, e.id, "dispute").expect(409)).body.code).toBe("ENGAGEMENT_STATE");
    const done = (await step(candidate, e.id, "complete").expect(200)).body as Engagement;
    expect(done.status).toBe("COMPLETED");
    expect(done.completedAt).not.toBeNull();
    expect(done.rating).toMatchObject({ viewerRated: false, counterpartRated: false, canRate: true });
  });

  test("the other side can dispute a completion request", async () => {
    const { recruiter, candidate, engagement: e } = await activeEngagement();
    expect((await step(candidate, e.id, "dispute").expect(409)).body.code).toBe("ENGAGEMENT_STATE");
    await step(candidate, e.id, "complete").expect(200);
    expect((await step(recruiter, e.id, "dispute").expect(200)).body.status).toBe("DISPUTED");
    expect((await step(recruiter, e.id, "complete").expect(409)).body.code).toBe("ENGAGEMENT_STATE");
  });
});

describe("ratings", () => {
  test("only completed engagements, within the window", async () => {
    const { recruiter, engagement: e } = await activeEngagement();
    expect((await rate(recruiter, e.id, { score: 5 }).expect(409)).body.code).toBe("ENGAGEMENT_NOT_COMPLETE");
    const done = await completedEngagement();
    await db.updateTable("engagements").set({ completed_at: new Date(Date.now() - 61 * 86400_000) }).where("id", "=", done.engagement.id).execute();
    expect((await rate(done.recruiter, done.engagement.id, { score: 5 }).expect(409)).body.code).toBe("RATING_WINDOW_CLOSED");
    expect((await rate(await createUser(), done.engagement.id, { score: 5 }).expect(404)).body.code).toBe("ENGAGEMENT_NOT_FOUND");
    await rate(done.recruiter, done.engagement.id, { score: 6 }).expect(400);
  });

  test("double blind: hidden until both rate, then revealed together, averaged on the profile", async () => {
    const { recruiter, candidate, engagement: e } = await completedEngagement();
    const first = (await rate(recruiter, e.id, { score: 5, subScores: { communication: 5, reliability: 4 }, comment: "Excellent work" }).expect(200)).body;
    expect(first.revealed).toBe(false);
    expect((await anon().get(`/api/profiles/${candidate.username}/ratings`).expect(200)).body).toEqual([]);
    expect((await anon().get(`/api/profiles/${candidate.username}`).expect(200)).body.rating).toEqual({ average: null, count: 0 });
    const view = (await as(candidate).get("/api/trust/engagements").expect(200)).body[0] as Engagement;
    expect(view.rating).toMatchObject({ viewerRated: false, counterpartRated: true, canRate: true });
    // The candidate cannot read the score before rating.
    expect(JSON.stringify(view)).not.toContain("Excellent work");

    const second = (await rate(candidate, e.id, { score: 4, comment: "Clear brief" }).expect(200)).body;
    expect(second.revealed).toBe(true);
    const ratings = (await anon().get(`/api/profiles/${candidate.username}/ratings`).expect(200)).body;
    expect(ratings).toHaveLength(1);
    expect(ratings[0]).toMatchObject({ engagementId: e.id, rater: { id: recruiter.id }, score: 5, subScores: { communication: 5, reliability: 4 }, comment: "Excellent work", revealedAt: expect.any(String) });
    expect((await anon().get(`/api/profiles/${candidate.username}`).expect(200)).body.rating).toEqual({ average: displayRating(5, 1), count: 1 });
    expect(displayRating(5, 1)).toBe(4.3);
    expect((await notificationsOf(candidate.id)).map((n) => n.type)).toContain("RATING_RECEIVED");
    const company = await db.selectFrom("companies").select(["rating_avg", "rating_count"]).where("id", "=", recruiter.company.id).executeTakeFirstOrThrow();
    expect({ avg: Number(company.rating_avg), n: company.rating_count }).toEqual({ avg: 4, n: 1 });
    // Revealed ratings are final.
    expect((await rate(recruiter, e.id, { score: 1 }).expect(409)).body.code).toBe("RATING_REVEALED");
    expect((await rate(candidate, e.id, { score: 1 }).expect(409)).body.code).toBe("RATING_REVEALED");
  });

  test("one edit before reveal, then ALREADY_EDITED", async () => {
    const { recruiter, engagement: e } = await completedEngagement();
    await rate(recruiter, e.id, { score: 2 }).expect(200);
    await rate(recruiter, e.id, { score: 3 }).expect(200);
    expect((await rate(recruiter, e.id, { score: 4 }).expect(409)).body.code).toBe("RATING_ALREADY_EDITED");
    const row = await db.selectFrom("ratings").select(["score", "edited_at"]).where("engagement_id", "=", e.id).executeTakeFirstOrThrow();
    expect(row.score).toBe(3);
    expect(row.edited_at).not.toBeNull();
  });

  test("a lone rating is revealed when the window closes", async () => {
    const { recruiter, candidate, engagement: e } = await completedEngagement();
    await rate(recruiter, e.id, { score: 4 }).expect(200);
    await runHousekeeping();
    expect((await anon().get(`/api/profiles/${candidate.username}/ratings`).expect(200)).body).toEqual([]);
    await db.updateTable("engagements").set({ completed_at: new Date(Date.now() - 61 * 86400_000) }).where("id", "=", e.id).execute();
    await runHousekeeping();
    expect((await anon().get(`/api/profiles/${candidate.username}/ratings`).expect(200)).body.map((r: { score: number }) => r.score)).toEqual([4]);
    expect((await anon().get(`/api/profiles/${candidate.username}`).expect(200)).body.rating).toEqual({ average: displayRating(4, 1), count: 1 });
  });

  test("a hidden rating leaves the list and the average", async () => {
    const { recruiter, candidate, engagement: e } = await completedEngagement();
    const r = (await rate(recruiter, e.id, { score: 1, comment: "Rude remarks" }).expect(200)).body;
    await rate(candidate, e.id, { score: 5 }).expect(200);
    expect((await anon().get(`/api/profiles/${candidate.username}`).expect(200)).body.rating.count).toBe(1);
    const mod = await operator("MODERATOR");
    await as(mod).post(`/api/admin/ratings/${r.id}/hide`).send({ reason: "Retaliation" }).expect(204);
    expect((await anon().get(`/api/profiles/${candidate.username}/ratings`).expect(200)).body).toEqual([]);
    expect((await anon().get(`/api/profiles/${candidate.username}`).expect(200)).body.rating).toEqual({ average: null, count: 0 });
    expect((await as(mod).post(`/api/admin/ratings/${r.id}/hide`).send({ reason: "Again" }).expect(404)).status).toBe(404);
  });
});

describe("complaints", () => {
  const body = (against: TestUser, ctx: Record<string, unknown>) => ({ againstUsername: against.username, category: "HARASSMENT", description: "Repeated messages after I said no, twice.", ...ctx });

  test("a complaint must name a real dealing between the two", async () => {
    const { recruiter, candidate, approach: a } = await acceptedApproach(["EMAIL"]);
    const stranger = await makeProfile();
    expect((await as(candidate).post("/api/trust/complaints").send(body(recruiter, {})).expect(400)).body.code).toBe("CONTEXT_REQUIRED");
    expect((await as(stranger).post("/api/trust/complaints").send(body(recruiter, { approachId: a.id })).expect(404)).body.code).toBe("NO_RELATIONSHIP");
    expect((await as(candidate).post("/api/trust/complaints").send(body(stranger, { approachId: a.id })).expect(404)).body.code).toBe("NO_RELATIONSHIP");
    await as(candidate).post("/api/trust/complaints").send(body(candidate, { approachId: a.id })).expect(404);
    const filed = await as(candidate).post("/api/trust/complaints").send(body(recruiter, { approachId: a.id })).expect(201);
    const mine = (await as(candidate).get("/api/trust/complaints").expect(200)).body;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ id: filed.body.id, against: { id: recruiter.id }, approachId: a.id, status: "OPEN", category: "HARASSMENT" });
    // The recruiter can complain back about the same dealing.
    await as(recruiter).post("/api/trust/complaints").send(body(candidate, { approachId: a.id, category: "NO_SHOW" })).expect(201);
  });

  test("applications and engagements count as dealings; one open complaint per engagement", async () => {
    const team = await makeCompanyRecruiter();
    const job = await makeJob(team);
    const cand = await makeProfile();
    const app = await apply(cand, job.id);
    await as(cand).post("/api/trust/complaints").send(body(team, { applicationId: app.id, category: "DISCRIMINATION" })).expect(201);
    expect((await as(cand).post("/api/trust/complaints").send(body(await makeCompanyRecruiter(), { applicationId: app.id })).expect(404)).body.code).toBe("NO_RELATIONSHIP");

    const w = await activeEngagement();
    await as(w.candidate).post("/api/trust/complaints").send(body(w.recruiter, { engagementId: w.engagement.id, category: "NON_PAYMENT" })).expect(201);
    expect((await as(w.candidate).post("/api/trust/complaints").send(body(w.recruiter, { engagementId: w.engagement.id, category: "NON_PAYMENT" })).expect(409)).body.code).toBe("COMPLAINT_EXISTS");
  });

  test("at most complaintsPer30Days per complainant", async () => {
    await setSettings({ trust: { complaintsPer30Days: 1 } });
    const { recruiter, candidate, approach: a } = await acceptedApproach(["EMAIL"]);
    await as(candidate).post("/api/trust/complaints").send(body(recruiter, { approachId: a.id })).expect(201);
    expect((await as(candidate).post("/api/trust/complaints").send(body(recruiter, { approachId: a.id, category: "SPAM" })).expect(429)).body.code).toBe("COMPLAINT_LIMIT");
  });

  test("an operator resolves it; both sides are told and read the note", async () => {
    const { recruiter, candidate, approach: a } = await acceptedApproach(["EMAIL"]);
    const filed = (await as(candidate).post("/api/trust/complaints").send(body(recruiter, { approachId: a.id })).expect(201)).body;
    const mod = await operator("MODERATOR");
    const queue = (await as(mod).get("/api/admin/complaints").expect(200)).body.items;
    expect(queue.find((c: { id: string }) => c.id === filed.id)).toMatchObject({ complainant: { id: candidate.id }, against: { id: recruiter.id }, status: "OPEN" });
    expect((await as(mod).post(`/api/admin/complaints/${filed.id}/resolve`).send({ status: "DISMISSED" }).expect(400)).body.code).toBe("NOTE_REQUIRED");
    await as(mod).post(`/api/admin/complaints/${filed.id}/resolve`).send({ status: "UNDER_REVIEW" }).expect(204);
    await as(mod).post(`/api/admin/complaints/${filed.id}/resolve`).send({ status: "ACTION_TAKEN", note: "We warned the recruiter", action: { kind: "WARN" } }).expect(204);
    for (const u of [candidate, recruiter]) {
      const n = (await notificationsOf(u.id)).filter((x) => x.type === "COMPLAINT_UPDATED");
      expect(n.map((x) => x.snippet)).toEqual(["We warned the recruiter"]);
    }
    const mine = (await as(candidate).get("/api/trust/complaints").expect(200)).body[0];
    expect(mine).toMatchObject({ status: "ACTION_TAKEN", adminNote: "We warned the recruiter", resolvedAt: expect.any(String) });
    const row = await db.selectFrom("complaints").select(["resolved_by", "action_id"]).where("id", "=", filed.id).executeTakeFirstOrThrow();
    expect(row.resolved_by).toBe(mod.id);
    expect(row.action_id).not.toBeNull();
    expect((await as(mod).post(`/api/admin/complaints/${filed.id}/resolve`).send({ status: "DISMISSED", note: "Again" }).expect(409)).body.code).toBe("COMPLAINT_RESOLVED");
    // Members cannot read the queue.
    expect((await as(candidate).get("/api/admin/complaints").expect(403)).body.code).toBe("FORBIDDEN_AREA");
  });
});
