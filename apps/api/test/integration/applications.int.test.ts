/**
 * Easy Apply and the hiring pipeline: screening answers, the profile snapshot, the match
 * score, resumes by upload id, the candidate's own view and timeline, withdrawing, the
 * board, moves (single, bulk, concurrent), team-only access, the application thread and
 * live updates.
 */
import { describe, expect, test } from "vitest";
import type { Application, MyApplication, PipelineColumn } from "@open-talent/types";
import { db } from "../../src/db/kysely";
import { as, createUser, recordRealtime, type TestUser } from "./harness";
import { upload } from "./media-helpers";
import { allPages, apply, makeCompanyRecruiter, makeJob, makeProfile, notificationsOf, teammate, waitFor, type Recruiter } from "./talent-fixtures";

const PDF = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n");

/** Upload a small PDF through the API (works with local storage and with S3). */
async function uploadPdf(user: TestUser, purpose = "RESUME"): Promise<string> {
  return (await upload(user, purpose, "resume.pdf", "application/pdf", PDF)).uploadId;
}

async function world(jobOver: Parameters<typeof makeJob>[1] = {}) {
  const team = await makeCompanyRecruiter();
  const job = await makeJob(team, jobOver);
  const cand = await makeProfile();
  return { team, job, cand };
}

const move = (r: TestUser, id: string, body: Record<string, unknown>) => as(r).post(`/api/applications/${id}/move`).send(body);

