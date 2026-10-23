/**
 * Jobs: posting (any ACTIVE recruiter of the company), editing, opening and closing,
 * search, the company's job list, saved jobs and invitations to apply.
 *
 * Rules:
 *   - At most settings.recruiter.maxOpenJobsPerCompany OPEN jobs per company. The cap is
 *     checked on every move to OPEN, so reopening a CLOSED job counts (the source only
 *     checked on create, so closing and reopening walked past it).
 *   - DRAFT jobs, and jobs a moderator hid, are visible to the company team and staff
 *     only; a suspended company's jobs are visible to nobody else.
 *   - Search is keyset paginated: by recency (opened_at, id) or by text relevance with a
 *     (score, id) cursor. Text goes through tsvector or escaped trigram ILIKE only.
 *   - Invitations go to published profiles only, never across a block, rate limited.
 */
import type { EmploymentType, Job, JobInvite, JobStatus, Page, PayPeriod, ScreeningQuestion, Seniority, WorkplaceType } from "@open-talent/types";
import { sql } from "kysely";
import type { Actor } from "../core/context";
import { isStaff, requireActive } from "../core/context";
import { withTransaction } from "../core/effects";
import { badRequest, conflict, forbidden, HttpError, notFound } from "../core/errors";
import { newId } from "../core/ids";
import { db, type Executor } from "../db/kysely";
import { likeContains, prefixTsQuery, uniqueSkills } from "../domain/search-text";
import { MAX_QUESTIONS } from "../domain/screening";
import { consume } from "../middleware/rate-limit";
import { presentJobs, type JobRow } from "../presenters/job.presenter";
import { loadSummaries } from "../presenters/user.presenter";
import { atKey, belowScore, decodeScore, decodeTime, encodeScore, encodeTime, olderThan, pageBy } from "../repositories/keyset";
import { isBlockedEitherWay } from "../repositories/visibility";
import { audit } from "./audit.service";
import * as counters from "./counters.service";
import { notify } from "./notification.service";
import { requireRecruiter, type ActiveRecruiter } from "./recruiter.service";
import { getSettings } from "./settings.service";

export interface JobInput {
  title: string;
  description: string;
  employmentType: EmploymentType;
  workplaceType: WorkplaceType;
  seniority?: Seniority | null;
  location?: string | null;
  countryCode?: string | null;
  salary?: { min: number | null; max: number | null; currency: string | null; period: PayPeriod | null } | null;
  skills?: string[];
  openings?: number;
  screeningQuestions?: (Omit<ScreeningQuestion, "id"> & { id?: string })[];
  closesAt?: string | null;
}

function salaryCols(s: JobInput["salary"]) {
  if (s === undefined) return {};
  if (s && s.min !== null && s.max !== null && s.max < s.min) throw badRequest("The upper salary is below the lower one", "SALARY_INVALID");
  return { salary_min: s?.min ?? null, salary_max: s?.max ?? null, salary_currency: s?.currency?.toUpperCase() ?? null, pay_period: s?.period ?? null };
}

function questions(raw: JobInput["screeningQuestions"]): string | undefined {
  if (raw === undefined) return undefined;
  if (raw.length > MAX_QUESTIONS) throw badRequest(`At most ${MAX_QUESTIONS} screening questions`, "TOO_MANY_QUESTIONS");
  return JSON.stringify(raw.map((q) => ({ id: q.id ?? newId(), prompt: q.prompt, kind: q.kind === "YES_NO" ? "YES_NO" : "TEXT", required: !!q.required })));
}

async function assertOpenCapacity(companyId: string, exec: Executor, excludeJobId?: string): Promise<void> {
  const cap = (await getSettings(exec)).recruiter.maxOpenJobsPerCompany;
  let q = exec.selectFrom("jobs").select((eb) => eb.fn.countAll<number>().as("n")).where("company_id", "=", companyId).where("status", "=", "OPEN");
  if (excludeJobId) q = q.where("id", "<>", excludeJobId);
  const { n } = await q.executeTakeFirstOrThrow();
  if (Number(n) >= cap) throw new HttpError(409, `Your company can have at most ${cap} open jobs; close one first`, "JOB_CAP_REACHED", { cap });
}

