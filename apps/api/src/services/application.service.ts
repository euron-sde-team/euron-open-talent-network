/**
 * Applications and the hiring pipeline.
 *
 * Easy Apply sends a snapshot of the candidate's profile (what the team reviews even if
 * the profile changes later), an optional resume upload, screening answers and a cover
 * note. One application per job per person. A skill match score is stored with it.
 *
 * The team (ACTIVE recruiters of the job's company) moves cards through the stages
 * (domain/pipeline.ts decides what is allowed), adds private notes and ratings, and can
 * open a conversation with the candidate. Every move is an application_events row: the
 * candidate sees the stage and time, never the note. Moves reach the candidate
 * ("application:stage") and the job's open pipeline boards ("pipeline:card") live.
 */
import type { Application, ApplicationStage, CandidateNote, MyApplication, Page, PipelineColumn, ProfileSnapshot } from "@open-talent/types";
import { APPLICATION_STAGES } from "@open-talent/types";
import { sql } from "kysely";
import type { Actor } from "../core/context";
import { requireActive } from "../core/context";
import { withEffects, withTransaction, type Effects } from "../core/effects";
import { badRequest, conflict, HttpError, notFound } from "../core/errors";
import { newId } from "../core/ids";
import { db, type Executor } from "../db/kysely";
import { toYearMonth } from "../domain/months";
import { canMoveStage, matchScore, STAGE_COPY } from "../domain/pipeline";
import { checkAnswers, readQuestions } from "../domain/screening";
import { consume } from "../middleware/rate-limit";
import { presentApplications, presentHistory, presentMyApplications, type ApplicationRow } from "../presenters/application.presenter";
import { loadSummaries, summaryOf } from "../presenters/user.presenter";
import { realtime, rooms } from "../realtime/port";
import { atKey, decodeTime, encodeTime, olderThan, pageBy } from "../repositories/keyset";
import { isBlockedEitherWay } from "../repositories/visibility";
import { audit } from "./audit.service";
import { openContextThread } from "./dm.service";
import { readableJob } from "./job.service";
import { claimSingle } from "./media-attach.service";
import { notify } from "./notification.service";
import { requireRecruiter, type ActiveRecruiter } from "./recruiter.service";

async function snapshotOf(userId: string, exec: Executor): Promise<{ snapshot: ProfileSnapshot; skills: string[] }> {
  const p = await exec.selectFrom("talent_profiles").select(["id", "headline", "location", "years_experience", "skill_names"]).where("user_id", "=", userId).executeTakeFirstOrThrow();
  const [experience, education] = await Promise.all([
    exec.selectFrom("profile_experiences").select(["title", "company_name", "start_month", "end_month"]).where("profile_id", "=", p.id).orderBy("position").limit(10).execute(),
    exec.selectFrom("profile_educations").select(["institution", "degree", "field", "end_year"]).where("profile_id", "=", p.id).orderBy("position").limit(5).execute(),
  ]);
  const skills = p.skill_names.map(String);
  return {
    skills,
    snapshot: {
      headline: p.headline,
      location: p.location,
      yearsExperience: p.years_experience,
      experience: experience.map((e) => ({ title: e.title, companyName: e.company_name, startMonth: toYearMonth(e.start_month) as string, endMonth: toYearMonth(e.end_month) })),
      education: education.map((e) => ({ institution: e.institution, degree: e.degree, field: e.field, endYear: e.end_year })),
      skills,
    },
  };
}

function emitCard(fx: Effects, jobId: string, applicationId: string, movedBy: string | null): void {
  fx.after(async () => {
    const row = await db.selectFrom("applications").selectAll().where("id", "=", applicationId).executeTakeFirst();
    if (!row) return;
    const [application] = await presentApplications([row]);
    const by = movedBy ? await summaryOf(movedBy) : null;
    if (application) realtime.emit([rooms.job(jobId)], "pipeline:card", { jobId, application, movedBy: by });
  });
}