describe("applying", () => {
  test("Easy Apply snapshots the profile, scores the skill match and notifies the poster", async () => {
    const { team, job, cand } = await world({ skills: ["TypeScript", "PostgreSQL", "Kafka"] });
    const live = recordRealtime();
    const mine = await apply(cand, job.id, { coverNote: "I would enjoy this" });
    expect(mine).toMatchObject({ stage: "APPLIED", job: { id: job.id, title: job.title }, threadId: null });
    expect(mine.timeline).toEqual([{ stage: "APPLIED", at: expect.any(String) }]);
    const full = (await as(team).get(`/api/applications/${mine.id}`).expect(200)).body as Application;
    expect(full).toMatchObject({ source: "DIRECT", stage: "APPLIED", coverNote: "I would enjoy this", matchScore: 67, matchDetail: { matched: ["TypeScript", "PostgreSQL"], missing: ["Kafka"] } });
    expect(full.snapshot).toMatchObject({ headline: cand.profile.headline, skills: expect.arrayContaining(["TypeScript", "PostgreSQL", "Redis"]) });
    expect(full.snapshot.experience[0]).toMatchObject({ title: "Software Engineer", companyName: "Fictional Systems", startMonth: "2019-03", endMonth: null });
    expect((await notificationsOf(team.id)).map((n) => n.type)).toContain("APPLICATION_RECEIVED");
    expect((await db.selectFrom("jobs").select("application_count").where("id", "=", job.id).executeTakeFirstOrThrow()).application_count).toBe(1);
    await waitFor(() => live.to(`job:${job.id}`, "pipeline:card").length > 0);
    // The snapshot stays as it was when they applied.
    await as(cand).patch("/api/profiles/me").send({ headline: "A completely new headline" }).expect(200);
    expect((await as(team).get(`/api/applications/${mine.id}`).expect(200)).body.snapshot.headline).toBe(cand.profile.headline);
    const viewerJob = (await as(cand).get(`/api/jobs/${job.id}`).expect(200)).body;
    expect(viewerJob.viewer.application).toMatchObject({ id: mine.id, stage: "APPLIED" });
  });

  test("once per job; not to your own company; not to closed, draft or expired jobs", async () => {
    const { team, job, cand } = await world();
    await apply(cand, job.id);
    expect((await as(cand).post(`/api/jobs/${job.id}/apply`).send({}).expect(409)).body.code).toBe("ALREADY_APPLIED");
    expect((await as(await teammate(team)).post(`/api/jobs/${job.id}/apply`).send({}).expect(400)).body.code).toBe("OWN_COMPANY");

    const closed = await makeJob(team);
    await as(team).post(`/api/jobs/${closed.id}/status`).send({ status: "CLOSED" }).expect(200);
    expect((await as(cand).post(`/api/jobs/${closed.id}/apply`).send({}).expect(409)).body.code).toBe("JOB_NOT_OPEN");
    const draft = await makeJob(team, { publish: false });
    expect((await as(cand).post(`/api/jobs/${draft.id}/apply`).send({}).expect(404)).body.code).toBe("JOB_NOT_FOUND");
    const expiring = await makeJob(team, { closesAt: new Date(Date.now() + 86400_000).toISOString() });
    await db.updateTable("jobs").set({ closes_at: new Date(Date.now() - 1000) }).where("id", "=", expiring.id).execute();
    expect((await as(cand).post(`/api/jobs/${expiring.id}/apply`).send({}).expect(409)).body.code).toBe("JOB_NOT_OPEN");
  });

  test("screening answers are checked against the job's questions", async () => {
    const { team, job, cand } = await world({
      screeningQuestions: [
        { prompt: "Can you work in the EU?", kind: "YES_NO", required: true },
        { prompt: "Anything else?", kind: "TEXT", required: false },
      ],
    });
    const [yesNo, free] = job.screeningQuestions;
    const missing = await as(cand).post(`/api/jobs/${job.id}/apply`).send({}).expect(422);
    expect(missing.body).toMatchObject({ code: "ANSWERS_INVALID", details: { problems: [{ questionId: yesNo!.id, problem: "MISSING" }] } });
    const notYesNo = await as(cand).post(`/api/jobs/${job.id}/apply`).send({ answers: [{ questionId: yesNo!.id, answer: "maybe" }] }).expect(422);
    expect(notYesNo.body.details.problems).toEqual([{ questionId: yesNo!.id, problem: "NOT_YES_NO" }]);
    const unknown = await as(cand).post(`/api/jobs/${job.id}/apply`).send({ answers: [{ questionId: "01ARZ3NDEKTSV4RRFFQ69G5FAV", answer: "x" }, { questionId: yesNo!.id, answer: "YES" }] }).expect(422);
    expect(unknown.body.details.problems).toEqual([{ questionId: "01ARZ3NDEKTSV4RRFFQ69G5FAV", problem: "UNKNOWN_QUESTION" }]);
    const mine = await apply(cand, job.id, { answers: [{ questionId: yesNo!.id, answer: " YES " }, { questionId: free!.id, answer: "I like queues" }] });
    const full = (await as(team).get(`/api/applications/${mine.id}`).expect(200)).body as Application;
    expect(full.answers).toEqual([
      { questionId: yesNo!.id, answer: "YES", prompt: "Can you work in the EU?" },
      { questionId: free!.id, answer: "I like queues", prompt: "Anything else?" },
    ]);
  });

  test("a resume is attached by upload id: only your own RESUME upload", async () => {
    const { team, job, cand } = await world();
    const stranger = await createUser();
    const theirs = await uploadPdf(stranger);
    expect((await as(cand).post(`/api/jobs/${job.id}/apply`).send({ resumeUploadId: theirs }).expect(400)).body.code).toBe("MEDIA_INVALID");
    const wrongPurpose = await uploadPdf(cand, "EVIDENCE");
    expect((await as(cand).post(`/api/jobs/${job.id}/apply`).send({ resumeUploadId: wrongPurpose }).expect(400)).body.code).toBe("MEDIA_INVALID");
    const mine = await uploadPdf(cand);
    const a = await apply(cand, job.id, { resumeUploadId: mine });
    const full = (await as(team).get(`/api/applications/${a.id}`).expect(200)).body as Application;
    expect(full.resume).toMatchObject({ id: mine, kind: "PDF" });
  });

  test("an accepted approach about the job sources the application APPROACH", async () => {
    const { team, job, cand } = await world();
    const a = await as(team).post("/api/approaches").send({ username: cand.username, roleTitle: "Engineer", message: "We have an opening that matches your experience closely.", jobId: job.id }).expect(201);
    await as(cand).post(`/api/approaches/${a.body.id}/accept`).send({ channels: ["EMAIL"] }).expect(200);
    const mine = await apply(cand, job.id);
    expect((await as(team).get(`/api/applications/${mine.id}`).expect(200)).body.source).toBe("APPROACH");
  });
});

