/** Approach rows to DTOs, batched (recruiters, candidates, companies, jobs, unlocks). */
import type { Approach } from "@open-talent/types";
import type { Selectable } from "kysely";
import type { Actor } from "../core/context";
import { db, type Executor } from "../db/kysely";
import type { Approaches } from "../db/types";
import { loadMedia, urlOf } from "./media.presenter";
import { loadSummaries } from "./user.presenter";

export type ApproachRow = Selectable<Approaches>;

const DELETED = { username: "deleted", displayName: "Deleted user", avatarUrl: null, headline: null, role: "USER" as const, openToWork: false, recruiterAt: null };

export async function presentApproaches(_viewer: Actor | null, rows: readonly ApproachRow[], exec: Executor = db): Promise<Approach[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [recruiters, companies, jobs, unlocks] = await Promise.all([
    exec.selectFrom("recruiters").select(["id", "user_id"]).where("id", "in", [...new Set(rows.map((r) => r.recruiter_id))]).execute(),
    exec.selectFrom("companies").select(["id", "slug", "name", "logo_upload_id", "status"]).where("id", "in", [...new Set(rows.map((r) => r.company_id))]).execute(),
    rows.some((r) => r.job_id) ? exec.selectFrom("jobs").select(["id", "title"]).where("id", "in", rows.map((r) => r.job_id).filter((x): x is string => !!x)).execute() : Promise.resolve([]),
    exec.selectFrom("contact_unlocks").select(["approach_id", "channels", "revoked_at"]).where("approach_id", "in", ids).execute(),
  ]);
  const recruiterUser = new Map(recruiters.map((r) => [r.id, r.user_id]));
  const [users, logos] = await Promise.all([loadSummaries([...recruiters.map((r) => r.user_id), ...rows.map((r) => r.candidate_id)], exec), loadMedia(companies.map((c) => c.logo_upload_id), exec)]);
  const companyById = new Map(companies.map((c) => [c.id, { id: c.id, slug: String(c.slug), name: c.name, logoUrl: urlOf(logos, c.logo_upload_id, "thumb"), status: c.status }]));
  const jobById = new Map(jobs.map((j) => [j.id, { id: j.id, title: j.title }]));
  const unlockBy = new Map(unlocks.map((u) => [u.approach_id, u]));

  return rows.map((r): Approach => {
    const rid = recruiterUser.get(r.recruiter_id) ?? "";
    const unlock = unlockBy.get(r.id);
    return {
      id: r.id,
      status: r.status,
      recruiter: users.get(rid) ?? { id: rid, ...DELETED },
      company: companyById.get(r.company_id) ?? { id: r.company_id, slug: "", name: "Unknown company", logoUrl: null, status: "SUSPENDED" },
      candidate: users.get(r.candidate_id) ?? { id: r.candidate_id, ...DELETED },
      job: r.job_id ? (jobById.get(r.job_id) ?? null) : null,
      roleTitle: r.role_title,
      message: r.message,
      employmentType: r.employment_type,
      salary: r.salary_min !== null || r.salary_max !== null ? { min: r.salary_min, max: r.salary_max, currency: r.salary_currency, period: r.pay_period } : null,
      unlockedChannels: unlock && !unlock.revoked_at ? unlock.channels : [],
      unlockRevoked: !!unlock?.revoked_at,
      declineReason: r.decline_reason,
      threadId: r.thread_id,
      viewedAt: r.viewed_at?.toISOString() ?? null,
      respondedAt: r.responded_at?.toISOString() ?? null,
      expiresAt: r.expires_at.toISOString(),
      createdAt: r.created_at.toISOString(),
    };
  });
}
