/**
 * Jobs: posting and editing, who sees DRAFT jobs, status changes, the open-job cap
 * (reopening counts), search filters and pagination, recommendations, saved jobs and
 * invitations to apply.
 */
import { afterEach, describe, expect, test } from "vitest";
import type { Job } from "@open-talent/types";
import { db } from "../../src/db/kysely";
import { anon, as, createUser } from "./harness";
import { allPages, apply, makeCompanyRecruiter, makeJob, makeProfile, notificationsOf, operator, resetSettings, setSettings, teammate, uniq } from "./talent-fixtures";

afterEach(resetSettings);

const DESCRIPTION = "Build and run the services behind a calm, well tested product. You will own APIs.";
const ids = (items: { id: string }[]) => items.map((x) => x.id);

describe("posting", () => {
  test("a recruiter posts a draft or an open job; the team can manage it", async () => {
    const r = await makeCompanyRecruiter();
    const draft = await makeJob(r, { publish: false, skills: ["TypeScript", "typescript", " Go "], seniority: "SENIOR", location: "Porto", countryCode: "pt", salary: { min: 50000, max: 70000, currency: "eur", period: "YEAR" }, screeningQuestions: [{ prompt: "Can you work in the EU?", kind: "YES_NO", required: true }] });
    expect(draft).toMatchObject({ status: "DRAFT", openedAt: null, skills: ["TypeScript", "Go"], seniority: "SENIOR", countryCode: "PT", salary: { min: 50000, max: 70000, currency: "EUR", period: "YEAR" } });
    expect(draft.screeningQuestions).toEqual([{ id: expect.any(String), prompt: "Can you work in the EU?", kind: "YES_NO", required: true }]);
    expect(draft.viewer.canManage).toBe(true);
    expect(draft.postedBy?.id).toBe(r.id);
    const open = await makeJob(r);
    expect(open.status).toBe("OPEN");
    expect(open.openedAt).not.toBeNull();
    const company = await db.selectFrom("companies").select("open_job_count").where("id", "=", r.company.id).executeTakeFirstOrThrow();
    expect(company.open_job_count).toBe(1);
  });

  test("only ACTIVE recruiters post; the body is strict and validated", async () => {
    const user = await createUser();
    const body = { title: "Engineer", description: DESCRIPTION, employmentType: "FULL_TIME", workplaceType: "REMOTE" };
    expect((await as(user).post("/api/jobs").send(body).expect(403)).body.code).toBe("RECRUITER_REQUIRED");
    const r = await makeCompanyRecruiter();
    expect((await as(r).post("/api/jobs").send({ ...body, companyId: "01ARZ3NDEKTSV4RRFFQ69G5FAV" }).expect(400)).body.code).toBe("VALIDATION_FAILED");
    expect((await as(r).post("/api/jobs").send({ ...body, description: "short" }).expect(400)).body.code).toBe("VALIDATION_FAILED");
    expect((await as(r).post("/api/jobs").send({ ...body, salary: { min: 10, max: 1, currency: "USD", period: "YEAR" } }).expect(400)).body.code).toBe("SALARY_INVALID");
    const tooMany = Array.from({ length: 11 }, (_, i) => ({ prompt: `Question ${i}?`, kind: "TEXT", required: false }));
    expect((await as(r).post("/api/jobs").send({ ...body, screeningQuestions: tooMany }).expect(400)).body.code).toBe("VALIDATION_FAILED");
  });
});

describe("who sees a job", () => {
  test("a DRAFT job is visible to its company team and staff only", async () => {
    const r = await makeCompanyRecruiter();
    const mate = await teammate(r);
    const draft = await makeJob(r, { publish: false });
    await as(mate).get(`/api/jobs/${draft.id}`).expect(200);
    await as(await operator("MODERATOR")).get(`/api/jobs/${draft.id}`).expect(200);
    for (const viewer of [await createUser(), await makeCompanyRecruiter()]) expect((await as(viewer).get(`/api/jobs/${draft.id}`).expect(404)).body.code).toBe("JOB_NOT_FOUND");
    await anon().get(`/api/jobs/${draft.id}`).expect(404);
    // The company's job list: every status for the team, OPEN only for others.
    const open = await makeJob(r);
    expect(ids((await as(mate).get(`/api/companies/${r.company.slug}/jobs`).expect(200)).body.items).sort()).toEqual([draft.id, open.id].sort());
    expect(ids((await anon().get(`/api/companies/${r.company.slug}/jobs`).expect(200)).body.items)).toEqual([open.id]);
    expect(ids((await as(mate).get(`/api/companies/${r.company.slug}/jobs`).query({ status: "DRAFT" }).expect(200)).body.items)).toEqual([draft.id]);
  });

  test("a suspended company's jobs disappear for everyone else", async () => {
    const r = await makeCompanyRecruiter();
    const job = await makeJob(r, { title: `Suspended ${uniq("s")}` });
    const viewer = await createUser();
    await as(viewer).put(`/api/jobs/${job.id}/save`).expect(204);
    const admin = await operator("ADMIN");
    await as(admin).patch(`/api/admin/companies/${r.company.id}`).send({ status: "SUSPENDED", reason: "Scam listings" }).expect(200);
    expect((await db.selectFrom("jobs").select("status").where("id", "=", job.id).executeTakeFirstOrThrow()).status).toBe("CLOSED");
    await as(viewer).get(`/api/jobs/${job.id}`).expect(404);
    expect((await anon().get("/api/jobs").query({ company: r.company.slug }).expect(200)).body.items).toEqual([]);
    expect((await as(viewer).get("/api/jobs/saved").expect(200)).body.items).toEqual([]);
    expect((await anon().get(`/api/companies/${r.company.slug}/jobs`).expect(404)).body.code).toBe("COMPANY_NOT_FOUND");
  });
});