export async function create(actor: Actor, input: JobInput & { publish?: boolean }): Promise<Job> {
  const r = await requireRecruiter(actor);
  await consume("job-create", `u:${actor.id}`, 30, 86400);
  const row = await withTransaction(async (trx, fx) => {
    // Serialize per company so two concurrent publishes cannot both slip under the cap.
    await trx.selectFrom("companies").select("id").where("id", "=", r.company_id).forUpdate().execute();
    if (input.publish) await assertOpenCapacity(r.company_id, trx);
    const now = new Date();
    const job = await trx
      .insertInto("jobs")
      .values({
        id: newId(),
        company_id: r.company_id,
        posted_by: r.id,
        title: input.title,
        description: input.description,
        employment_type: input.employmentType,
        workplace_type: input.workplaceType,
        seniority: input.seniority ?? null,
        location: input.location ?? null,
        country_code: input.countryCode?.toUpperCase() ?? null,
        ...salaryCols(input.salary ?? null),
        skills: uniqueSkills(input.skills ?? [], 30),
        openings: input.openings ?? 1,
        screening_questions: questions(input.screeningQuestions ?? []) as string,
        status: input.publish ? "OPEN" : "DRAFT",
        opened_at: input.publish ? now : null,
        closes_at: input.closesAt ? new Date(input.closesAt) : null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    if (input.publish) {
      await counters.refreshOpenJobs(r.company_id, trx);
      fx.job("moderation.scan", { targetType: "JOB", targetId: job.id });
    }
    await audit({ actorId: actor.id, action: "job.create", entityType: "job", entityId: job.id, data: { status: job.status } }, trx);
    return job;
  });
  return (await presentJobs(actor, [row]))[0]!;
}

async function teamJob(r: ActiveRecruiter, id: string, exec: Executor, lock = false): Promise<JobRow> {
  let q = exec.selectFrom("jobs").selectAll().where("id", "=", id);
  if (lock) q = q.forUpdate();
  const job = await q.executeTakeFirst();
  if (!job || job.company_id !== r.company_id) throw notFound("Job not found", "JOB_NOT_FOUND");
  return job;
}

export async function update(actor: Actor, id: string, p: Partial<JobInput>): Promise<Job> {
  const r = await requireRecruiter(actor);
  const row = await withTransaction(async (trx, fx) => {
    const job = await teamJob(r, id, trx, true);
    if (job.content_status === "REMOVED") throw forbidden("A moderator removed this job", "JOB_REMOVED");
    const updated = await trx
      .updateTable("jobs")
      .set({
        ...(p.title !== undefined ? { title: p.title } : {}),
        ...(p.description !== undefined ? { description: p.description } : {}),
        ...(p.employmentType !== undefined ? { employment_type: p.employmentType } : {}),
        ...(p.workplaceType !== undefined ? { workplace_type: p.workplaceType } : {}),
        ...(p.seniority !== undefined ? { seniority: p.seniority } : {}),
        ...(p.location !== undefined ? { location: p.location } : {}),
        ...(p.countryCode !== undefined ? { country_code: p.countryCode?.toUpperCase() ?? null } : {}),
        ...salaryCols(p.salary),
        ...(p.skills !== undefined ? { skills: uniqueSkills(p.skills, 30) } : {}),
        ...(p.openings !== undefined ? { openings: p.openings } : {}),
        ...(p.screeningQuestions !== undefined ? { screening_questions: questions(p.screeningQuestions) } : {}),
        ...(p.closesAt !== undefined ? { closes_at: p.closesAt ? new Date(p.closesAt) : null } : {}),
        updated_at: new Date(),
      })
      .where("id", "=", job.id)
      .returningAll()
      .executeTakeFirstOrThrow();
    if (updated.status === "OPEN" && (p.title !== undefined || p.description !== undefined)) fx.job("moderation.scan", { targetType: "JOB", targetId: job.id });
    await audit({ actorId: actor.id, action: "job.update", entityType: "job", entityId: job.id, data: { fields: Object.keys(p) } }, trx);
    return updated;
  });
  return (await presentJobs(actor, [row]))[0]!;
}

export async function setStatus(actor: Actor, id: string, next: JobStatus): Promise<Job> {
  const r = await requireRecruiter(actor);
  const row = await withTransaction(async (trx, fx) => {
    await trx.selectFrom("companies").select("id").where("id", "=", r.company_id).forUpdate().execute();
    const job = await teamJob(r, id, trx, true);
    if (job.status === next) return job;
    if (next === "DRAFT" && job.status !== "DRAFT") throw badRequest("A published job cannot go back to draft; close it instead", "JOB_STATUS_INVALID");
    if (next === "OPEN") {
      if (job.content_status !== "PUBLISHED") throw forbidden("This job is under moderation review", "JOB_UNDER_REVIEW");
      await assertOpenCapacity(r.company_id, trx, job.id);
    }
    const now = new Date();
    const updated = await trx
      .updateTable("jobs")
      .set({ status: next, ...(next === "OPEN" ? { opened_at: job.opened_at ?? now, closed_at: null } : { closed_at: now }), updated_at: now })
      .where("id", "=", job.id)
      .returningAll()
      .executeTakeFirstOrThrow();
    await counters.refreshOpenJobs(r.company_id, trx);
    if (next === "OPEN") fx.job("moderation.scan", { targetType: "JOB", targetId: job.id });
    await audit({ actorId: actor.id, action: `job.${next.toLowerCase()}`, entityType: "job", entityId: job.id }, trx);
    return updated;
  });
  return (await presentJobs(actor, [row]))[0]!;
}

/** A job the viewer may see (see the header). */
export async function readableJob(viewer: Actor | null, id: string, exec: Executor = db): Promise<JobRow> {
  const job = await exec.selectFrom("jobs").selectAll().where("id", "=", id).executeTakeFirst();
  if (!job) throw notFound("Job not found", "JOB_NOT_FOUND");
  if (isStaff(viewer) || viewer?.role === "RECRUITER_OPS") return job;
  const team = viewer ? await exec.selectFrom("recruiters").select("id").where("user_id", "=", viewer.id).where("company_id", "=", job.company_id).where("status", "=", "ACTIVE").executeTakeFirst() : undefined;
  if (team) return job;
  const company = await exec.selectFrom("companies").select("status").where("id", "=", job.company_id).executeTakeFirst();
  if (!company || company.status === "SUSPENDED" || job.status === "DRAFT" || job.content_status !== "PUBLISHED") throw notFound("Job not found", "JOB_NOT_FOUND");
  return job;
}

export async function get(viewer: Actor | null, id: string): Promise<Job> {
  return (await presentJobs(viewer, [await readableJob(viewer, id)]))[0]!;
}

export interface JobSearch {
  q?: string;
  location?: string;
  workplace?: WorkplaceType[];
  employment?: EmploymentType[];
  seniority?: Seniority[];
  skills?: string[];
  company?: string;
  salaryMin?: number;
  postedWithinDays?: number;
  sort?: "recent" | "relevance";
  cursor?: string;
  limit: number;
}

function visibleJobs() {
  return db
    .selectFrom("jobs as j")
    .innerJoin("companies as c", "c.id", "j.company_id")
    .selectAll("j")
    .where("j.status", "=", "OPEN")
    .where("j.content_status", "=", "PUBLISHED")
    .where("c.status", "<>", "SUSPENDED")
    .where((eb) => eb.or([eb("j.closes_at", "is", null), eb("j.closes_at", ">", new Date())]));
}

export async function search(viewer: Actor | null, f: JobSearch): Promise<Page<Job>> {
  let q = visibleJobs();
  const ts = f.q ? prefixTsQuery(f.q) : null;
  if (f.q?.trim()) q = q.where((eb) => eb.or([ts ? sql<boolean>`j.search @@ to_tsquery('simple', ${ts})` : sql<boolean>`false`, sql<boolean>`j.title ILIKE ${likeContains(f.q as string)}`]));
  if (f.location?.trim()) q = q.where((eb) => eb.or([sql<boolean>`j.location ILIKE ${likeContains(f.location as string)}`, eb("j.workplace_type", "=", "REMOTE")]));
  if (f.workplace?.length) q = q.where("j.workplace_type", "in", f.workplace);
  if (f.employment?.length) q = q.where("j.employment_type", "in", f.employment);
  if (f.seniority?.length) q = q.where("j.seniority", "in", f.seniority);
  if (f.skills?.length) q = q.where(sql<boolean>`j.skills && ${uniqueSkills(f.skills, 10)}::citext[]`);
  if (f.company) q = q.where("c.slug", "=", f.company);
  if (f.salaryMin) q = q.where((eb) => eb.or([eb("j.salary_max", ">=", f.salaryMin as number), eb.and([eb("j.salary_max", "is", null), eb("j.salary_min", ">=", f.salaryMin as number)])]));
  if (f.postedWithinDays) q = q.where("j.opened_at", ">", new Date(Date.now() - f.postedWithinDays * 86400_000));

  if (f.sort === "relevance" && ts) {
    const score = sql<number>`ts_rank(j.search, to_tsquery('simple', ${ts}))::float8`;
    const rows = await q.select(score.as("_score")).where(belowScore(score, "j.id", decodeScore(f.cursor))).orderBy(score, "desc").orderBy("j.id", "desc").limit(f.limit + 1).execute();
    const page = pageBy(rows, f.limit, (r) => encodeScore(Number(r._score), r.id));
    return { items: await presentJobs(viewer, page.items), nextCursor: page.nextCursor };
  }
  const rows = await q.select(atKey("j.opened_at")).where(olderThan("j.opened_at", "j.id", decodeTime(f.cursor))).orderBy("j.opened_at", "desc").orderBy("j.id", "desc").limit(f.limit + 1).execute();
  const page = pageBy(rows, f.limit, (r) => encodeTime(r._at, r.id));
  return { items: await presentJobs(viewer, page.items), nextCursor: page.nextCursor };
}

/**
 * Jobs that fit the viewer: open jobs sharing their skills or open-to roles, ranked by
 * skill overlap then recency. The "Recommended for you" rail.
 */
export async function recommended(actor: Actor, limit = 10): Promise<Job[]> {
  const profile = await db.selectFrom("talent_profiles").select(["skill_names", "open_to_roles"]).where("user_id", "=", actor.id).executeTakeFirst();
  const skills = (profile?.skill_names ?? []).map(String);
  const roles = profile?.open_to_roles ?? [];
  if (!skills.length && !roles.length) return (await search(actor, { limit })).items;
  const overlap = sql<number>`cardinality(ARRAY(SELECT unnest(j.skills) INTERSECT SELECT unnest(${skills}::citext[])))`;
  const roleHit = roles.length ? sql<boolean>`j.title ILIKE ANY(${roles.map((r) => likeContains(r))}::text[])` : sql<boolean>`false`;
  const rows = await visibleJobs()
    .where((eb) => eb.or([sql<boolean>`j.skills && ${skills}::citext[]`, roleHit]))
    .where((eb) => eb.not(eb.exists(eb.selectFrom("applications as a").select("a.id").whereRef("a.job_id", "=", "j.id").where("a.candidate_id", "=", actor.id))))
    .orderBy(overlap, "desc")
    .orderBy("j.opened_at", "desc")
    .limit(limit)
    .execute();
  return presentJobs(actor, rows);
}

/** A company's jobs: OPEN ones for everyone, every status for its team. */
export async function forCompany(viewer: Actor | null, slug: string, q: { status?: JobStatus; cursor?: string; limit: number }): Promise<Page<Job>> {
  const company = await db.selectFrom("companies").select(["id", "status"]).where("slug", "=", slug).executeTakeFirst();
  if (!company) throw notFound("Company not found", "COMPANY_NOT_FOUND");
  const team = viewer ? await db.selectFrom("recruiters").select("id").where("user_id", "=", viewer.id).where("company_id", "=", company.id).where("status", "=", "ACTIVE").executeTakeFirst() : undefined;
  if (company.status === "SUSPENDED" && !team && !isStaff(viewer)) throw notFound("Company not found", "COMPANY_NOT_FOUND");
  let query = db.selectFrom("jobs as j").selectAll("j").select(atKey("j.created_at")).where("j.company_id", "=", company.id);
  if (!team) query = query.where("j.status", "=", "OPEN").where("j.content_status", "=", "PUBLISHED");
  else if (q.status) query = query.where("j.status", "=", q.status);
  const rows = await query.where(olderThan("j.created_at", "j.id", decodeTime(q.cursor))).orderBy("j.created_at", "desc").orderBy("j.id", "desc").limit(q.limit + 1).execute();
  const page = pageBy(rows, q.limit, (r) => encodeTime(r._at, r.id));
  return { items: await presentJobs(viewer, page.items), nextCursor: page.nextCursor };
}

// ─── Saved jobs ─────────────────────────────────────────────────────────────

export async function save(actor: Actor, id: string, on: boolean): Promise<void> {
  requireActive(actor);
  if (on) {
    await readableJob(actor, id);
    await db.insertInto("saved_jobs").values({ user_id: actor.id, job_id: id }).onConflict((oc) => oc.columns(["user_id", "job_id"]).doNothing()).execute();
  } else await db.deleteFrom("saved_jobs").where("user_id", "=", actor.id).where("job_id", "=", id).execute();
}

export async function saved(actor: Actor, q: { cursor?: string; limit: number }): Promise<Page<Job>> {
  const rows = await db
    .selectFrom("saved_jobs as s")
    .innerJoin("jobs as j", "j.id", "s.job_id")
    .innerJoin("companies as c", "c.id", "j.company_id")
    .selectAll("j")
    .select(atKey("s.created_at", "_sat"))
    .where("s.user_id", "=", actor.id)
    .where("j.content_status", "=", "PUBLISHED")
    .where("c.status", "<>", "SUSPENDED")
    .where(olderThan("s.created_at", "s.job_id", decodeTime(q.cursor)))
    .orderBy("s.created_at", "desc")
    .orderBy("s.job_id", "desc")
    .limit(q.limit + 1)
    .execute();
  const page = pageBy(rows, q.limit, (r) => encodeTime(r._sat, r.id));
  return { items: await presentJobs(actor, page.items), nextCursor: page.nextCursor };
}

// ─── Invitations ────────────────────────────────────────────────────────────

export async function invite(actor: Actor, jobId: string, username: string, message: string | null): Promise<void> {
  const r = await requireRecruiter(actor);
  await consume("job-invite", `u:${actor.id}`, 100, 86400);
  await withTransaction(async (trx, fx) => {
    const job = await teamJob(r, jobId, trx);
    if (job.status !== "OPEN") throw badRequest("Open the job before inviting people to it", "JOB_NOT_OPEN");
    const target = await trx
      .selectFrom("users as u")
      .innerJoin("talent_profiles as p", "p.user_id", "u.id")
      .select(["u.id", "u.status", "p.status as profile_status"])
      .where("u.username", "=", username)
      .executeTakeFirst();
    if (!target || target.status !== "ACTIVE" || (target.profile_status !== "PUBLISHED" && target.profile_status !== "UNLISTED") || (await isBlockedEitherWay(actor.id, target.id, trx))) {
      throw notFound("Profile not found", "PROFILE_NOT_FOUND");
    }
    const already = await trx.selectFrom("applications").select("id").where("job_id", "=", job.id).where("candidate_id", "=", target.id).executeTakeFirst();
    if (already) throw conflict("They have already applied", "ALREADY_APPLIED");
    const row = await trx
      .insertInto("job_invites")
      .values({ id: newId(), job_id: job.id, candidate_id: target.id, invited_by: r.id, message })
      .onConflict((oc) => oc.columns(["job_id", "candidate_id"]).doNothing())
      .returning("id")
      .executeTakeFirst();
    if (!row) throw conflict("You already invited them to this job", "ALREADY_INVITED");
    await notify({ recipientId: target.id, actorId: actor.id, type: "JOB_INVITE", entityType: "job_invite", entityId: row.id, snippet: `${job.title} at ${r.company_name}`, data: { jobId: job.id } }, fx, trx);
  });
}

export async function myInvites(actor: Actor): Promise<JobInvite[]> {
  const rows = await db
    .selectFrom("job_invites as i")
    .innerJoin("jobs as j", "j.id", "i.job_id")
    .innerJoin("companies as c", "c.id", "j.company_id")
    .innerJoin("recruiters as r", "r.id", "i.invited_by")
    .selectAll("j")
    .select(["i.id as invite_id", "i.message", "i.status as invite_status", "i.created_at as invited_at", "r.user_id as inviter"])
    .where("i.candidate_id", "=", actor.id)
    .where("c.status", "<>", "SUSPENDED")
    .where("j.content_status", "=", "PUBLISHED")
    .orderBy("i.created_at", "desc")
    .limit(100)
    .execute();
  const [jobs, people] = await Promise.all([presentJobs(actor, rows), loadSummaries(rows.map((r) => r.inviter))]);
  const byId = new Map(jobs.map((j) => [j.id, j]));
  return rows
    .filter((r) => byId.has(r.id) && people.has(r.inviter))
    .map((r) => {
      const j = byId.get(r.id)!;
      return {
        id: r.invite_id,
        job: { id: j.id, title: j.title, company: j.company, location: j.location, workplaceType: j.workplaceType, employmentType: j.employmentType, status: j.status },
        invitedBy: people.get(r.inviter)!,
        message: r.message,
        status: r.invite_status,
        createdAt: r.invited_at.toISOString(),
      };
    });
}

/** INTERESTED hands the candidate to the apply flow (the web app opens Easy Apply with the job). */
export async function respondInvite(actor: Actor, inviteId: string, response: "VIEWED" | "INTERESTED" | "DECLINED"): Promise<{ jobId: string }> {
  const row = await db
    .updateTable("job_invites")
    .set({ status: response, responded_at: response === "VIEWED" ? null : new Date() })
    .where("id", "=", inviteId)
    .where("candidate_id", "=", actor.id)
    .where("status", "in", response === "VIEWED" ? ["SENT"] : ["SENT", "VIEWED"])
    .returning("job_id")
    .executeTakeFirst();
  if (!row) {
    const existing = await db.selectFrom("job_invites").select("job_id").where("id", "=", inviteId).where("candidate_id", "=", actor.id).executeTakeFirst();
    if (!existing) throw notFound("Invitation not found");
    return { jobId: existing.job_id };
  }
  return { jobId: row.job_id };
}