// ─── Candidate side ─────────────────────────────────────────────────────────

export interface ApplyInput {
  coverNote?: string | null;
  answers?: { questionId: string; answer: string }[];
  resumeUploadId?: string | null;
}

export async function apply(actor: Actor, jobId: string, input: ApplyInput): Promise<MyApplication> {
  requireActive(actor);
  await consume("apply", `u:${actor.id}`, 50, 86400);
  const resumeId = await claimSingle(actor.id, input.resumeUploadId ?? null, "RESUME");
  const row = await withTransaction(async (trx, fx) => {
    const job = await readableJob(actor, jobId, trx);
    if (job.status !== "OPEN" || job.content_status !== "PUBLISHED") throw conflict("This job is not accepting applications", "JOB_NOT_OPEN");
    if (job.closes_at && job.closes_at <= new Date()) throw conflict("Applications for this job have closed", "JOB_NOT_OPEN");
    const ownCompany = await trx.selectFrom("recruiters").select("id").where("user_id", "=", actor.id).where("company_id", "=", job.company_id).where("status", "in", ["ACTIVE", "PENDING_REVIEW"]).executeTakeFirst();
    if (ownCompany) throw badRequest("You recruit for this company", "OWN_COMPANY");
    const poster = await trx.selectFrom("recruiters").select("user_id").where("id", "=", job.posted_by).executeTakeFirst();
    if (poster && (await isBlockedEitherWay(actor.id, poster.user_id, trx))) throw notFound("Job not found", "JOB_NOT_FOUND");

    const answers = input.answers ?? [];
    const problems = checkAnswers(readQuestions(job.screening_questions), answers);
    if (problems.length) throw new HttpError(422, "Some screening questions need an answer", "ANSWERS_INVALID", { problems });

    const { snapshot, skills } = await snapshotOf(actor.id, trx);
    const match = matchScore(job.skills.map(String), skills);
    const invite = await trx.selectFrom("job_invites").select("id").where("job_id", "=", job.id).where("candidate_id", "=", actor.id).executeTakeFirst();
    const approach = await trx.selectFrom("approaches").select("id").where("job_id", "=", job.id).where("candidate_id", "=", actor.id).where("status", "=", "ACCEPTED").executeTakeFirst();
    const app = await trx
      .insertInto("applications")
      .values({
        id: newId(),
        job_id: job.id,
        company_id: job.company_id,
        candidate_id: actor.id,
        source: invite ? "INVITE" : approach ? "APPROACH" : "DIRECT",
        profile_snapshot: JSON.stringify(snapshot),
        resume_upload_id: resumeId,
        cover_note: input.coverNote ?? null,
        answers: JSON.stringify(answers.map((a) => ({ questionId: a.questionId, answer: a.answer.trim() }))),
        match_score: match.score,
        match_detail: match.score === null ? null : JSON.stringify({ matched: match.matched, missing: match.missing }),
      })
      .onConflict((oc) => oc.columns(["job_id", "candidate_id"]).doNothing())
      .returningAll()
      .executeTakeFirst();
    if (!app) throw conflict("You have already applied to this job", "ALREADY_APPLIED");
    await trx.insertInto("application_events").values({ id: newId(), application_id: app.id, actor_id: actor.id, from_stage: null, to_stage: "APPLIED" }).execute();
    await trx.updateTable("jobs").set({ application_count: sql`application_count + 1` }).where("id", "=", job.id).execute();
    if (invite) await trx.updateTable("job_invites").set({ status: "INTERESTED", responded_at: new Date() }).where("id", "=", invite.id).execute();
    if (poster) await notify({ recipientId: poster.user_id, actorId: actor.id, type: "APPLICATION_RECEIVED", entityType: "application", entityId: app.id, snippet: job.title, data: { jobId: job.id } }, fx, trx);
    emitCard(fx, job.id, app.id, null);
    return app;
  });
  return (await presentMyApplications(actor, [row]))[0]!;
}