describe("the candidate's side", () => {
  test("mine lists applications with their timeline; open=true hides finished ones; no team notes", async () => {
    const team = await makeCompanyRecruiter();
    const [j1, j2] = [await makeJob(team), await makeJob(team)];
    const cand = await makeProfile();
    const a1 = await apply(cand, j1.id);
    const a2 = await apply(cand, j2.id);
    await move(team, a1.id, { to: "SCREENING", note: "Private: strong on queues" }).expect(200);
    await move(team, a1.id, { to: "INTERVIEW" }).expect(200);
    await move(team, a2.id, { to: "REJECTED", reason: "Role filled internally" }).expect(200);
    await as(team).post("/api/recruiter/notes").send({ applicationId: a1.id, body: "Team only: salary expectations high", rating: 4 }).expect(201);

    const all = (await as(cand).get("/api/applications/mine").expect(200)).body.items as MyApplication[];
    expect(all.map((x) => x.id)).toEqual([a2.id, a1.id]);
    const first = all.find((x) => x.id === a1.id)!;
    expect(first.timeline.map((t) => t.stage)).toEqual(["APPLIED", "SCREENING", "INTERVIEW"]);
    expect(first.timeline.every((t) => !Number.isNaN(Date.parse(t.at)))).toBe(true);
    const raw = JSON.stringify(all);
    expect(raw).not.toContain("Private: strong on queues");
    expect(raw).not.toContain("salary expectations");
    expect(raw).not.toContain("Role filled internally");
    expect((await as(cand).get("/api/applications/mine").query({ open: "true" }).expect(200)).body.items.map((x: MyApplication) => x.id)).toEqual([a1.id]);
    // The candidate cannot open the team view.
    expect((await as(cand).get(`/api/applications/${a1.id}`).expect(403)).body.code).toBe("RECRUITER_REQUIRED");
    // The team view carries the notes count and average.
    expect((await as(team).get(`/api/applications/${a1.id}`).expect(200)).body).toMatchObject({ noteCount: 1, averageRating: 4 });
  });

  test("withdraw from an open stage only; the team cannot withdraw for them", async () => {
    const { team, job, cand } = await world();
    const a = await apply(cand, job.id);
    expect((await move(team, a.id, { to: "WITHDRAWN" }).expect(409)).body.code).toBe("STAGE_NOT_ALLOWED");
    expect((await as(await createUser()).post(`/api/applications/${a.id}/withdraw`).send({}).expect(404)).body.code).toBe("APPLICATION_NOT_FOUND");
    const withdrawn = (await as(cand).post(`/api/applications/${a.id}/withdraw`).send({}).expect(200)).body as MyApplication;
    expect(withdrawn.stage).toBe("WITHDRAWN");
    // Withdrawing twice is the same stage; moving a withdrawn card is final.
    expect((await as(cand).post(`/api/applications/${a.id}/withdraw`).send({}).expect(409)).body.code).toBe("SAME_STAGE");
    expect((await move(team, a.id, { to: "SCREENING" }).expect(409)).body.code).toBe("STAGE_FINAL");
    expect((await db.selectFrom("jobs").select("application_count").where("id", "=", job.id).executeTakeFirstOrThrow()).application_count).toBe(0);

    const other = await makeProfile();
    const b = await apply(other, job.id);
    await move(team, b.id, { to: "REJECTED", reason: "Not a fit" }).expect(200);
    expect((await as(other).post(`/api/applications/${b.id}/withdraw`).send({}).expect(409)).body.code).toBe("STAGE_NOT_ALLOWED");
  });
});

