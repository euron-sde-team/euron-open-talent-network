/**
 * Job rows to DTOs for one viewer, batched: companies, posters, the viewer's saved
 * flags, their own applications and skill match (from their profile's skill list).
 */
import type { Job } from "@open-talent/types";
import type { Selectable } from "kysely";
import type { Actor } from "../core/context";
import { db, type Executor } from "../db/kysely";
import type { Jobs } from "../db/types";
import { matchScore } from "../domain/pipeline";
import { readQuestions } from "../domain/screening";
import { loadMedia, urlOf } from "./media.presenter";
import { loadSummaries } from "./user.presenter";

export type JobRow = Selectable<Jobs>;

export async function presentJobs(viewer: Actor | null, rows: readonly JobRow[], exec: Executor = db): Promise<Job[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [companies, posters, saved, applications, profile, team] = await Promise.all([
    exec.selectFrom("companies").select(["id", "slug", "name", "logo_upload_id", "status"]).where("id", "in", [...new Set(rows.map((r) => r.company_id))]).execute(),
    exec.selectFrom("recruiters").select(["id", "user_id"]).where("id", "in", [...new Set(rows.map((r) => r.posted_by))]).execute(),
    viewer ? exec.selectFrom("saved_jobs").select("job_id").where("user_id", "=", viewer.id).where("job_id", "in", ids).execute() : Promise.resolve([]),
    viewer ? exec.selectFrom("applications").select(["id", "job_id", "stage", "created_at"]).where("candidate_id", "=", viewer.id).where("job_id", "in", ids).execute() : Promise.resolve([]),
    viewer ? exec.selectFrom("talent_profiles").select("skill_names").where("user_id", "=", viewer.id).executeTakeFirst() : Promise.resolve(undefined),
    viewer ? exec.selectFrom("recruiters").select("company_id").where("user_id", "=", viewer.id).where("status", "=", "ACTIVE").executeTakeFirst() : Promise.resolve(undefined),
  ]);
  const [logos, people] = await Promise.all([loadMedia(companies.map((c) => c.logo_upload_id), exec), loadSummaries(posters.map((p) => p.user_id), exec)]);
  const companyById = new Map(companies.map((c) => [c.id, { id: c.id, slug: String(c.slug), name: c.name, logoUrl: urlOf(logos, c.logo_upload_id, "thumb"), status: c.status }]));
  const posterUser = new Map(posters.map((p) => [p.id, p.user_id]));
  const savedSet = new Set(saved.map((s) => s.job_id));
  const appByJob = new Map(applications.map((a) => [a.job_id, a]));
  const mySkills = (profile?.skill_names ?? []).map(String);

  return rows.map((r): Job => {
    const own = appByJob.get(r.id);
    const skills = r.skills.map(String);
    const match = viewer && mySkills.length ? matchScore(skills, mySkills) : { score: null, matched: [] as string[], missing: [] };
    return {
      id: r.id,
      company: companyById.get(r.company_id) ?? { id: r.company_id, slug: "", name: "Unknown company", logoUrl: null, status: "SUSPENDED" },
      title: r.title,
      description: r.description,
      employmentType: r.employment_type,
      workplaceType: r.workplace_type,
      seniority: r.seniority,
      location: r.location,
      countryCode: r.country_code,
      salary: r.salary_min !== null || r.salary_max !== null ? { min: r.salary_min, max: r.salary_max, currency: r.salary_currency, period: r.pay_period } : null,
      skills,
      openings: r.openings,
      screeningQuestions: readQuestions(r.screening_questions),
      status: r.status,
      applicationCount: r.application_count,
      openedAt: r.opened_at?.toISOString() ?? null,
      closesAt: r.closes_at?.toISOString() ?? null,
      createdAt: r.created_at.toISOString(),
      postedBy: people.get(posterUser.get(r.posted_by) ?? "") ?? null,
      viewer: {
        saved: savedSet.has(r.id),
        application: own ? { id: own.id, stage: own.stage, appliedAt: own.created_at.toISOString() } : null,
        matchScore: match.score,
        matchedSkills: match.matched,
        canManage: team?.company_id === r.company_id,
      },
    };
  });
}