export async function myApplications(actor: Actor, q: { cursor?: string; limit: number; open?: boolean }): Promise<Page<MyApplication>> {
  let query = db.selectFrom("applications as a").selectAll("a").select(atKey("a.created_at")).where("a.candidate_id", "=", actor.id);
  if (q.open) query = query.where("a.stage", "in", ["APPLIED", "SCREENING", "INTERVIEW", "OFFER"]);
  const rows = await query.where(olderThan("a.created_at", "a.id", decodeTime(q.cursor))).orderBy("a.created_at", "desc").orderBy("a.id", "desc").limit(q.limit + 1).execute();
  const page = pageBy(rows, q.limit, (r) => encodeTime(r._at, r.id));
  return { items: await presentMyApplications(actor, page.items), nextCursor: page.nextCursor };
}

export async function withdraw(actor: Actor, id: string): Promise<MyApplication> {
  const row = await withTransaction(async (trx, fx) => {
    const app = await trx.selectFrom("applications").selectAll().where("id", "=", id).where("candidate_id", "=", actor.id).forUpdate().executeTakeFirst();
    if (!app) throw notFound("Application not found", "APPLICATION_NOT_FOUND");
    const d = canMoveStage(app.stage, "WITHDRAWN", "CANDIDATE");
    if (!d.allowed) throw conflict("This application can no longer be withdrawn", d.code);
    const updated = await trx.updateTable("applications").set({ stage: "WITHDRAWN", stage_changed_at: new Date(), updated_at: new Date() }).where("id", "=", app.id).where("stage", "=", app.stage).returningAll().executeTakeFirst();
    if (!updated) throw conflict("This application changed meanwhile; refresh", "APPLICATION_CHANGED");
    await trx.insertInto("application_events").values({ id: newId(), application_id: app.id, actor_id: actor.id, from_stage: app.stage, to_stage: "WITHDRAWN" }).execute();
    await trx.updateTable("jobs").set({ application_count: sql`greatest(0, application_count - 1)` }).where("id", "=", app.job_id).execute();
    emitCard(fx, app.job_id, app.id, actor.id);
    return updated;
  });
  return (await presentMyApplications(actor, [row]))[0]!;
}

// ─── Team side ──────────────────────────────────────────────────────────────

async function teamApplication(r: ActiveRecruiter, id: string, exec: Executor, lock = false): Promise<ApplicationRow> {
  let q = exec.selectFrom("applications").selectAll().where("id", "=", id).where("company_id", "=", r.company_id);
  if (lock) q = q.forUpdate();
  const app = await q.executeTakeFirst();
  if (!app) throw notFound("Application not found", "APPLICATION_NOT_FOUND");
  return app;
}

async function teamJobId(r: ActiveRecruiter, jobId: string, exec: Executor = db): Promise<void> {
  const job = await exec.selectFrom("jobs").select("id").where("id", "=", jobId).where("company_id", "=", r.company_id).executeTakeFirst();
  if (!job) throw notFound("Job not found", "JOB_NOT_FOUND");
}

/** The kanban board: every stage with its count and its first `perStage` cards (most recently moved first). */
export async function pipeline(actor: Actor, jobId: string, perStage = 30): Promise<PipelineColumn[]> {
  const r = await requireRecruiter(actor);
  await teamJobId(r, jobId);
  const counts = await db.selectFrom("applications").select(["stage", (eb) => eb.fn.countAll<number>().as("n")]).where("job_id", "=", jobId).groupBy("stage").execute();
  const rows = await sql<ApplicationRow>`
    SELECT a.* FROM (
      SELECT a.*, row_number() OVER (PARTITION BY a.stage ORDER BY a.stage_changed_at DESC, a.id DESC) AS rn
        FROM applications a WHERE a.job_id = ${jobId}
    ) a WHERE a.rn <= ${perStage}`.execute(db);
  const dtos = await presentApplications(rows.rows);
  const countBy = new Map(counts.map((c) => [c.stage, Number(c.n)]));
  return APPLICATION_STAGES.map((stage) => ({ stage, count: countBy.get(stage) ?? 0, items: dtos.filter((d) => d.stage === stage) }));
}