describe("editing and status", () => {
  test("the team edits; others get 404", async () => {
    const r = await makeCompanyRecruiter();
    const mate = await teammate(r);
    const job = await makeJob(r);
    const res = await as(mate).patch(`/api/jobs/${job.id}`).send({ title: "Senior Backend Engineer", skills: ["Rust"], salary: null }).expect(200);
    expect(res.body).toMatchObject({ title: "Senior Backend Engineer", skills: ["Rust"], salary: null });
    expect((await as(await makeCompanyRecruiter()).patch(`/api/jobs/${job.id}`).send({ title: "Hijacked" }).expect(404)).body.code).toBe("JOB_NOT_FOUND");
    expect((await as(r).patch(`/api/jobs/${job.id}`).send({ status: "OPEN" }).expect(400)).body.code).toBe("VALIDATION_FAILED");
  });

  test("open, close, fill and reopen; a published job never goes back to DRAFT", async () => {
    const r = await makeCompanyRecruiter();
    const job = await makeJob(r, { publish: false });
    const opened = (await as(r).post(`/api/jobs/${job.id}/status`).send({ status: "OPEN" }).expect(200)).body as Job;
    expect(opened.status).toBe("OPEN");
    expect((await as(r).post(`/api/jobs/${job.id}/status`).send({ status: "CLOSED" }).expect(200)).body.status).toBe("CLOSED");
    const reopened = (await as(r).post(`/api/jobs/${job.id}/status`).send({ status: "OPEN" }).expect(200)).body as Job;
    expect(reopened.openedAt).toBe(opened.openedAt);
    expect((await as(r).post(`/api/jobs/${job.id}/status`).send({ status: "FILLED" }).expect(200)).body.status).toBe("FILLED");
    expect((await as(r).post(`/api/jobs/${job.id}/status`).send({ status: "DRAFT" }).expect(400)).body.code).toBe("VALIDATION_FAILED");
    // Setting the same status is a no-op.
    expect((await as(r).post(`/api/jobs/${job.id}/status`).send({ status: "FILLED" }).expect(200)).body.status).toBe("FILLED");
  });

  test("a job a moderator hid cannot be reopened", async () => {
    const r = await makeCompanyRecruiter();
    const job = await makeJob(r, { publish: false });
    await db.updateTable("jobs").set({ content_status: "HIDDEN" }).where("id", "=", job.id).execute();
    expect((await as(r).post(`/api/jobs/${job.id}/status`).send({ status: "OPEN" }).expect(403)).body.code).toBe("JOB_UNDER_REVIEW");
  });

  test("the open-job cap counts every move to OPEN, including reopening a closed job", async () => {
    await setSettings({ recruiter: { maxOpenJobsPerCompany: 2 } });
    const r = await makeCompanyRecruiter();
    const a = await makeJob(r);
    await makeJob(r);
    const third = await as(r).post("/api/jobs").send({ title: "Third Role", description: DESCRIPTION, employmentType: "FULL_TIME", workplaceType: "REMOTE", publish: true }).expect(409);
    expect(third.body).toMatchObject({ code: "JOB_CAP_REACHED", details: { cap: 2 } });
    const draft = await makeJob(r, { publish: false });
    expect((await as(r).post(`/api/jobs/${draft.id}/status`).send({ status: "OPEN" }).expect(409)).body.code).toBe("JOB_CAP_REACHED");
    await as(r).post(`/api/jobs/${a.id}/status`).send({ status: "CLOSED" }).expect(200);
    await as(r).post(`/api/jobs/${draft.id}/status`).send({ status: "OPEN" }).expect(200);
    // Closing and reopening does not walk past the cap.
    expect((await as(r).post(`/api/jobs/${a.id}/status`).send({ status: "OPEN" }).expect(409)).body.code).toBe("JOB_CAP_REACHED");
    // The cap is per company: a teammate shares it, another company does not.
    expect((await as(await teammate(r)).post("/api/jobs").send({ title: "Teammate Role", description: DESCRIPTION, employmentType: "FULL_TIME", workplaceType: "REMOTE", publish: true }).expect(409)).body.code).toBe("JOB_CAP_REACHED");
    await makeJob(await makeCompanyRecruiter());
  });

  test("concurrent publishes cannot both slip under the cap", async () => {
    await setSettings({ recruiter: { maxOpenJobsPerCompany: 1 } });
    const r = await makeCompanyRecruiter();
    const body = { title: "Racing Role", description: DESCRIPTION, employmentType: "FULL_TIME", workplaceType: "REMOTE", publish: true };
    const res = await Promise.all([as(r).post("/api/jobs").send(body), as(r).post("/api/jobs").send(body), as(r).post("/api/jobs").send(body)]);
    expect(res.map((x) => x.status).sort()).toEqual([201, 409, 409]);
  });

  test("an operator closes an open job; the company's open count follows", async () => {
    const r = await makeCompanyRecruiter();
    const job = await makeJob(r);
    const ops = await operator("RECRUITER_OPS");
    await as(ops).post(`/api/admin/jobs/${job.id}/close`).send({ reason: "Duplicate posting" }).expect(204);
    expect((await as(ops).post(`/api/admin/jobs/${job.id}/close`).send({ reason: "Again" }).expect(409)).body.code).toBe("JOB_NOT_OPEN");
    expect((await db.selectFrom("companies").select("open_job_count").where("id", "=", r.company.id).executeTakeFirstOrThrow()).open_job_count).toBe(0);
  });
});