describe("the pipeline", () => {
  test("moves follow the rules: forward, back, reject with a reason, reopen into SCREENING, HIRED is final", async () => {
    const { team, job, cand } = await world();
    const a = await apply(cand, job.id);
    expect((await move(team, a.id, { to: "APPLIED" }).expect(409)).body.code).toBe("SAME_STAGE");
    expect((await move(team, a.id, { to: "OFFER" }).expect(200)).body.stage).toBe("OFFER");
    expect((await move(team, a.id, { to: "SCREENING" }).expect(200)).body.stage).toBe("SCREENING");
    expect((await move(team, a.id, { to: "REJECTED" }).expect(409)).body.code).toBe("REASON_REQUIRED");
    expect((await move(team, a.id, { to: "REJECTED", reason: "   " }).expect(409)).body.code).toBe("REASON_REQUIRED");
    expect((await move(team, a.id, { to: "REJECTED", reason: "Went with another candidate" }).expect(200)).body).toMatchObject({ stage: "REJECTED", rejectionReason: "Went with another candidate" });
    expect((await move(team, a.id, { to: "INTERVIEW" }).expect(409)).body.code).toBe("STAGE_NOT_ALLOWED");
    expect((await move(team, a.id, { to: "SCREENING" }).expect(200)).body).toMatchObject({ stage: "SCREENING", rejectionReason: null });
    expect((await move(team, a.id, { to: "HIRED" }).expect(200)).body.stage).toBe("HIRED");
    expect((await move(team, a.id, { to: "OFFER" }).expect(409)).body.code).toBe("STAGE_FINAL");
    const events = await db.selectFrom("application_events").select(["from_stage", "to_stage", "actor_id"]).where("application_id", "=", a.id).orderBy("created_at").execute();
    expect(events.map((e) => e.to_stage)).toEqual(["APPLIED", "OFFER", "SCREENING", "REJECTED", "SCREENING", "HIRED"]);
    expect(events.slice(1).every((e) => e.actor_id === team.id)).toBe(true);
    expect((await db.selectFrom("audit_log").select("actor_id").where("entity_id", "=", a.id).where("action", "=", "application.move").execute()).length).toBe(5);
  });

  test("each move notifies the candidate and reaches their room and the job's board live", async () => {
    const { team, job, cand } = await world();
    const a = await apply(cand, job.id);
    const live = recordRealtime();
    await move(team, a.id, { to: "INTERVIEW" }).expect(200);
    expect(live.to(`user:${cand.id}`, "application:stage")).toEqual([{ applicationId: a.id, jobId: job.id, stage: "INTERVIEW", at: expect.any(String) }]);
    expect(live.emits.filter((e) => e.event === "application:stage").flatMap((e) => e.rooms)).toEqual([`user:${cand.id}`]);
    await waitFor(() => live.to(`job:${job.id}`, "pipeline:card").length === 1);
    const card = live.to(`job:${job.id}`, "pipeline:card")[0]!;
    expect(card).toMatchObject({ jobId: job.id, application: { id: a.id, stage: "INTERVIEW" }, movedBy: { id: team.id } });
    // The board event goes to the job room only, never to the candidate's room.
    expect(live.emits.filter((e) => e.event === "pipeline:card").flatMap((e) => e.rooms)).toEqual([`job:${job.id}`]);
    const n = (await notificationsOf(cand.id)).find((x) => x.type === "APPLICATION_STAGE");
    expect(n?.snippet).toBe(`${job.title}: Interviewing`);
  });

  test("the team detail carries the full stage history, oldest first; lists and moves send []", async () => {
    const { team, job, cand } = await world();
    const mate = await teammate(team, { displayName: "Morgan Mate" });
    const a = await apply(cand, job.id);
    await move(team, a.id, { to: "SCREENING", note: "Strong on queues" }).expect(200);
    await move(mate, a.id, { to: "REJECTED", reason: "Went with another candidate" }).expect(200);
    await move(team, a.id, { to: "SCREENING" }).expect(200);
    const moved = (await move(mate, a.id, { to: "REJECTED", reason: "Salary range too far apart", note: "Revisit next year" }).expect(200)).body as Application;
    expect(moved.history).toEqual([]);

    const detail = (await as(team).get(`/api/applications/${a.id}`).expect(200)).body as Application;
    expect(detail.history.map((h) => [h.stage, h.by?.id ?? null, h.reason])).toEqual([
      // Applying is the candidate's own step: no `by`.
      ["APPLIED", null, null],
      ["SCREENING", team.id, "Strong on queues"],
      // Only the standing rejection keeps its reason (the application stores the latest one).
      ["REJECTED", mate.id, null],
      ["SCREENING", team.id, null],
      ["REJECTED", mate.id, "Salary range too far apart"],
    ]);
    expect(detail.history[1]!.by).toMatchObject({ id: team.id, username: team.username });
    const at = detail.history.map((h) => Date.parse(h.at));
    expect(at.every((t, i) => !Number.isNaN(t) && (i === 0 || t >= at[i - 1]!))).toBe(true);

    // A withdrawal is the candidate's own step too.
    const other = await makeProfile();
    const b = await apply(other, job.id);
    await as(other).post(`/api/applications/${b.id}/withdraw`).send({}).expect(200);
    expect(((await as(mate).get(`/api/applications/${b.id}`).expect(200)).body as Application).history.map((h) => [h.stage, h.by])).toEqual([
      ["APPLIED", null],
      ["WITHDRAWN", null],
    ]);

    // Board and stage pages stay cheap.
    const board = (await as(team).get(`/api/jobs/${job.id}/pipeline`).expect(200)).body as PipelineColumn[];
    expect(board.flatMap((c) => c.items).every((x) => Array.isArray(x.history) && x.history.length === 0)).toBe(true);
    const page = (await as(team).get(`/api/jobs/${job.id}/pipeline/REJECTED`).expect(200)).body.items as Application[];
    expect(page.map((x) => x.history)).toEqual([[]]);

    // The candidate never sees the history, who moved them, or the team's notes.
    const mine = (await as(cand).get("/api/applications/mine").expect(200)).body.items as MyApplication[];
    const own = mine.find((x) => x.id === a.id)!;
    expect(own).not.toHaveProperty("history");
    expect(own.timeline.map((t) => t.stage)).toEqual(["APPLIED", "SCREENING", "REJECTED", "SCREENING", "REJECTED"]);
    for (const t of own.timeline) expect(Object.keys(t).sort()).toEqual(["at", "stage"]);
    const raw = JSON.stringify(mine);
    for (const secret of ["Strong on queues", "Revisit next year", "Salary range too far apart", "Morgan Mate", mate.id]) expect(raw).not.toContain(secret);
    expect((await as(cand).get(`/api/applications/${a.id}`).expect(403)).body.code).toBe("RECRUITER_REQUIRED");
    // Another company's recruiter cannot read it either.
    await as(await makeCompanyRecruiter()).get(`/api/applications/${a.id}`).expect(404);
  });

  test("the board counts every stage; a stage page walks its cards", async () => {
    const { team, job } = await world();
    const apps: MyApplication[] = [];
    for (let i = 0; i < 4; i++) apps.push(await apply(await makeProfile(), job.id));
    await move(team, apps[0]!.id, { to: "SCREENING" }).expect(200);
    await move(team, apps[1]!.id, { to: "SCREENING" }).expect(200);
    await move(team, apps[2]!.id, { to: "REJECTED", reason: "Not now" }).expect(200);
    const board = (await as(team).get(`/api/jobs/${job.id}/pipeline`).expect(200)).body as PipelineColumn[];
    expect(board.map((c) => c.stage)).toEqual(["APPLIED", "SCREENING", "INTERVIEW", "OFFER", "HIRED", "REJECTED", "WITHDRAWN"]);
    const count = Object.fromEntries(board.map((c) => [c.stage, c.count]));
    expect(count).toMatchObject({ APPLIED: 1, SCREENING: 2, INTERVIEW: 0, REJECTED: 1 });
    expect(board.find((c) => c.stage === "SCREENING")!.items.map((x) => x.id).sort()).toEqual([apps[0]!.id, apps[1]!.id].sort());
    const walked = await allPages(async (cursor) => (await as(team).get(`/api/jobs/${job.id}/pipeline/SCREENING`).query({ limit: 1, ...(cursor ? { cursor } : {}) }).expect(200)).body);
    expect(walked.map((x: Application) => x.id)).toEqual([apps[1]!.id, apps[0]!.id]);
  });

  test("bulk moves are all or nothing", async () => {
    const { team, job } = await world();
    const a = await apply(await makeProfile(), job.id);
    const b = await apply(await makeProfile(), job.id);
    const c = await apply(await makeProfile(), job.id);
    await move(team, c.id, { to: "HIRED" }).expect(200);
    const failed = await as(team).post("/api/applications/bulk-move").send({ ids: [a.id, b.id, c.id], to: "SCREENING" }).expect(409);
    expect(failed.body.code).toBe("STAGE_FINAL");
    const stages = await db.selectFrom("applications").select(["id", "stage"]).where("id", "in", [a.id, b.id]).execute();
    expect(stages.every((s) => s.stage === "APPLIED")).toBe(true);
    const ok = (await as(team).post("/api/applications/bulk-move").send({ ids: [a.id, b.id, a.id], to: "REJECTED", reason: "Closed the search" }).expect(200)).body as Application[];
    expect(ok.map((x) => x.stage)).toEqual(["REJECTED", "REJECTED"]);
    const foreign = await world();
    const theirs = await apply(foreign.cand, foreign.job.id);
    expect((await as(team).post("/api/applications/bulk-move").send({ ids: [theirs.id], to: "SCREENING" }).expect(404)).body.code).toBe("APPLICATION_NOT_FOUND");
    await as(team).post("/api/applications/bulk-move").send({ ids: [], to: "SCREENING" }).expect(400);
  });

  test("two concurrent moves of one card: exactly one wins", async () => {
    const { team, job, cand } = await world();
    const a = await apply(cand, job.id);
    const mate = await teammate(team);
    const res = await Promise.all([move(team, a.id, { to: "SCREENING" }), move(mate, a.id, { to: "SCREENING" })]);
    expect(res.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await db.selectFrom("application_events").select("id").where("application_id", "=", a.id).execute()).toHaveLength(2);
  });

  test("only the job's company team sees and moves its cards", async () => {
    const { team, job, cand } = await world();
    const a = await apply(cand, job.id);
    const other: Recruiter = await makeCompanyRecruiter();
    expect((await as(other).get(`/api/applications/${a.id}`).expect(404)).body.code).toBe("APPLICATION_NOT_FOUND");
    expect((await move(other, a.id, { to: "SCREENING" }).expect(404)).body.code).toBe("APPLICATION_NOT_FOUND");
    expect((await as(other).get(`/api/jobs/${job.id}/pipeline`).expect(404)).body.code).toBe("JOB_NOT_FOUND");
    expect((await as(other).get(`/api/jobs/${job.id}/pipeline/APPLIED`).expect(404)).body.code).toBe("JOB_NOT_FOUND");
    expect((await as(other).post("/api/recruiter/notes").send({ applicationId: a.id, body: "Snooping" }).expect(404)).body.code).toBe("APPLICATION_NOT_FOUND");
    expect((await as(cand).get(`/api/jobs/${job.id}/pipeline`).expect(403)).body.code).toBe("RECRUITER_REQUIRED");
    await as(team).get(`/api/jobs/${job.id}/pipeline`).expect(200);
    await move(team, a.id, { to: "SCREENING", candidateId: cand.id }).expect(400);
  });
});