/** One stage, paged (for columns with more cards than the board shows). */
export async function stagePage(actor: Actor, jobId: string, stage: ApplicationStage, q: { cursor?: string; limit: number }): Promise<Page<Application>> {
  const r = await requireRecruiter(actor);
  await teamJobId(r, jobId);
  const rows = await db
    .selectFrom("applications as a")
    .selectAll("a")
    .select(atKey("a.stage_changed_at"))
    .where("a.job_id", "=", jobId)
    .where("a.stage", "=", stage)
    .where(olderThan("a.stage_changed_at", "a.id", decodeTime(q.cursor)))
    .orderBy("a.stage_changed_at", "desc")
    .orderBy("a.id", "desc")
    .limit(q.limit + 1)
    .execute();
  const page = pageBy(rows, q.limit, (x) => encodeTime(x._at, x.id));
  return { items: await presentApplications(page.items), nextCursor: page.nextCursor };
}

export async function getForTeam(actor: Actor, id: string): Promise<Application> {
  const r = await requireRecruiter(actor);
  const row = await teamApplication(r, id, db);
  const [[application], history] = await Promise.all([presentApplications([row]), presentHistory(row)]);
  return { ...application!, history };
}

export interface MoveInput {
  to: ApplicationStage;
  reason?: string | null;
  note?: string | null;
}

async function moveOne(actor: Actor, r: ActiveRecruiter, id: string, input: MoveInput, trx: Executor, fx: Effects): Promise<ApplicationRow> {
  const app = await teamApplication(r, id, trx, true);
  const d = canMoveStage(app.stage, input.to, "TEAM", { reason: input.reason });
  if (!d.allowed) throw conflict(d.code === "REASON_REQUIRED" ? "Give a reason for rejecting" : `Cannot move from ${app.stage} to ${input.to}`, d.code);
  const now = new Date();
  const updated = await trx
    .updateTable("applications")
    .set({ stage: input.to, stage_changed_at: now, updated_at: now, rejection_reason: input.to === "REJECTED" ? (input.reason ?? null) : null })
    .where("id", "=", app.id)
    .where("stage", "=", app.stage)
    .returningAll()
    .executeTakeFirst();
  if (!updated) throw conflict("This card moved meanwhile; refresh", "APPLICATION_CHANGED");
  await trx.insertInto("application_events").values({ id: newId(), application_id: app.id, actor_id: actor.id, from_stage: app.stage, to_stage: input.to, note: input.note ?? null }).execute();
  const job = await trx.selectFrom("jobs").select(["id", "title"]).where("id", "=", app.job_id).executeTakeFirstOrThrow();
  await notify({ recipientId: app.candidate_id, actorId: null, type: "APPLICATION_STAGE", entityType: "application", entityId: app.id, snippet: `${job.title}: ${STAGE_COPY[input.to]}`, data: { jobId: job.id, stage: input.to } }, fx, trx);
  fx.emit([rooms.user(app.candidate_id)], "application:stage", { applicationId: app.id, jobId: job.id, stage: input.to, at: now.toISOString() });
  emitCard(fx, app.job_id, app.id, actor.id);
  return updated;
}

export async function move(actor: Actor, id: string, input: MoveInput): Promise<Application> {
  const r = await requireRecruiter(actor);
  const row = await withTransaction(async (trx, fx) => {
    const updated = await moveOne(actor, r, id, input, trx, fx);
    await audit({ actorId: actor.id, action: "application.move", entityType: "application", entityId: id, data: { to: input.to } }, trx);
    return updated;
  });
  return (await presentApplications([row]))[0]!;
}