describe("search", () => {
  test("filters: text, location (remote always matches), workplace, employment, seniority, skills, company, salary", async () => {
    const r = await makeCompanyRecruiter();
    const tag = uniq("zq");
    const remote = await makeJob(r, { title: `Remote ${tag} Engineer`, workplaceType: "REMOTE", employmentType: "CONTRACT", skills: ["Kotlin"], seniority: "SENIOR", salary: { min: 80000, max: 100000, currency: "EUR", period: "YEAR" } });
    const onsite = await makeJob(r, { title: `Onsite ${tag} Analyst`, workplaceType: "ONSITE", location: "Aveiro, Portugal", employmentType: "FULL_TIME", skills: ["SQL"], seniority: "ENTRY", salary: { min: 30000, max: 40000, currency: "EUR", period: "YEAR" } });
    const draft = await makeJob(r, { title: `Draft ${tag} Role`, publish: false });
    const search = async (q: Record<string, string | number>) => ids((await anon().get("/api/jobs").query({ company: r.company.slug, ...q }).expect(200)).body.items).sort();

    expect(await search({})).toEqual([remote.id, onsite.id].sort());
    expect(await search({ q: tag })).toEqual([remote.id, onsite.id].sort());
    expect(await search({ q: "analyst" })).toEqual([onsite.id]);
    expect(await search({ location: "aveiro" })).toEqual([remote.id, onsite.id].sort());
    expect(await search({ location: "Nowhere Town" })).toEqual([remote.id]);
    expect(await search({ workplace: "ONSITE" })).toEqual([onsite.id]);
    expect(await search({ employment: "CONTRACT,FULL_TIME" })).toEqual([remote.id, onsite.id].sort());
    expect(await search({ employment: "CONTRACT" })).toEqual([remote.id]);
    expect(await search({ seniority: "ENTRY" })).toEqual([onsite.id]);
    expect(await search({ skills: "kotlin" })).toEqual([remote.id]);
    expect(await search({ salaryMin: 50000 })).toEqual([remote.id]);
    expect(await search({ q: "50%_" })).toEqual([]);
    expect(await search({ sort: "relevance", q: "remote" })).toEqual([remote.id]);
    expect(ids((await anon().get("/api/jobs").query({ q: tag }).expect(200)).body.items)).not.toContain(draft.id);
    await anon().get("/api/jobs").query({ workplace: "MOON" }).expect(400);
  });

  test("keyset pagination walks every job once, newest first", async () => {
    const r = await makeCompanyRecruiter();
    const made: string[] = [];
    for (let i = 0; i < 5; i++) made.push((await makeJob(r)).id);
    const all = await allPages(async (cursor) => (await anon().get("/api/jobs").query({ company: r.company.slug, limit: 2, ...(cursor ? { cursor } : {}) }).expect(200)).body);
    expect(ids(all)).toEqual([...made].reverse());
  });

  test("recommended: open jobs sharing your skills, not ones you already applied to", async () => {
    const r = await makeCompanyRecruiter();
    const skill = `Skill${uniq("k")}`;
    const fit = await makeJob(r, { skills: [skill] });
    const cand = await makeProfile({ skills: [skill] });
    expect(ids((await as(cand).get("/api/jobs/recommended").expect(200)).body)).toContain(fit.id);
    const job = (await as(cand).get(`/api/jobs/${fit.id}`).expect(200)).body as Job;
    expect(job.viewer).toMatchObject({ matchScore: 100, matchedSkills: [skill], canManage: false, application: null });
    await apply(cand, fit.id);
    expect(ids((await as(cand).get("/api/jobs/recommended").expect(200)).body)).not.toContain(fit.id);
  });
});