describe("the application thread", () => {
  test("either side opens one conversation; it lets them message; withdrawn applications have none", async () => {
    const { team, job, cand } = await world();
    const a = await apply(cand, job.id);
    const before = (await as(cand).get(`/api/dms/eligibility/${team.id}`).expect(200)).body;
    expect(before.canMessage).toBe(true);
    const fromCand = (await as(cand).post(`/api/applications/${a.id}/thread`).send({}).expect(200)).body.threadId;
    const fromTeam = (await as(team).post(`/api/applications/${a.id}/thread`).send({}).expect(200)).body.threadId;
    expect(fromTeam).toBe(fromCand);
    const t = (await as(team).get(`/api/dms/threads/${fromCand}`).expect(200)).body;
    expect(t).toMatchObject({ context: "APPLICATION", viewerState: "ACTIVE", canSend: true });
    await as(team).post(`/api/dms/threads/${fromCand}/messages`).send({ body: "Thanks for applying, are you free Tuesday?" }).expect(201);
    await as(cand).post(`/api/dms/threads/${fromCand}/messages`).send({ body: "Tuesday works" }).expect(201);
    expect((await as(cand).get("/api/applications/mine").expect(200)).body.items[0].threadId).toBe(fromCand);
    // A stranger cannot open it.
    expect((await as(await createUser()).post(`/api/applications/${a.id}/thread`).send({}).expect(403)).body.code).toBe("RECRUITER_REQUIRED");
    expect((await as(await makeCompanyRecruiter()).post(`/api/applications/${a.id}/thread`).send({}).expect(404)).body.code).toBe("APPLICATION_NOT_FOUND");

    const other = await makeProfile();
    const b = await apply(other, job.id);
    await as(other).post(`/api/applications/${b.id}/withdraw`).send({}).expect(200);
    expect((await as(other).post(`/api/applications/${b.id}/thread`).send({}).expect(409)).body.code).toBe("APPLICATION_WITHDRAWN");
  });
});