/** Move several cards at once (the bulk bar). All or nothing. */
export async function bulkMove(actor: Actor, ids: string[], input: MoveInput): Promise<Application[]> {
  const r = await requireRecruiter(actor);
  if (ids.length > 100) throw badRequest("At most 100 applications at a time", "TOO_MANY");
  const rows = await withTransaction(async (trx, fx) => {
    const out: ApplicationRow[] = [];
    for (const id of [...new Set(ids)]) out.push(await moveOne(actor, r, id, input, trx, fx));
    await audit({ actorId: actor.id, action: "application.bulk_move", entityType: "job", entityId: out[0]?.job_id ?? null, data: { to: input.to, count: out.length } }, trx);
    return out;
  });
  return presentApplications(rows);
}

// ─── Team notes ─────────────────────────────────────────────────────────────

export async function addNote(actor: Actor, input: { applicationId?: string; candidateId?: string; body: string; rating?: number | null }): Promise<CandidateNote> {
  const r = await requireRecruiter(actor);
  let candidateId = input.candidateId;
  let jobId: string | null = null;
  if (input.applicationId) {
    const app = await teamApplication(r, input.applicationId, db);
    candidateId = app.candidate_id;
    jobId = app.job_id;
  }
  if (!candidateId) throw badRequest("Say which candidate the note is about", "CANDIDATE_REQUIRED");
  const row = await db
    .insertInto("candidate_notes")
    .values({ id: newId(), company_id: r.company_id, candidate_id: candidateId, application_id: input.applicationId ?? null, author_id: actor.id, body: input.body, rating: input.rating ?? null })
    .returningAll()
    .executeTakeFirstOrThrow();
  if (jobId && input.applicationId) await withEffects(async (fx) => emitCard(fx, jobId, input.applicationId as string, actor.id));
  const author = await summaryOf(actor.id);
  return { id: row.id, author: author!, applicationId: row.application_id, body: row.body, rating: row.rating, createdAt: row.created_at.toISOString() };
}

/** The team's notes about a candidate (all applications, plus general notes). */
export async function notes(actor: Actor, candidateId: string): Promise<CandidateNote[]> {
  const r = await requireRecruiter(actor);
  const rows = await db.selectFrom("candidate_notes").selectAll().where("company_id", "=", r.company_id).where("candidate_id", "=", candidateId).orderBy("created_at", "desc").limit(200).execute();
  const authors = await loadSummaries(rows.map((n) => n.author_id));
  return rows.filter((n) => authors.has(n.author_id)).map((n) => ({ id: n.id, author: authors.get(n.author_id)!, applicationId: n.application_id, body: n.body, rating: n.rating, createdAt: n.created_at.toISOString() }));
}

/** Open (or find) the conversation about an application. Either the team or the candidate can start it. */
export async function openThread(actor: Actor, id: string): Promise<{ threadId: string }> {
  requireActive(actor);
  return withTransaction(async (trx) => {
    const app = await trx.selectFrom("applications").selectAll().where("id", "=", id).forUpdate().executeTakeFirst();
    if (!app) throw notFound("Application not found", "APPLICATION_NOT_FOUND");
    let other: string;
    if (app.candidate_id === actor.id) {
      const poster = await trx.selectFrom("jobs as j").innerJoin("recruiters as r", "r.id", "j.posted_by").select(["r.user_id", "r.status"]).where("j.id", "=", app.job_id).executeTakeFirstOrThrow();
      other = poster.user_id;
    } else {
      const r = await requireRecruiter(actor, trx);
      if (r.company_id !== app.company_id) throw notFound("Application not found", "APPLICATION_NOT_FOUND");
      other = app.candidate_id;
    }
    if (app.stage === "WITHDRAWN") throw conflict("This application was withdrawn", "APPLICATION_WITHDRAWN");
    if (await isBlockedEitherWay(actor.id, other, trx)) throw notFound("Application not found", "APPLICATION_NOT_FOUND");
    const threadId = await openContextThread(actor.id, other, "APPLICATION", app.id, trx);
    await trx.updateTable("applications").set({ thread_id: threadId }).where("id", "=", app.id).execute();
    return { threadId };
  });
}