describe("saved jobs", () => {
  test("save, list, unsave; a draft job of another company cannot be saved", async () => {
    const r = await makeCompanyRecruiter();
    const job = await makeJob(r);
    const draft = await makeJob(r, { publish: false });
    const u = await createUser();
    await as(u).put(`/api/jobs/${job.id}/save`).expect(204);
    await as(u).put(`/api/jobs/${job.id}/save`).expect(204);
    expect((await as(u).put(`/api/jobs/${draft.id}/save`).expect(404)).body.code).toBe("JOB_NOT_FOUND");
    const saved = (await as(u).get("/api/jobs/saved").expect(200)).body.items as Job[];
    expect(ids(saved)).toEqual([job.id]);
    expect(saved[0]!.viewer.saved).toBe(true);
    await as(u).delete(`/api/jobs/${job.id}/save`).expect(204);
    expect((await as(u).get("/api/jobs/saved").expect(200)).body.items).toEqual([]);
  });
});

describe("invitations to apply", () => {
  test("invite a published profile; they see it, respond, and an application through it is sourced INVITE", async () => {
    const r = await makeCompanyRecruiter();
    const job = await makeJob(r);
    const cand = await makeProfile();
    await as(r).post(`/api/jobs/${job.id}/invites`).send({ username: cand.username, message: "We would love your application" }).expect(204);
    expect((await as(r).post(`/api/jobs/${job.id}/invites`).send({ username: cand.username }).expect(409)).body.code).toBe("ALREADY_INVITED");
    expect((await notificationsOf(cand.id)).map((n) => n.type)).toContain("JOB_INVITE");
    const invites = (await as(cand).get("/api/jobs/invites").expect(200)).body;
    expect(invites).toHaveLength(1);
    expect(invites[0]).toMatchObject({ job: { id: job.id }, invitedBy: { id: r.id }, message: "We would love your application", status: "SENT" });
    expect((await as(cand).post(`/api/jobs/invites/${invites[0].id}/respond`).send({ response: "VIEWED" }).expect(200)).body).toEqual({ jobId: job.id });
    expect((await as(cand).post(`/api/jobs/invites/${invites[0].id}/respond`).send({ response: "INTERESTED" }).expect(200)).body).toEqual({ jobId: job.id });
    expect((await as(cand).get("/api/jobs/invites").expect(200)).body[0].status).toBe("INTERESTED");
    // Someone else cannot answer it.
    await as(await createUser()).post(`/api/jobs/invites/${invites[0].id}/respond`).send({ response: "DECLINED" }).expect(404);
    const app = await apply(cand, job.id);
    expect((await as(r).get(`/api/applications/${app.id}`).expect(200)).body.source).toBe("INVITE");
    expect((await as(r).post(`/api/jobs/${job.id}/invites`).send({ username: (await makeProfile()).username }).expect(204)).status).toBe(204);
  });

  test("no invites to drafts, across blocks, to applicants, or for a job that is not open", async () => {
    const r = await makeCompanyRecruiter();
    const job = await makeJob(r);
    const draftProfile = await makeProfile({ status: "DRAFT" });
    expect((await as(r).post(`/api/jobs/${job.id}/invites`).send({ username: draftProfile.username }).expect(404)).body.code).toBe("PROFILE_NOT_FOUND");
    const blocker = await makeProfile();
    await as(blocker).post(`/api/users/${r.id}/block`).send({}).expect(204);
    expect((await as(r).post(`/api/jobs/${job.id}/invites`).send({ username: blocker.username }).expect(404)).body.code).toBe("PROFILE_NOT_FOUND");
    const applicant = await makeProfile();
    await apply(applicant, job.id);
    expect((await as(r).post(`/api/jobs/${job.id}/invites`).send({ username: applicant.username }).expect(409)).body.code).toBe("ALREADY_APPLIED");
    const draft = await makeJob(r, { publish: false });
    expect((await as(r).post(`/api/jobs/${draft.id}/invites`).send({ username: (await makeProfile()).username }).expect(400)).body.code).toBe("JOB_NOT_OPEN");
    expect((await as(await makeCompanyRecruiter()).post(`/api/jobs/${job.id}/invites`).send({ username: applicant.username }).expect(404)).body.code).toBe("JOB_NOT_FOUND");
  });
});
