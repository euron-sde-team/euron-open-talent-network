/**
 * Application rows to DTOs. Two views, never mixed:
 *   presentApplications    the hiring team (snapshot, answers, match, notes count,
 *                          average rating; `history` is filled by presentHistory for
 *                          the single-application endpoint only)
 *   presentMyApplications  the candidate (stage and timeline only: team notes and
 *                          ratings never reach them)
 */
import type { Application, ApplicationAnswer, MyApplication, ProfileSnapshot } from "@open-talent/types";
import type { Selectable } from "kysely";
import { sql } from "kysely";
import { db, type Executor } from "../db/kysely";
import type { Applications } from "../db/types";
import { readQuestions } from "../domain/screening";
import { presentJobs } from "./job.presenter";
import { loadMedia } from "./media.presenter";
import { loadSummaries } from "./user.presenter";
import type { Actor } from "../core/context";

export type ApplicationRow = Selectable<Applications>;

const DELETED = { username: "deleted", displayName: "Deleted user", avatarUrl: null, headline: null, role: "USER" as const, openToWork: false, recruiterAt: null };

export async function presentApplications(rows: readonly ApplicationRow[], exec: Executor = db): Promise<Application[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [jobs, people, resumes, notes] = await Promise.all([
    exec.selectFrom("jobs").select(["id", "title", "screening_questions"]).where("id", "in", [...new Set(rows.map((r) => r.job_id))]).execute(),
    loadSummaries(rows.map((r) => r.candidate_id), exec),
    loadMedia(rows.map((r) => r.resume_upload_id), exec),
    sql<{ application_id: string; n: number; avg: number | null }>`
      SELECT application_id, count(*)::int AS n, avg(rating)::float8 AS avg FROM candidate_notes
       WHERE application_id = ANY(${ids}::text[]) GROUP BY application_id`.execute(exec),
  ]);
  const jobById = new Map(jobs.map((j) => [j.id, j]));
  const noteBy = new Map(notes.rows.map((n) => [n.application_id, n]));
  return rows.map((r): Application => {
    const job = jobById.get(r.job_id);
    const prompts = new Map(readQuestions(job?.screening_questions).map((q) => [q.id, q.prompt]));
    const answers = (Array.isArray(r.answers) ? (r.answers as unknown as ApplicationAnswer[]) : []).map((a) => ({ ...a, prompt: prompts.get(a.questionId) ?? "" }));
    const detail = (r.match_detail ?? null) as { matched: string[]; missing: string[] } | null;
    const n = noteBy.get(r.id);
    return {
      id: r.id,
      job: { id: r.job_id, title: job?.title ?? "" },
      candidate: people.get(r.candidate_id) ?? { id: r.candidate_id, ...DELETED },
      source: r.source,
      stage: r.stage,
      snapshot: r.profile_snapshot as unknown as ProfileSnapshot,
      resume: r.resume_upload_id ? (resumes.get(r.resume_upload_id) ?? null) : null,
      coverNote: r.cover_note,
      answers,
      matchScore: r.match_score,
      matchDetail: detail,
      rejectionReason: r.rejection_reason,
      threadId: r.thread_id,
      noteCount: n?.n ?? 0,
      averageRating: n?.avg === null || n?.avg === undefined ? null : Math.round(n.avg * 10) / 10,
      stageChangedAt: r.stage_changed_at.toISOString(),
      createdAt: r.created_at.toISOString(),
      history: [],
    };
  });
}

/**
 * The stage history of one application, oldest first (team view only). `by` is the
 * teammate who moved it; null for the candidate's own steps (applying, withdrawing) and
 * for the system. `reason` is the rejection reason on the rejection that stands (the
 * application keeps only the latest one), otherwise the team note left with the move.
 */
export async function presentHistory(row: ApplicationRow, exec: Executor = db): Promise<Application["history"]> {
  const events = await exec
    .selectFrom("application_events")
    .select(["actor_id", "to_stage", "note", "created_at"])
    .where("application_id", "=", row.id)
    .orderBy("created_at")
    .orderBy("id")
    .execute();
  const teamActor = (id: string | null) => (id && id !== row.candidate_id ? id : null);
  const people = await loadSummaries(events.map((e) => teamActor(e.actor_id)), exec);
  const standingRejection = row.stage === "REJECTED" ? events.findLastIndex((e) => e.to_stage === "REJECTED") : -1;
  return events.map((e, i) => {
    const by = teamActor(e.actor_id);
    return {
      stage: e.to_stage,
      at: e.created_at.toISOString(),
      by: by ? (people.get(by) ?? null) : null,
      reason: (i === standingRejection ? row.rejection_reason : null) ?? e.note,
    };
  });
}

export async function presentMyApplications(viewer: Actor, rows: readonly ApplicationRow[], exec: Executor = db): Promise<MyApplication[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [jobRows, events] = await Promise.all([
    exec.selectFrom("jobs").selectAll().where("id", "in", [...new Set(rows.map((r) => r.job_id))]).execute(),
    exec.selectFrom("application_events").select(["application_id", "to_stage", "created_at"]).where("application_id", "in", ids).orderBy("created_at").execute(),
  ]);
  const jobs = new Map((await presentJobs(viewer, jobRows, exec)).map((j) => [j.id, j]));
  return rows
    .filter((r) => jobs.has(r.job_id))
    .map((r) => {
      const j = jobs.get(r.job_id)!;
      return {
        id: r.id,
        job: { id: j.id, title: j.title, company: j.company, location: j.location, workplaceType: j.workplaceType, employmentType: j.employmentType, status: j.status },
        stage: r.stage,
        timeline: events.filter((e) => e.application_id === r.id).map((e) => ({ stage: e.to_stage, at: e.created_at.toISOString() })),
        threadId: r.thread_id,
        createdAt: r.created_at.toISOString(),
      };
    });
}
